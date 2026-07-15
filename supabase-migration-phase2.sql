-- Phase 2: Visitor intelligence columns
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS score          integer DEFAULT 0;
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS temperature    text DEFAULT 'cold';
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS session_count  integer DEFAULT 1;
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS total_seconds  integer DEFAULT 0;
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS page_views     integer DEFAULT 0;
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS traffic_source text;
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS landing_page   text;
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS current_page   text;
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS name           text;
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS email          text;
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS score_breakdown jsonb DEFAULT '{}';

-- Indexes for dashboard queries
CREATE INDEX IF NOT EXISTS idx_visitors_score     ON visitors(score DESC);
CREATE INDEX IF NOT EXISTS idx_visitors_last_seen ON visitors(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_visitors_temp      ON visitors(temperature);
