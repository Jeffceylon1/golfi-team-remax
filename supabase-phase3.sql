-- Phase 3: nurture sequence tracking
CREATE TABLE IF NOT EXISTS nurture_log (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id     uuid REFERENCES leads(id) ON DELETE CASCADE,
  email       text NOT NULL,
  step        integer NOT NULL DEFAULT 0,
  last_sent_at timestamptz,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','stopped')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_nurture_email ON nurture_log(email);
CREATE INDEX IF NOT EXISTS idx_nurture_status ON nurture_log(status);

ALTER TABLE nurture_log ENABLE ROW LEVEL SECURITY;

-- Digest send audit (so we never double-send in a day)
CREATE TABLE IF NOT EXISTS digest_log (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  sent_for   date NOT NULL UNIQUE,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  summary    jsonb DEFAULT '{}'
);

ALTER TABLE digest_log ENABLE ROW LEVEL SECURITY;
