-- DOCTORS
CREATE TABLE public.doctors (
  id uuid PRIMARY KEY,
  full_name text,
  years_in_practice integer CHECK (years_in_practice IS NULL OR (years_in_practice >= 0 AND years_in_practice <= 80)),
  practice_setting text,
  specialty text,
  cancer_types text[] NOT NULL DEFAULT '{}',
  topics text[] NOT NULL DEFAULT '{}',
  preferred_format text,
  frequency text,
  doctor_id_code text,
  patient_data_linked boolean NOT NULL DEFAULT false,
  consent_given_at timestamptz,
  onboarding_complete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.doctors TO authenticated;
GRANT ALL ON public.doctors TO service_role;
ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Doctors read own row" ON public.doctors FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Doctors insert own row" ON public.doctors FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "Doctors update own row" ON public.doctors FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- Link fields can only change through the link/unlink functions
CREATE OR REPLACE FUNCTION public.doctors_guard_link_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_setting('msl.link_change', true) IS DISTINCT FROM 'on' THEN
    NEW.doctor_id_code := OLD.doctor_id_code;
    NEW.patient_data_linked := OLD.patient_data_linked;
    NEW.consent_given_at := OLD.consent_given_at;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER doctors_guard BEFORE UPDATE ON public.doctors
FOR EACH ROW EXECUTE FUNCTION public.doctors_guard_link_fields();

CREATE OR REPLACE FUNCTION public.handle_new_doctor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.doctors (id) VALUES (NEW.id) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created_doctor AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_doctor();

-- PATIENT MIX
CREATE TABLE public.patient_mix (
  doctor_id_code text PRIMARY KEY,
  synced_at timestamptz NOT NULL DEFAULT now(),
  aggregates jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT ON public.patient_mix TO authenticated;
GRANT ALL ON public.patient_mix TO service_role;
ALTER TABLE public.patient_mix ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Doctors read their linked patient mix" ON public.patient_mix FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.doctors d WHERE d.id = auth.uid() AND d.patient_data_linked AND d.doctor_id_code = patient_mix.doctor_id_code));

-- NEWSLETTERS
CREATE TABLE public.newsletters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  title text NOT NULL,
  summary text NOT NULL DEFAULT ''
);
CREATE INDEX newsletters_doctor_idx ON public.newsletters(doctor, sent_at DESC);
GRANT SELECT ON public.newsletters TO authenticated;
GRANT ALL ON public.newsletters TO service_role;
ALTER TABLE public.newsletters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Doctors read own newsletters" ON public.newsletters FOR SELECT TO authenticated USING (doctor = auth.uid());

-- ARTICLES
CREATE TABLE public.articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  newsletter uuid NOT NULL REFERENCES public.newsletters(id) ON DELETE CASCADE,
  title text NOT NULL,
  cancer_type text NOT NULL,
  short_summary text NOT NULL DEFAULT '',
  full_summary text NOT NULL DEFAULT '',
  covers_text text NOT NULL DEFAULT '',
  not_covers_text text NOT NULL DEFAULT '',
  applicability_percent numeric CHECK (applicability_percent IS NULL OR (applicability_percent >= 0 AND applicability_percent <= 100)),
  position integer NOT NULL DEFAULT 0
);
CREATE INDEX articles_newsletter_idx ON public.articles(newsletter, position);
GRANT SELECT ON public.articles TO authenticated;
GRANT ALL ON public.articles TO service_role;
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Doctors read own articles" ON public.articles FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.newsletters n WHERE n.id = articles.newsletter AND n.doctor = auth.uid()));

-- CITATIONS
CREATE TABLE public.citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article uuid NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  number integer NOT NULL,
  source_name text NOT NULL,
  title text NOT NULL,
  published_date date,
  url text NOT NULL,
  UNIQUE (article, number)
);
GRANT SELECT ON public.citations TO authenticated;
GRANT ALL ON public.citations TO service_role;
ALTER TABLE public.citations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Doctors read own citations" ON public.citations FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.articles a JOIN public.newsletters n ON n.id = a.newsletter WHERE a.id = citations.article AND n.doctor = auth.uid()));

-- AUDIT LOG (append-only)
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('onboarding_completed','profile_updated','patient_data_linked','patient_data_unlinked','bookmark_added','bookmark_removed','article_opened')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_doctor_idx ON public.audit_log(doctor, created_at DESC);
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT SELECT, INSERT ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Doctors read own audit log" ON public.audit_log FOR SELECT TO authenticated USING (doctor = auth.uid());
CREATE POLICY "Doctors append own audit log" ON public.audit_log FOR INSERT TO authenticated WITH CHECK (doctor = auth.uid());

CREATE OR REPLACE FUNCTION public.audit_log_block_changes()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION public.audit_log_block_changes();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON public.audit_log
FOR EACH STATEMENT EXECUTE FUNCTION public.audit_log_block_changes();

-- BOOKMARKS
CREATE TABLE public.bookmarks (
  doctor uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  article uuid NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (doctor, article)
);
GRANT SELECT, INSERT, DELETE ON public.bookmarks TO authenticated;
GRANT ALL ON public.bookmarks TO service_role;
ALTER TABLE public.bookmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Doctors read own bookmarks" ON public.bookmarks FOR SELECT TO authenticated USING (doctor = auth.uid());
CREATE POLICY "Doctors add own bookmarks" ON public.bookmarks FOR INSERT TO authenticated
WITH CHECK (doctor = auth.uid() AND EXISTS (SELECT 1 FROM public.articles a JOIN public.newsletters n ON n.id = a.newsletter WHERE a.id = bookmarks.article AND n.doctor = auth.uid()));
CREATE POLICY "Doctors remove own bookmarks" ON public.bookmarks FOR DELETE TO authenticated USING (doctor = auth.uid());

CREATE OR REPLACE FUNCTION public.bookmarks_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log (doctor, action, details) VALUES (NEW.doctor, 'bookmark_added', jsonb_build_object('article', NEW.article));
    RETURN NEW;
  ELSE
    INSERT INTO public.audit_log (doctor, action, details) VALUES (OLD.doctor, 'bookmark_removed', jsonb_build_object('article', OLD.article));
    RETURN OLD;
  END IF;
END;
$$;
CREATE TRIGGER bookmarks_audit_trg AFTER INSERT OR DELETE ON public.bookmarks
FOR EACH ROW EXECUTE FUNCTION public.bookmarks_audit();

-- SAMPLE NEWSLETTER (placeholder content, applicability taken from the doctor's own aggregates)
CREATE OR REPLACE FUNCTION public.seed_sample_newsletter(_doctor uuid, _code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _agg jsonb;
  _nl uuid;
  _art uuid;
  _rec record;
  _ph constant text := 'Placeholder summary – to be replaced';
BEGIN
  IF _code <> 'DR-1001' THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.newsletters WHERE doctor = _doctor AND title = 'ESMO 2026: what''s new in lung cancer') THEN RETURN; END IF;
  SELECT aggregates INTO _agg FROM public.patient_mix WHERE doctor_id_code = _code;

  INSERT INTO public.newsletters (doctor, title, summary)
  VALUES (_doctor, 'ESMO 2026: what''s new in lung cancer', _ph || '. Four lung cancer readouts from ESMO 2026, matched against your patient mix.')
  RETURNING id INTO _nl;

  FOR _rec IN
    SELECT * FROM (VALUES
      (1, 'DeLLphi-305: tarlatamab in extensive-stage SCLC maintenance', 'SCLC', 'SCLC'),
      (2, 'Krascendo 1: divarasib in previously treated KRAS G12C NSCLC', 'NSCLC', 'KRAS G12C'),
      (3, 'SAFFRON: osimertinib plus savolitinib after osimertinib resistance', 'NSCLC', 'Post-osimertinib'),
      (4, 'OptiTROP-Lung06: sac-TMT plus pembrolizumab in PD-L1-negative NSCLC', 'NSCLC', 'PD-L1 negative')
    ) AS t(pos, title, ctype, agg_key)
  LOOP
    INSERT INTO public.articles (newsletter, title, cancer_type, short_summary, full_summary, covers_text, not_covers_text, applicability_percent, position)
    VALUES (
      _nl, _rec.title, _rec.ctype,
      _ph || '. This card will carry a two-line overview of the trial and what it may mean for your practice once the content is written.',
      _ph || '. Trial design and population will be described here. [1]' || E'\n\n' || _ph || '. Key findings will be described here, without numbers until they are verified. [2]' || E'\n\n' || _ph || '. What this could mean for practice will be described here. [1]',
      _ph || '. The patients this evidence applies to will be described here. [1]',
      _ph || '. The patients outside this evidence will be described here. [2]',
      CASE WHEN _agg ? _rec.agg_key THEN (_agg ->> _rec.agg_key)::numeric ELSE NULL END,
      _rec.pos
    ) RETURNING id INTO _art;

    INSERT INTO public.citations (article, number, source_name, title, published_date, url) VALUES
      (_art, 1, 'Placeholder source', 'Placeholder citation 1 – to be replaced', DATE '2026-10-17', 'https://www.esmo.org/meeting-calendar'),
      (_art, 2, 'Placeholder source', 'Placeholder citation 2 – to be replaced', DATE '2026-10-18', 'https://www.esmo.org/meeting-calendar');
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.seed_sample_newsletter(uuid, text) FROM PUBLIC, anon, authenticated;

-- LINK / UNLINK
CREATE OR REPLACE FUNCTION public.link_patient_data(_code text, _consent boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _norm text := upper(trim(_code));
  _mix public.patient_mix;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT coalesce(_consent, false) THEN RAISE EXCEPTION 'consent required'; END IF;
  IF _norm IS NULL OR length(_norm) = 0 OR length(_norm) > 40 THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  SELECT * INTO _mix FROM public.patient_mix WHERE doctor_id_code = _norm;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  INSERT INTO public.doctors (id) VALUES (_uid) ON CONFLICT (id) DO NOTHING;
  PERFORM set_config('msl.link_change', 'on', true);
  UPDATE public.doctors SET doctor_id_code = _norm, patient_data_linked = true, consent_given_at = now() WHERE id = _uid;
  PERFORM set_config('msl.link_change', 'off', true);

  INSERT INTO public.audit_log (doctor, action, details) VALUES (_uid, 'patient_data_linked', jsonb_build_object('doctor_id_code', _norm));
  PERFORM public.seed_sample_newsletter(_uid, _norm);

  RETURN jsonb_build_object('found', true, 'doctor_id_code', _norm, 'synced_at', _mix.synced_at, 'aggregates', _mix.aggregates);
END;
$$;
REVOKE ALL ON FUNCTION public.link_patient_data(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_patient_data(text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.unlink_patient_data()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _old text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT doctor_id_code INTO _old FROM public.doctors WHERE id = _uid;
  PERFORM set_config('msl.link_change', 'on', true);
  UPDATE public.doctors SET doctor_id_code = NULL, patient_data_linked = false, consent_given_at = NULL WHERE id = _uid;
  PERFORM set_config('msl.link_change', 'off', true);
  INSERT INTO public.audit_log (doctor, action, details) VALUES (_uid, 'patient_data_unlinked', jsonb_build_object('doctor_id_code', _old));
END;
$$;
REVOKE ALL ON FUNCTION public.unlink_patient_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unlink_patient_data() TO authenticated;

-- SEED patient mix
INSERT INTO public.patient_mix (doctor_id_code, synced_at, aggregates) VALUES (
  'DR-1001', now() - interval '2 days',
  '{"NSCLC": 85, "SCLC": 15, "EGFR-mutant": 20, "Post-osimertinib": 7, "KRAS G12C": 12, "ALK-positive": 4, "PD-L1 ≥50%": 25, "PD-L1 negative": 30, "Stage IV": 60}'::jsonb
);