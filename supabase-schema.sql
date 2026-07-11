-- ============================================================
-- Golfi Team RE/MAX — Supabase Schema
-- Run this in the Supabase SQL editor (database → SQL editor)
-- ============================================================

-- Required extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLE: visitors
-- Tracks anonymous sessions, page views, and raw events
-- ============================================================
CREATE TABLE IF NOT EXISTS visitors (
    id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id  text UNIQUE NOT NULL,
    pages       jsonb NOT NULL DEFAULT '[]',
    events      jsonb NOT NULL DEFAULT '[]',
    first_seen  timestamptz NOT NULL DEFAULT now(),
    last_seen   timestamptz NOT NULL DEFAULT now(),
    ip          text,
    user_agent  text
);

-- ============================================================
-- TABLE: leads
-- Captured leads from chat, property saves, valuations, etc.
-- ============================================================
CREATE TABLE IF NOT EXISTS leads (
    id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id  text,
    name        text,
    email       text,
    phone       text,
    type        text NOT NULL CHECK (type IN ('chat','property_save','valuation','search_alert','viewing','market_report')),
    data        jsonb NOT NULL DEFAULT '{}',
    temperature text NOT NULL DEFAULT 'warm' CHECK (temperature IN ('hot','warm','cold')),
    source      text,
    notes       text,
    status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','qualified','closed')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- TABLE: messages
-- Full chat history per session for Claude context window
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
    id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id  text NOT NULL,
    role        text NOT NULL CHECK (role IN ('user','assistant')),
    content     text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- TABLE: events
-- Structured behavioural events (page_view, search, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS events (
    id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id  text NOT NULL,
    type        text NOT NULL,
    data        jsonb NOT NULL DEFAULT '{}',
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- leads — newest-first listing, email lookup, session join
CREATE INDEX IF NOT EXISTS idx_leads_created_at    ON leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_email         ON leads (email);
CREATE INDEX IF NOT EXISTS idx_leads_session_id    ON leads (session_id);

-- messages — ordered history per session
CREATE INDEX IF NOT EXISTS idx_messages_session    ON messages (session_id, created_at);

-- events — ordered stream per session
CREATE INDEX IF NOT EXISTS idx_events_session      ON events (session_id, created_at);

-- visitors — session lookup
CREATE INDEX IF NOT EXISTS idx_visitors_session_id ON visitors (session_id);

-- ============================================================
-- ROW-LEVEL SECURITY
-- All tables locked down; service role bypasses RLS entirely
-- ============================================================

ALTER TABLE visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE events   ENABLE ROW LEVEL SECURITY;

-- Deny everything for anonymous/authenticated roles by default.
-- The API functions use the service role key which bypasses RLS,
-- so no additional policies are needed for server-side access.

-- ============================================================
-- FUNCTION + TRIGGER: auto-update leads.updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads;
CREATE TRIGGER trg_leads_updated_at
    BEFORE UPDATE ON leads
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
