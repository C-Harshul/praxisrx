-- Matching owns only the reviewed-KB adapter and ranking queue. No clinical seeds.
ALTER TABLE public.audit_log DROP CONSTRAINT audit_log_action_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_action_check CHECK (action IN (
  'onboarding_completed','profile_updated','patient_data_linked','patient_data_unlinked',
  'bookmark_added','bookmark_removed','article_opened',
  'profiling_queued','profiling_started','profiling_succeeded','profiling_failed','profiling_confirmed','profiling_discarded',
  'matching_queued','matching_started','matching_succeeded','matching_failed','matching_discarded'
));

CREATE TABLE public.matching_kb_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  published_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL CHECK (payload->>'schema_version' = 'matching-kb.v1' AND jsonb_typeof(payload->'items') = 'array')
);
ALTER TABLE public.matching_kb_releases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.matching_kb_releases FROM anon, authenticated;
GRANT SELECT, INSERT ON public.matching_kb_releases TO service_role;
CREATE TRIGGER matching_kb_immutable BEFORE UPDATE OR DELETE ON public.matching_kb_releases
FOR EACH ROW EXECUTE FUNCTION public.audit_log_block_changes();
CREATE TRIGGER matching_kb_no_truncate BEFORE TRUNCATE ON public.matching_kb_releases
FOR EACH STATEMENT EXECUTE FUNCTION public.audit_log_block_changes();

CREATE FUNCTION public.publish_matching_kb_release(_payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  INSERT INTO public.matching_kb_releases(payload) VALUES (_payload) RETURNING id INTO _id;
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.publish_matching_kb_release(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_matching_kb_release(jsonb) TO service_role;

ALTER TABLE public.articles ADD COLUMN kb_item_id text;
CREATE INDEX articles_kb_item ON public.articles(kb_item_id);

CREATE TABLE public.matching_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  doctor uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  profile_job uuid NOT NULL REFERENCES public.doctor_profile_jobs(id),
  kb_release uuid NOT NULL REFERENCES public.matching_kb_releases(id),
  input jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','succeeded','failed','superseded')),
  attempts integer NOT NULL DEFAULT 0,
  lease_token uuid,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  result jsonb,
  error_code text,
  matcher_version text
);
CREATE UNIQUE INDEX matching_one_pending ON public.matching_jobs(doctor) WHERE status IN ('queued','processing');
CREATE INDEX matching_jobs_queue ON public.matching_jobs(status,version);
ALTER TABLE public.matching_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.matching_jobs FROM anon, authenticated;
GRANT SELECT ON public.matching_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.matching_jobs TO service_role;
CREATE POLICY "Doctors read own matching jobs" ON public.matching_jobs FOR SELECT TO authenticated USING (doctor = auth.uid());

-- Input allowlist excludes names, doctor codes and individual patient records.
CREATE FUNCTION public.current_matching_input(_doctor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _d public.doctors; _p public.doctor_profile_jobs; _mix jsonb;
BEGIN
  SELECT * INTO _d FROM public.doctors WHERE id = _doctor;
  IF NOT FOUND OR NOT _d.onboarding_complete THEN RETURN NULL; END IF;
  SELECT * INTO _p FROM public.doctor_profile_jobs WHERE doctor = _doctor
    AND status = 'succeeded' AND confirmed_at IS NOT NULL ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF _d.patient_data_linked AND _d.consent_given_at IS NOT NULL THEN
    SELECT jsonb_build_object('synced_at',synced_at,'aggregates',aggregates) INTO _mix
      FROM public.patient_mix WHERE doctor_id_code = _d.doctor_id_code;
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

-- Schedule is measured from successful matching. Generation retries consume the same result.
CREATE FUNCTION public.enqueue_due_matching_jobs() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _d public.doctors; _input jsonb; _kb uuid; _last public.matching_jobs; _id uuid; _count integer := 0;
BEGIN
  SELECT id INTO _kb FROM public.matching_kb_releases WHERE published_at <= now() ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN RETURN 0; END IF;
  FOR _d IN SELECT * FROM public.doctors WHERE onboarding_complete ORDER BY id FOR UPDATE SKIP LOCKED LOOP
    IF EXISTS (SELECT 1 FROM public.matching_jobs WHERE doctor = _d.id AND status IN ('queued','processing')) THEN CONTINUE; END IF;
    _input := public.current_matching_input(_d.id);
    IF _input IS NULL THEN CONTINUE; END IF;
    SELECT * INTO _last FROM public.matching_jobs WHERE doctor = _d.id AND status = 'succeeded' ORDER BY version DESC LIMIT 1;
    IF FOUND AND _last.input->'profile' = _input->'profile'
      AND _last.input->'patient_mix' IS NOT DISTINCT FROM _input->'patient_mix'
      AND _last.created_at > now() - (CASE WHEN _d.frequency = 'Every two weeks' THEN interval '14 days' ELSE interval '7 days' END)
    THEN CONTINUE; END IF;
    -- Safe backoff after invalid data or failures; no tight scheduler retry loop.
    IF EXISTS (SELECT 1 FROM public.matching_jobs WHERE doctor = _d.id AND status = 'failed' AND completed_at > now()-interval '5 minutes') THEN CONTINUE; END IF;
    INSERT INTO public.matching_jobs(doctor,profile_job,kb_release,input)
      VALUES (_d.id,(_input->'profile'->>'id')::uuid,_kb,_input) RETURNING id INTO _id;
    INSERT INTO public.audit_log(doctor,action,details) VALUES (_d.id,'matching_queued',jsonb_build_object('job_id',_id,'profile_job',_input->'profile'->>'id','kb_release',_kb));
    _count := _count + 1;
  END LOOP;
  RETURN _count;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_due_matching_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_due_matching_jobs() TO service_role;

CREATE FUNCTION public.claim_matching_job() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _j public.matching_jobs; _payload jsonb;
BEGIN
  FOR _j IN SELECT * FROM public.matching_jobs WHERE status = 'processing' AND started_at < now()-interval '5 minutes' AND attempts >= 3 FOR UPDATE SKIP LOCKED LOOP
    UPDATE public.matching_jobs SET status='failed',completed_at=now(),error_code='worker_lease_expired' WHERE id=_j.id;
    INSERT INTO public.audit_log(doctor,action,details) VALUES (_j.doctor,'matching_failed',jsonb_build_object('job_id',_j.id,'error_code','worker_lease_expired'));
  END LOOP;
  SELECT * INTO _j FROM public.matching_jobs WHERE status='queued' OR
    (status='processing' AND started_at < now()-interval '5 minutes' AND attempts < 3)
    ORDER BY version FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.matching_jobs SET status='processing',attempts=attempts+1,lease_token=gen_random_uuid(),started_at=now() WHERE id=_j.id RETURNING * INTO _j;
  SELECT payload INTO _payload FROM public.matching_kb_releases WHERE id=_j.kb_release;
  INSERT INTO public.audit_log(doctor,action,details) VALUES (_j.doctor,'matching_started',jsonb_build_object('job_id',_j.id,'attempt',_j.attempts));
  RETURN jsonb_build_object('id',_j.id,'lease_token',_j.lease_token,'input',_j.input,'release',_payload);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_matching_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_matching_job() TO service_role;

CREATE FUNCTION public.finish_matching_job(_id uuid,_lease uuid,_result jsonb,_error text,_matcher_version text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _j public.matching_jobs; _doctor uuid; _status text;
BEGIN
  SELECT doctor INTO _doctor FROM public.matching_jobs WHERE id=_id;
  PERFORM 1 FROM public.doctors WHERE id=_doctor FOR UPDATE;
  SELECT * INTO _j FROM public.matching_jobs WHERE id=_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'superseded'; END IF;
  IF _j.status <> 'processing' OR _j.lease_token IS DISTINCT FROM _lease THEN
    INSERT INTO public.audit_log(doctor,action,details) VALUES (_doctor,'matching_discarded',
      jsonb_build_object('job_id',_id,'matcher_version',_matcher_version,'reason','superseded_or_expired_lease'));
    RETURN 'superseded';
  END IF;
  IF _j.input IS DISTINCT FROM public.current_matching_input(_doctor) THEN
    _status := 'superseded';
  ELSE _status := CASE WHEN _error IS NULL THEN 'succeeded' ELSE 'failed' END; END IF;
  IF _status='succeeded' AND (_result IS NULL OR jsonb_typeof(_result->'matches') IS DISTINCT FROM 'array'
    OR _result->>'matcher_version' IS DISTINCT FROM _matcher_version) THEN RAISE EXCEPTION 'invalid matching result'; END IF;
  UPDATE public.matching_jobs SET status=_status,completed_at=now(),result=CASE WHEN _status='succeeded' THEN _result ELSE NULL END,
    error_code=_error,matcher_version=_matcher_version WHERE id=_id;
  INSERT INTO public.audit_log(doctor,action,details) VALUES (_doctor,
    CASE WHEN _status='superseded' THEN 'matching_discarded' ELSE 'matching_'||_status END,
    jsonb_build_object('job_id',_id,'matcher_version',_matcher_version,'error_code',_error,
      'reason',CASE WHEN _status='superseded' THEN 'profile_consent_mix_or_delivery_changed' END,
      'rankings',CASE WHEN _status='succeeded' THEN (SELECT coalesce(jsonb_agg(value - 'evidence'),'[]'::jsonb) FROM jsonb_array_elements(_result->'matches')) END));
  RETURN _status;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_matching_job(uuid,uuid,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_matching_job(uuid,uuid,jsonb,text,text) TO service_role;

-- Newsletter worker must recheck inside its own atomic publication transaction too.
CREATE FUNCTION public.read_current_matching_result(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _j public.matching_jobs; _doctor uuid;
BEGIN
  SELECT doctor INTO _doctor FROM public.matching_jobs WHERE id=_id;
  PERFORM 1 FROM public.doctors WHERE id=_doctor FOR UPDATE;
  SELECT * INTO _j FROM public.matching_jobs WHERE id=_id;
  IF NOT FOUND OR _j.status <> 'succeeded' OR _j.input IS DISTINCT FROM public.current_matching_input(_doctor) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('matching_job_id',_j.id,'doctor',_j.doctor,'kb_release',_j.kb_release,'input',_j.input,'result',_j.result);
END;
$$;
REVOKE ALL ON FUNCTION public.read_current_matching_result(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_current_matching_result(uuid) TO service_role;
