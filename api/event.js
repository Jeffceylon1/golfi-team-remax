const { createClient } = require('@supabase/supabase-js');

// Threshold constants
const PROPERTY_VIEW_THRESHOLD = 3;   // same propertyId viewed N+ times → property_save
const SEARCH_THRESHOLD = 2;           // N+ search events → search_alert
const PAGE_VIEW_THRESHOLD = 5;        // N+ page_view events in session
const SESSION_COUNT_THRESHOLD = 2;    // N+ total sessions seen → return_visitor

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

/**
 * Analyse the accumulated events array for a session and return
 * the first threshold that is triggered.
 *
 * @param {Array<{type:string, data:object, created_at:string}>} events
 * @param {number} sessionCount  Number of distinct sessions seen for this visitor
 * @returns {{ shouldCaptureLead: boolean, captureType: string|null }}
 */
function checkThresholds(events, sessionCount) {
  if (!Array.isArray(events) || events.length === 0) {
    return { shouldCaptureLead: false, captureType: null };
  }

  // 1. Property view threshold: 3+ views of the same propertyId
  const propertyViewCounts = {};
  for (const ev of events) {
    if (ev.type === 'property_view' && ev.data?.propertyId) {
      const pid = String(ev.data.propertyId);
      propertyViewCounts[pid] = (propertyViewCounts[pid] || 0) + 1;
    }
  }
  for (const count of Object.values(propertyViewCounts)) {
    if (count >= PROPERTY_VIEW_THRESHOLD) {
      return { shouldCaptureLead: true, captureType: 'property_save' };
    }
  }

  // 2. Search threshold: 2+ search events
  const searchCount = events.filter((ev) => ev.type === 'search').length;
  if (searchCount >= SEARCH_THRESHOLD) {
    return { shouldCaptureLead: true, captureType: 'search_alert' };
  }

  // 3. Return visitor: 5+ page views AND 2+ sessions
  const pageViewCount = events.filter((ev) => ev.type === 'page_view').length;
  if (pageViewCount >= PAGE_VIEW_THRESHOLD && (sessionCount || 1) >= SESSION_COUNT_THRESHOLD) {
    return { shouldCaptureLead: true, captureType: 'return_visitor' };
  }

  return { shouldCaptureLead: false, captureType: null };
}

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, corsHeaders());
    return res.end();
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { ...corsHeaders(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    res.writeHead(400, { ...corsHeaders(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Invalid JSON' }));
  }

  const { sessionId, type, data } = body || {};

  if (!sessionId || !type) {
    res.writeHead(400, { ...corsHeaders(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'sessionId and type are required' }));
  }

  try {
    const now = new Date().toISOString();
    const newEvent = { type, data: data || {}, created_at: now };

    // Fetch existing visitor row so we can append to its events array
    const { data: existing, error: fetchErr } = await supabase
      .from('visitors')
      .select('id, events, session_count, first_seen')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;

    const existingEvents = Array.isArray(existing?.events) ? existing.events : [];
    const updatedEvents = [...existingEvents, newEvent];
    const sessionCount = existing?.session_count ?? 1;

    // Upsert visitor row with appended event and updated last_seen
    const { error: visitorErr } = await supabase.from('visitors').upsert(
      {
        session_id: sessionId,
        events: updatedEvents,
        last_seen: now,
        first_seen: existing?.first_seen ?? now,
        session_count: sessionCount,
      },
      { onConflict: 'session_id' }
    );

    if (visitorErr) throw visitorErr;

    // Also insert a row in the events table for queryability
    const { error: eventInsertErr } = await supabase.from('events').insert({
      session_id: sessionId,
      type,
      data: data || {},
    });

    if (eventInsertErr) throw eventInsertErr;

    // Evaluate thresholds against the full updated event history
    const { shouldCaptureLead, captureType } = checkThresholds(
      updatedEvents,
      sessionCount
    );

    res.writeHead(200, { ...corsHeaders(), 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({ success: true, shouldCaptureLead, captureType })
    );
  } catch (err) {
    console.error('[event] error:', err?.message || err);
    res.writeHead(500, { ...corsHeaders(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
