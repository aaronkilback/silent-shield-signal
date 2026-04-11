-- Academy Training Sessions
-- Tracks the structured training course between pre-test and post-test

CREATE TABLE IF NOT EXISTS public.academy_training_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id         uuid NOT NULL,
  agent_call_sign   text NOT NULL,
  domain            text NOT NULL,

  -- Pre-test context passed in so agent can tailor teaching
  pre_score         numeric(4,3),
  pre_choice        text,       -- which option learner chose
  pre_is_optimal    boolean,

  -- Session tracking
  status            text NOT NULL DEFAULT 'active',  -- active | completed
  message_count     int NOT NULL DEFAULT 0,           -- number of learner messages sent
  phases_visited    text[] DEFAULT '{}',

  -- Opening debrief generated from agent knowledge
  opening_message   text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  last_message_at   timestamptz,
  completed_at      timestamptz,

  CONSTRAINT academy_training_sessions_user_course UNIQUE (user_id, course_id)
);

CREATE INDEX IF NOT EXISTS academy_training_sessions_user_idx ON public.academy_training_sessions (user_id);
CREATE INDEX IF NOT EXISTS academy_training_sessions_course_idx ON public.academy_training_sessions (course_id);

ALTER TABLE public.academy_training_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own training sessions"
  ON public.academy_training_sessions FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Admins view all training sessions"
  ON public.academy_training_sessions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role IN ('admin', 'super_admin')
    )
  );
