-- Per-account immutable aggregate snapshots. Never store uploaded files or patient rows.
ALTER TABLE public.audit_log DROP CONSTRAINT audit_log_action_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_action_check CHECK (action IN (
  'onboarding_completed','profile_updated','patient_data_linked','patient_data_unlinked',
  'bookmark_added','bookmark_removed','article_opened',
  'profiling_queued','profiling_started','profiling_succeeded','profiling_failed','profiling_confirmed','profiling_discarded',
  'matching_queued','matching_started','matching_succeeded','matching_failed','matching_discarded','patient_data_synced'
));
CREATE TABLE public.patient_sync_snapshots (
  id uuid PRIMARY KEY,
  version bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  doctor uuid NOT NULL REFERENCES public.doctors(id),
  doctor_id_code text NOT NULL,
  synced_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  panel_size integer NOT NULL CHECK (panel_size BETWEEN 5 AND 1000000),
  min_cell_size integer NOT NULL CHECK (min_cell_size BETWEEN 5 AND panel_size),
  source_kind text NOT NULL CHECK (source_kind IN ('aggregate_json','synthetic_csv')),
  aggregates jsonb NOT NULL CHECK (jsonb_typeof(aggregates) = 'object'),
  denominator_id text NOT NULL DEFAULT 'active_panel.v1',
  definition_version text NOT NULL DEFAULT 'synthetic-lung-cohorts.v1'
);
CREATE INDEX patient_sync_owner ON public.patient_sync_snapshots(doctor, version DESC);
ALTER TABLE public.patient_sync_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_sync_snapshots FROM anon, authenticated, service_role;
GRANT SELECT ON public.patient_sync_snapshots TO authenticated, service_role;
CREATE POLICY "Doctors read own sync history" ON public.patient_sync_snapshots FOR SELECT TO authenticated USING (doctor = auth.uid());
CREATE TRIGGER patient_sync_immutable BEFORE UPDATE OR DELETE ON public.patient_sync_snapshots
FOR EACH ROW EXECUTE FUNCTION public.audit_log_block_changes();
CREATE TRIGGER patient_sync_no_truncate BEFORE TRUNCATE ON public.patient_sync_snapshots
FOR EACH STATEMENT EXECUTE FUNCTION public.audit_log_block_changes();

-- Private helper: a revoked/relinked consent cannot reactivate an old upload.
CREATE FUNCTION public.current_patient_context(_doctor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _d public.doctors; _s public.patient_sync_snapshots; _legacy public.patient_mix;
BEGIN
  SELECT * INTO _d FROM public.doctors WHERE id = _doctor;
  IF NOT FOUND OR NOT _d.patient_data_linked OR _d.consent_given_at IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _s FROM public.patient_sync_snapshots WHERE doctor = _doctor
    AND doctor_id_code = _d.doctor_id_code AND created_at >= _d.consent_given_at ORDER BY version DESC LIMIT 1;
  IF FOUND THEN RETURN to_jsonb(_s) - 'doctor'; END IF;
  SELECT * INTO _legacy FROM public.patient_mix WHERE doctor_id_code = _d.doctor_id_code;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(_legacy);
END;
$$;
REVOKE ALL ON FUNCTION public.current_patient_context(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_patient_context(uuid) TO service_role;
CREATE FUNCTION public.read_patient_context() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT public.current_patient_context(auth.uid()) $$;
REVOKE ALL ON FUNCTION public.read_patient_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_patient_context() TO authenticated;

CREATE FUNCTION public.sync_patient_context(_payload jsonb, _consent boolean, _source_kind text, _request_id uuid, _expected_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _d public.doctors; _current jsonb; _s public.patient_sync_snapshots; _key text; _v jsonb;
  _panel numeric; _k numeric; _percent numeric;
BEGIN
  SELECT * INTO _d FROM public.doctors WHERE id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR NOT _d.onboarding_complete OR NOT _d.patient_data_linked OR _d.consent_given_at IS NULL OR _consent IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Link your doctor ID and explicitly consent before syncing';
  END IF;
  IF _request_id IS NULL OR _source_kind IS NULL OR _source_kind NOT IN ('aggregate_json','synthetic_csv') OR
    jsonb_typeof(_payload) IS DISTINCT FROM 'object' OR pg_column_size(_payload) > 16384 THEN RAISE EXCEPTION 'Invalid aggregate payload'; END IF;
  IF _payload->>'doctor_id_code' IS DISTINCT FROM _d.doctor_id_code THEN RAISE EXCEPTION 'Doctor ID does not match your linked profile'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(_payload)) <> 5 OR NOT (_payload ?& ARRAY['doctor_id_code','synced_at','panel_size','min_cell_size','aggregates']) THEN
    RAISE EXCEPTION 'Only approved aggregate fields are accepted';
  END IF;
  IF jsonb_typeof(_payload->'panel_size') IS DISTINCT FROM 'number' OR jsonb_typeof(_payload->'min_cell_size') IS DISTINCT FROM 'number' OR
    jsonb_typeof(_payload->'aggregates') IS DISTINCT FROM 'object' OR jsonb_typeof(_payload->'synced_at') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid aggregate types'; END IF;
  _panel := (_payload->>'panel_size')::numeric; _k := (_payload->>'min_cell_size')::numeric;
  IF _panel <> trunc(_panel) OR _k <> trunc(_k) OR _panel NOT BETWEEN 5 AND 1000000 OR _k NOT BETWEEN 5 AND _panel OR
    (_payload->>'synced_at') !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' OR
    (_payload->>'synced_at')::timestamptz > clock_timestamp() + interval '5 minutes' THEN RAISE EXCEPTION 'Invalid panel or timestamp'; END IF;
  IF _payload->'aggregates' = '{}'::jsonb THEN RAISE EXCEPTION 'No aggregate categories'; END IF;
  FOR _key, _v IN SELECT * FROM jsonb_each(_payload->'aggregates') LOOP
    IF _key NOT IN ('NSCLC','SCLC','EGFR-mutant','Post-osimertinib','Post-osimertinib with MET alteration','KRAS G12C','ALK-positive','PD-L1 ≥50%','PD-L1 negative','ES-SCLC after 1L chemo-IO','Stage IV') THEN
      RAISE EXCEPTION 'Unsupported population label';
    END IF;
    IF _v = 'null'::jsonb THEN CONTINUE; END IF;
    IF jsonb_typeof(_v) <> 'number' THEN RAISE EXCEPTION 'Invalid percentage'; END IF;
    _percent := _v::text::numeric;
    IF _percent NOT BETWEEN 0 AND 100 OR (_percent > 0 AND ceil((_percent + 0.5)*_panel/100)-1 < _k) THEN RAISE EXCEPTION 'Invalid or unsuppressed small cell'; END IF;
  END LOOP;
  SELECT * INTO _s FROM public.patient_sync_snapshots WHERE id = _request_id;
  IF FOUND THEN
    IF _s.doctor <> _d.id OR _s.created_at < _d.consent_given_at OR _s.doctor_id_code <> _d.doctor_id_code OR
      _s.aggregates IS DISTINCT FROM _payload->'aggregates' OR _s.synced_at <> (_payload->>'synced_at')::timestamptz OR
      _s.panel_size <> _panel OR _s.min_cell_size <> _k OR _s.source_kind <> _source_kind THEN RAISE EXCEPTION 'Request ID conflict'; END IF;
    RETURN to_jsonb(_s) - 'doctor';
  END IF;
  _current := public.current_patient_context(_d.id);
  IF (_current->>'id')::uuid IS DISTINCT FROM _expected_id THEN RAISE EXCEPTION 'Patient context changed; refresh and preview again'; END IF;
  IF _current ? 'id' AND (_payload->>'synced_at')::timestamptz < (_current->>'synced_at')::timestamptz THEN RAISE EXCEPTION 'An older export cannot replace newer patient context'; END IF;
  INSERT INTO public.patient_sync_snapshots(id,doctor,doctor_id_code,synced_at,panel_size,min_cell_size,source_kind,aggregates)
    VALUES (_request_id,_d.id,_d.doctor_id_code,(_payload->>'synced_at')::timestamptz,_panel,_k,_source_kind,_payload->'aggregates') RETURNING * INTO _s;
  PERFORM public.enqueue_doctor_profile(_d.id);
  INSERT INTO public.audit_log(doctor,action,details) VALUES (_d.id,'patient_data_synced',jsonb_build_object(
    'snapshot_id',_s.id,'version',_s.version,'source_kind',_source_kind,'definition_version',_s.definition_version,'denominator_id',_s.denominator_id));
  RETURN to_jsonb(_s) - 'doctor';
END;
$$;
REVOKE ALL ON FUNCTION public.sync_patient_context(jsonb,boolean,text,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_patient_context(jsonb,boolean,text,uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.current_matching_input(_doctor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _d public.doctors; _p public.doctor_profile_jobs; _mix jsonb;
BEGIN
  SELECT * INTO _d FROM public.doctors WHERE id = _doctor;
  IF NOT FOUND OR NOT _d.onboarding_complete THEN RETURN NULL; END IF;
  SELECT * INTO _p FROM public.doctor_profile_jobs WHERE doctor = _doctor
    AND status = 'succeeded' AND confirmed_at IS NOT NULL ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF _d.patient_data_linked AND _d.consent_given_at IS NOT NULL THEN
    -- Snapshot identity is pinned by its server timestamp plus immutable aggregate content.
    SELECT jsonb_build_object('synced_at', coalesce(_context->>'created_at',_context->>'synced_at'),
      'aggregates',coalesce((SELECT jsonb_object_agg(key,value) FROM jsonb_each(_context->'aggregates') WHERE jsonb_typeof(value) = 'number'),'{}'::jsonb)) INTO _mix
    FROM (SELECT public.current_patient_context(_doctor) AS _context) c WHERE _context IS NOT NULL;
  END IF;
  RETURN jsonb_build_object(
    'profile',jsonb_build_object('id',_p.id,'version',_p.version,'schema_version',_p.schema_version,
      'prompt_version',_p.prompt_version,'model',_p.model,'stated',_p.output->'stated','reviewed_focus',_p.reviewed_focus),
    'patient_mix',_mix,
    'delivered_item_ids',coalesce((SELECT jsonb_agg(DISTINCT a.kb_item_id ORDER BY a.kb_item_id)
      FROM public.articles a JOIN public.newsletters n ON n.id = a.newsletter
      WHERE n.doctor = _doctor AND a.kb_item_id IS NOT NULL),'[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.current_matching_input(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_matching_input(uuid) TO service_role;

CREATE FUNCTION public.read_patient_sync_history() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(s) - 'doctor' ORDER BY s.version DESC),'[]'::jsonb)
  FROM (SELECT * FROM public.patient_sync_snapshots WHERE doctor = auth.uid() ORDER BY version DESC LIMIT 20) s;
$$;
REVOKE ALL ON FUNCTION public.read_patient_sync_history() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_patient_sync_history() TO authenticated;
