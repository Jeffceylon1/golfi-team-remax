const { createClient } = require('@supabase/supabase-js');
const { computeScore, aggregateEvents } = require('./_score');

// Capture thresholds — built-in fallbacks used only when `hooks` settings are unset
const PROPERTY_VIEW_THRESHOLD = 3; // same propertyId viewed N+ times -> property_save
const SEARCH_THRESHOLD = 2;        // N+ search events -> search_alert
const RECAPTURE_SCORE = 70;        // score >= N (no email yet) -> smart_recapture

function numOr(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// Load owner-configured scoring weights + capture hooks from the database.
// Missing/failed reads return nulls so callers fall back to built-in defaults.
async function loadSettings(supabase) {
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', ['scoring', 'hooks']);
    if (error) throw error;
    const map = {};
    for (const row of data || []) map[row.key] = row.value || {};
    return { scoring: map.scoring || null, hooks: map.hooks || null };
  } catch (err) {
    console.error('[event] loadSettings:', err?.message || err);
    return { scoring: null, hooks: null };
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

/**
 * Tally property_view events by real propertyId (missing ids are ignored),
 * tracking the most recent known title per property.
 * @param {Array<{type:string,data:object}>} events
 */
function propertyStats(events) {
  const counts = {};
  const titles = {};
  for (const e of events || []) {
    if (e.type !== 'property_view') continue;
    const d = e.data || {};
    const id = d.propertyId;
    if (!id) continue;
    counts[id] = (counts[id] || 0) + 1;
    if (d.title) titles[id] = d.title;
  }
  let topId = null;
  let topCount = 0;
  for (const [id, c] of Object.entries(counts)) {
    if (c > topCount) {
      topCount = c;
      topId = id;
    }
  }
  return { counts, titles, topId, topCount };
}

/**
 * True if this session already has a captured email (visitor row or leads table).
 */
async function sessionHasEmail(supabase, sessionId, existing) {
  if (existing && existing.email && String(existing.email).trim() !== '') return true;
  const { data, error } = await supabase
    .from('leads')
    .select('email')
    .eq('session_id', sessionId)
    .limit(50);
  if (error) throw error;
  return (data || []).some((l) => l.email && String(l.email).trim() !== '');
}

/**
 * Decide whether the widget should prompt for a lead, and how.
 * Thresholds and enabled flags come from the owner-configured `hooks` settings,
 * falling back to built-in defaults when unset. A disabled hook is never suggested.
 * Precedence: property_save > search_alert > smart_recapture > none.
 */
async function decideCapture(supabase, sessionId, events, score, existing, hooks) {
  const h = hooks || {};
  const propertySave = h.propertySave || {};
  const searchAlert = h.searchAlert || {};
  const smartRecapture = h.smartRecapture || {};

  // A hook is active unless the owner explicitly disabled it.
  const propEnabled = propertySave.enabled !== false;
  const searchEnabled = searchAlert.enabled !== false;
  const recaptureEnabled = smartRecapture.enabled !== false;

  const propThreshold = numOr(propertySave.threshold, PROPERTY_VIEW_THRESHOLD);
  const searchThreshold = numOr(searchAlert.threshold, SEARCH_THRESHOLD);
  const recaptureThreshold = numOr(smartRecapture.scoreThreshold, RECAPTURE_SCORE);

  const { titles, topId, topCount } = propertyStats(events);
  const searchCount = (events || []).filter((e) => e.type === 'search').length;

  const topProperty = topId
    ? { propertyId: topId, title: titles[topId] || null, views: topCount }
    : null;

  if (propEnabled && topCount >= propThreshold) {
    return { shouldCaptureLead: true, captureType: 'property_save', topProperty };
  }

  if (searchEnabled && searchCount >= searchThreshold) {
    return { shouldCaptureLead: true, captureType: 'search_alert', topProperty: null };
  }

  if (recaptureEnabled && score >= recaptureThreshold) {
    const hasEmail = await sessionHasEmail(supabase, sessionId, existing);
    if (!hasEmail) {
      return { shouldCaptureLead: true, captureType: 'smart_recapture', topProperty };
    }
  }

  return { shouldCaptureLead: false, captureType: null, topProperty: null };
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

  // Body may arrive as a string or an already-parsed object
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

  const evData = data || {};

  const supabase = createClient(
    process.env.SUPABASE_URL.trim(),
    process.env.SUPABASE_SERVICE_KEY.trim()
  );

  try {
    const now = new Date().toISOString();

    // 1. Persist the raw event
    const { error: insertErr } = await supabase
      .from('events')
      .insert({ session_id: sessionId, type, data: evData });
    if (insertErr) throw insertErr;

    // 2. Load the full event history for this session (includes the row above)
    const { data: eventRows, error: eventsErr } = await supabase
      .from('events')
      .select('type,data,created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(500);
    if (eventsErr) throw eventsErr;
    const events = Array.isArray(eventRows) ? eventRows : [];

    // 3. Read the current visitor row (for session_count + first-set fields)
    const { data: existing, error: fetchErr } = await supabase
      .from('visitors')
      .select('session_count, first_seen, landing_page, traffic_source, name, email')
      .eq('session_id', sessionId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;

    // 4. Session count: increment on session_start or a brand-new visitor
    const prevCount = existing?.session_count ?? 0;
    let sessionCount;
    if (type === 'session_start' || !existing) {
      sessionCount = (prevCount || 0) + 1;
    } else {
      sessionCount = prevCount || 1;
    }
    if (sessionCount < 1) sessionCount = 1;

    // 5. Load owner config, then aggregate + score (pure math, no LLM)
    const { scoring, hooks } = await loadSettings(supabase);
    const stats = aggregateEvents(events, sessionCount);
    const { score, temperature, breakdown } = computeScore(stats, scoring || undefined);

    // 6. Build the visitor upsert
    const visitorRow = {
      session_id: sessionId,
      last_seen: now,
      score,
      temperature,
      session_count: sessionCount,
      total_seconds: stats.totalSeconds,
      page_views: stats.pageViews,
      score_breakdown: breakdown,
    };

    const currentPage = evData.url || evData.path;
    if (currentPage) visitorRow.current_page = currentPage;

    // Set first_seen / landing_page / traffic_source only when not already set
    if (!existing || !existing.first_seen) visitorRow.first_seen = now;
    if ((!existing || !existing.landing_page) && evData.landingPage) {
      visitorRow.landing_page = evData.landingPage;
    }
    if ((!existing || !existing.traffic_source) && evData.trafficSource) {
      visitorRow.traffic_source = evData.trafficSource;
    }

    const { error: upsertErr } = await supabase
      .from('visitors')
      .upsert(visitorRow, { onConflict: 'session_id' });
    if (upsertErr) throw upsertErr;

    // 7. Capture decision
    const { shouldCaptureLead, captureType, topProperty } = await decideCapture(
      supabase,
      sessionId,
      events,
      score,
      existing,
      hooks
    );

    res.writeHead(200, { ...corsHeaders(), 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        success: true,
        score,
        temperature,
        shouldCaptureLead,
        captureType,
        topProperty,
      })
    );
  } catch (err) {
    console.error('[event]', err?.message || err);
    res.writeHead(500, { ...corsHeaders(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
