-- Job 3: datastore boundary, service-only worker, doctor-owned readable results.
ALTER TABLE public.audit_log DROP CONSTRAINT audit_log_action_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_action_check CHECK (action IN (
  'onboarding_completed','profile_updated','patient_data_linked','patient_data_unlinked',
  'bookmark_added','bookmark_removed','article_opened',
  'profiling_queued','profiling_started','profiling_succeeded','profiling_failed','profiling_confirmed','profiling_discarded'
));

CREATE TABLE public.doctor_profile_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  doctor uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  input jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','succeeded','failed','superseded')),
  attempts integer NOT NULL DEFAULT 0,
  lease_token uuid,
  started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  confirmed_at timestamptz,
  reviewed_focus jsonb,
  output jsonb,
  error_code text,
  model text,
  prompt_version text,
  schema_version text
);
CREATE INDEX doctor_profile_jobs_owner ON public.doctor_profile_jobs(doctor, version DESC);
CREATE INDEX doctor_profile_jobs_queue ON public.doctor_profile_jobs(status, version);
ALTER TABLE public.doctor_profile_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.doctor_profile_jobs FROM anon, authenticated;
GRANT SELECT ON public.doctor_profile_jobs TO authenticated;
GRANT ALL ON public.doctor_profile_jobs TO service_role;
CREATE POLICY "Doctors read own generated profile" ON public.doctor_profile_jobs FOR SELECT TO authenticated USING (doctor = auth.uid());

CREATE FUNCTION public.enqueue_doctor_profile(_doctor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _d public.doctors; _id uuid;
BEGIN
  -- Serialize enqueue, confirmation and worker completion against doctor edits.
  SELECT * INTO _d FROM public.doctors WHERE id = _doctor FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.doctor_profile_jobs SET status = 'superseded', confirmed_at = NULL
    WHERE doctor = _doctor AND status <> 'superseded';
  IF NOT _d.onboarding_complete THEN RETURN; END IF;
  INSERT INTO public.doctor_profile_jobs(doctor, input) VALUES (_doctor, jsonb_build_object(
    'years_in_practice', _d.years_in_practice, 'practice_setting', _d.practice_setting,
    'specialty', _d.specialty, 'cancer_types', _d.cancer_types, 'topics', _d.topics,
    'preferred_format', _d.preferred_format, 'frequency', _d.frequency
  )) RETURNING id INTO _id;
  INSERT INTO public.audit_log(doctor, action, details) VALUES (_doctor, 'profiling_queued', jsonb_build_object('job_id', _id));
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_doctor_profile(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.queue_doctor_profile_on_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.enqueue_doctor_profile(NEW.id);
  ELSIF (to_jsonb(NEW) - 'updated_at' - 'created_at') IS DISTINCT FROM
        (to_jsonb(OLD) - 'updated_at' - 'created_at') THEN
    PERFORM public.enqueue_doctor_profile(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER doctor_profile_changed AFTER INSERT OR UPDATE ON public.doctors
FOR EACH ROW EXECUTE FUNCTION public.queue_doctor_profile_on_change();

CREATE FUNCTION public.queue_doctor_profile_on_mix_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _doctor uuid;
BEGIN
  FOR _doctor IN SELECT id FROM public.doctors WHERE patient_data_linked
    AND consent_given_at IS NOT NULL AND doctor_id_code = NEW.doctor_id_code ORDER BY id
  LOOP PERFORM public.enqueue_doctor_profile(_doctor); END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER doctor_profile_mix_sync AFTER INSERT OR UPDATE ON public.patient_mix
FOR EACH ROW EXECUTE FUNCTION public.queue_doctor_profile_on_mix_sync();

CREATE FUNCTION public.claim_doctor_profile_job() RETURNS SETOF public.doctor_profile_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _job public.doctor_profile_jobs;
BEGIN
  -- Expire an abandoned third attempt, retaining an honest audit record.
  FOR _job IN SELECT * FROM public.doctor_profile_jobs WHERE status = 'processing'
    AND started_at < now() - interval '5 minutes' AND attempts >= 3 FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.doctor_profile_jobs SET status = 'failed', completed_at = now(), error_code = 'worker_lease_expired' WHERE id = _job.id;
    INSERT INTO public.audit_log(doctor, action, details) VALUES (_job.doctor, 'profiling_failed', jsonb_build_object('job_id', _job.id, 'error_code', 'worker_lease_expired'));
  END LOOP;
  SELECT * INTO _job FROM public.doctor_profile_jobs
    WHERE status = 'queued' OR (status = 'processing' AND started_at < now() - interval '5 minutes' AND attempts < 3)
    ORDER BY version FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.doctor_profile_jobs SET status = 'processing', attempts = attempts + 1,
    lease_token = gen_random_uuid(), started_at = now() WHERE id = _job.id RETURNING * INTO _job;
  INSERT INTO public.audit_log(doctor, action, details) VALUES (_job.doctor, 'profiling_started', jsonb_build_object('job_id', _job.id, 'attempt', _job.attempts));
  RETURN NEXT _job;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_doctor_profile_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_doctor_profile_job() TO service_role;

CREATE FUNCTION public.finish_doctor_profile_job(
  _id uuid, _lease uuid, _output jsonb, _error text, _model text, _prompt_version text, _schema_version text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _doctor uuid; _job public.doctor_profile_jobs; _status text;
BEGIN
  SELECT doctor INTO _doctor FROM public.doctor_profile_jobs WHERE id = _id;
  PERFORM 1 FROM public.doctors WHERE id = _doctor FOR UPDATE;
  SELECT * INTO _job FROM public.doctor_profile_jobs WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'superseded'; END IF;
  IF _job.status <> 'processing' OR _job.lease_token IS DISTINCT FROM _lease THEN
    INSERT INTO public.audit_log(doctor, action, details) VALUES (_doctor, 'profiling_discarded',
      jsonb_build_object('job_id', _id, 'model', _model, 'prompt_version', _prompt_version,
        'schema_version', _schema_version, 'reason', 'superseded_or_expired_lease'));
    RETURN 'superseded';
  END IF;
  IF _error IS NULL AND (_output IS NULL OR jsonb_typeof(_output) <> 'object'
    OR _output->'stated' IS DISTINCT FROM _job.input OR jsonb_typeof(_output->'suggested_focus') IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'invalid profile output';
  END IF;
  _status := CASE WHEN _error IS NULL THEN 'succeeded' ELSE 'failed' END;
  UPDATE public.doctor_profile_jobs SET status = _status, output = CASE WHEN _error IS NULL THEN _output ELSE NULL END,
    error_code = _error, completed_at = now(), model = _model, prompt_version = _prompt_version, schema_version = _schema_version WHERE id = _id;
  INSERT INTO public.audit_log(doctor, action, details) VALUES (_doctor, 'profiling_' || _status,
    jsonb_build_object('job_id', _id, 'model', _model, 'prompt_version', _prompt_version, 'schema_version', _schema_version, 'error_code', _error));
  RETURN _status;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_doctor_profile_job(uuid,uuid,jsonb,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_doctor_profile_job(uuid,uuid,jsonb,text,text,text,text) TO service_role;

CREATE FUNCTION public.confirm_doctor_profile(_id uuid, _focus jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _job public.doctor_profile_jobs;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  PERFORM 1 FROM public.doctors WHERE id = auth.uid() FOR UPDATE;
  SELECT * INTO _job FROM public.doctor_profile_jobs WHERE id = _id AND doctor = auth.uid() FOR UPDATE;
  IF NOT FOUND OR _job.status <> 'succeeded' THEN RAISE EXCEPTION 'profile not current or ready'; END IF;
  IF _job.confirmed_at IS NOT NULL THEN RETURN; END IF;
  IF jsonb_typeof(_focus) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid reviewed focus'; END IF;
  IF jsonb_array_length(_focus) > 6 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(_focus) f WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(_job.output->'suggested_focus') original WHERE original.value = f.value
    )
  ) THEN RAISE EXCEPTION 'unsupported reviewed focus'; END IF;
  UPDATE public.doctor_profile_jobs SET confirmed_at = now(), reviewed_focus = _focus WHERE id = _id;
  INSERT INTO public.audit_log(doctor, action, details) VALUES (auth.uid(), 'profiling_confirmed', jsonb_build_object('job_id', _id));
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_doctor_profile(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_doctor_profile(uuid,jsonb) TO authenticated;

CREATE FUNCTION public.retry_doctor_profile() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _latest public.doctor_profile_jobs;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  PERFORM 1 FROM public.doctors WHERE id = auth.uid() FOR UPDATE;
  SELECT * INTO _latest FROM public.doctor_profile_jobs WHERE doctor = auth.uid() ORDER BY version DESC LIMIT 1;
  IF FOUND AND _latest.status <> 'failed' THEN RAISE EXCEPTION 'only failed jobs can be retried'; END IF;
  IF FOUND AND _latest.created_at > now() - interval '1 minute' THEN RAISE EXCEPTION 'please wait before retrying'; END IF;
  PERFORM public.enqueue_doctor_profile(auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.retry_doctor_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_doctor_profile() TO authenticated;

-- Existing onboarded doctors also get an honest, newly queued profiling job.
DO $$ DECLARE _doctor uuid; BEGIN
  FOR _doctor IN SELECT id FROM public.doctors WHERE onboarding_complete ORDER BY id
  LOOP PERFORM public.enqueue_doctor_profile(_doctor); END LOOP;
END $$;
