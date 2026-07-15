-- Config-driven settings store: one JSONB row per config category.
CREATE TABLE IF NOT EXISTS settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically; this policy allows authenticated admin reads.
DROP POLICY IF EXISTS settings_auth_read ON settings;
CREATE POLICY settings_auth_read ON settings FOR SELECT TO authenticated USING (true);
