-- Separate hospital staff authority from doctor accounts. No self-service staff enrollment.
CREATE TABLE public.hospitals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL);
CREATE TABLE public.hospital_staff (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id), hospital_id uuid NOT NULL REFERENCES public.hospitals(id)
);
CREATE TABLE public.hospital_doctor_links (
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  doctor_id_code text NOT NULL,
  doctor uuid NOT NULL UNIQUE REFERENCES public.doctors(id),
  PRIMARY KEY (hospital_id, doctor_id_code)
);
ALTER TABLE public.hospitals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hospital_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hospital_doctor_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hospitals,public.hospital_staff,public.hospital_doctor_links FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.hospitals,public.hospital_staff,public.hospital_doctor_links TO service_role;
ALTER TABLE public.patient_sync_snapshots ADD COLUMN hospital_actor uuid REFERENCES auth.users(id);
ALTER TABLE public.patient_sync_snapshots ADD COLUMN hospital_id uuid REFERENCES public.hospitals(id);
-- The previous doctor upload RPC is retired. Doctor read/consent/unlink remain available.
REVOKE EXECUTE ON FUNCTION public.sync_patient_context(jsonb,boolean,text,uuid,uuid) FROM authenticated;

CREATE FUNCTION public.hospital_write_patient_context(_doctor uuid, _actor uuid, _hospital uuid, _payload jsonb, _consent boolean, _source_kind text, _request_id uuid, _expected_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _d public.doctors; _current jsonb; _s public.patient_sync_snapshots; _key text; _v jsonb;
  _panel numeric; _k numeric; _percent numeric;
BEGIN
  SELECT * INTO _d FROM public.doctors WHERE id = _doctor FOR UPDATE;
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
  INSERT INTO public.patient_sync_snapshots(id,doctor,doctor_id_code,synced_at,panel_size,min_cell_size,source_kind,aggregates,hospital_actor,hospital_id)
    VALUES (_request_id,_d.id,_d.doctor_id_code,(_payload->>'synced_at')::timestamptz,_panel,_k,_source_kind,_payload->'aggregates',_actor,_hospital) RETURNING * INTO _s;
  PERFORM public.enqueue_doctor_profile(_d.id);
  INSERT INTO public.audit_log(doctor,action,details) VALUES (_d.id,'patient_data_synced',jsonb_build_object(
    'hospital_actor',_actor,'hospital_id',_hospital,'snapshot_id',_s.id,'version',_s.version,'source_kind',_source_kind,'definition_version',_s.definition_version,'denominator_id',_s.denominator_id));
  RETURN to_jsonb(_s) - 'doctor';
END;
$$;

REVOKE ALL ON FUNCTION public.hospital_write_patient_context(uuid,uuid,uuid,jsonb,boolean,text,uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.hospital_sync_patient_context(_payload jsonb, _source_kind text, _request_id uuid, _expected_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _hospital uuid; _doctor uuid;
BEGIN
  SELECT hospital_id INTO _hospital FROM public.hospital_staff WHERE user_id = auth.uid() FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hospital staff access required'; END IF;
  SELECT doctor INTO _doctor FROM public.hospital_doctor_links
    WHERE hospital_id = _hospital AND doctor_id_code = _payload->>'doctor_id_code' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Doctor not assigned to your hospital'; END IF;
  RETURN public.hospital_write_patient_context(_doctor,auth.uid(),_hospital,_payload,true,_source_kind,_request_id,_expected_id);
END;
$$;
REVOKE ALL ON FUNCTION public.hospital_sync_patient_context(jsonb,text,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hospital_sync_patient_context(jsonb,text,uuid,uuid) TO authenticated;

CREATE FUNCTION public.hospital_directory() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _hospital uuid; _name text; _doctors jsonb;
BEGIN
  SELECT h.id,h.name INTO _hospital,_name FROM public.hospitals h JOIN public.hospital_staff s ON s.hospital_id = h.id WHERE s.user_id = auth.uid();
  IF NOT FOUND THEN RETURN jsonb_build_object('mode','connected','authorized',false,'hospital_name','Hospital portal','doctors','[]'::jsonb); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'doctor_id_code',l.doctor_id_code,'full_name',coalesce(d.full_name,'Doctor'),'specialty',coalesce(d.specialty,'Unknown'),
    'linked',d.patient_data_linked AND d.consent_given_at IS NOT NULL AND d.doctor_id_code = l.doctor_id_code AND d.onboarding_complete,
    'context',public.current_patient_context(d.id),
    'profile',(SELECT jsonb_build_object('version',p.version,'status',p.status,'confirmed',p.confirmed_at IS NOT NULL) FROM public.doctor_profile_jobs p WHERE p.doctor = d.id ORDER BY version DESC LIMIT 1),
    'history',coalesce((SELECT jsonb_agg(to_jsonb(x) - 'doctor' - 'hospital_actor' ORDER BY x.version DESC)
      FROM (SELECT * FROM public.patient_sync_snapshots s WHERE s.doctor = d.id AND s.hospital_id = _hospital ORDER BY version DESC LIMIT 20) x),'[]'::jsonb)
  ) ORDER BY l.doctor_id_code),'[]'::jsonb) INTO _doctors
  FROM public.hospital_doctor_links l JOIN public.doctors d ON d.id = l.doctor WHERE l.hospital_id = _hospital;
  RETURN jsonb_build_object('mode','connected','authorized',true,'hospital_name',_name,'doctors',_doctors);
END;
$$;
REVOKE ALL ON FUNCTION public.hospital_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hospital_directory() TO authenticated;
