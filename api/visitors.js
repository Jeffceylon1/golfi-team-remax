const { createClient } = require('@supabase/supabase-js');
const { verifyAdmin } = require('./_auth');

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Dashboard-Key, Authorization',
  };
}

// Columns returned for the live / anon visitor lists.
const LIST_COLUMNS =
  'session_id, score, temperature, session_count, page_views, total_seconds, ' +
  'current_page, landing_page, traffic_source, last_seen, name, email';

const LIVE_WINDOW_MS = 5 * 60 * 1000;            // "on the site now" = last 5 minutes
const ANON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;  // high-intent anon = last 7 days
const ANON_MIN_SCORE = 40;
const ANON_LIMIT = 50;

// Visitors seen within the last 5 minutes, hottest first.
async function fetchLive(supabase) {
  const since = new Date(Date.now() - LIVE_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from('visitors')
    .select(LIST_COLUMNS)
    .gte('last_seen', since)
    .order('score', { ascending: false });
  if (error) throw error;
  return data || [];
}

// High-intent anonymous sessions: score >= 40, no email captured, active in last 7 days.
async function fetchAnon(supabase) {
  const since = new Date(Date.now() - ANON_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from('visitors')
    .select(LIST_COLUMNS)
    .gte('score', ANON_MIN_SCORE)
    .is('email', null)
    .gte('last_seen', since)
    .order('score', { ascending: false })
    .limit(ANON_LIMIT);
  if (error) throw error;
  return data || [];
}

// Full ordered event trail + visitor row for a single session (lead-journey drill-down).
async function fetchJourney(supabase, sessionId) {
  const [eventsRes, visitorRes] = await Promise.all([
    supabase
      .from('events')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true }),
    supabase
      .from('visitors')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle(),
  ]);

  if (eventsRes.error) throw eventsRes.error;
  if (visitorRes.error) throw visitorRes.error;

  return { visitor: visitorRes.data || null, events: eventsRes.data || [] };
}

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, corsHeaders());
    return res.end();
  }

  if (req.method !== 'GET') {
    res.writeHead(405, { ...corsHeaders(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  // Dashboard auth — allow a valid dashboard key OR a valid admin JWT.
  const dashboardKey = (process.env.DASHBOARD_KEY || '').trim();
  const providedKey = (req.headers['x-dashboard-key'] || '').trim();
  const keyOk = !!dashboardKey && !!providedKey && providedKey === dashboardKey;
  const user  = keyOk ? null : await verifyAdmin(req).catch(function () { return null; });

  if (!keyOk && !user) {
    // Neither auth method valid. Preserve the 503 signal when the key isn't configured.
    if (!dashboardKey) {
      res.writeHead(503, { ...corsHeaders(), 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Dashboard auth not configured' }));
    }
    res.writeHead(401, { ...corsHeaders(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Unauthorized' }));
  }

  const supabase = createClient(
    process.env.SUPABASE_URL.trim(),
    process.env.SUPABASE_SERVICE_KEY.trim()
  );

  try {
    // Parse the query string off req.url (base host is irrelevant, just for the parser).
    const query = new URL(req.url, 'http://localhost').searchParams;
    const view = (query.get('view') || '').trim();

    let payload;

    if (view === 'live') {
      payload = { live: await fetchLive(supabase) };
    } else if (view === 'anon') {
      payload = { anon: await fetchAnon(supabase) };
    } else if (view === 'journey') {
      const sessionId = (query.get('session') || '').trim();
      if (!sessionId) {
        res.writeHead(400, { ...corsHeaders(), 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'session is required for journey view' }));
      }
      payload = await fetchJourney(supabase, sessionId);
    } else {
      // Default: load both lists so the dashboard can hydrate in one request.
      const [live, anon] = await Promise.all([fetchLive(supabase), fetchAnon(supabase)]);
      payload = { live, anon };
    }

    res.writeHead(200, { ...corsHeaders(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(payload));
  } catch (err) {
    console.error('[visitors]', err?.message || err);
    res.writeHead(500, { ...corsHeaders(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
