// Admin insights — aggregated behavioural analytics. Protected by Supabase Auth JWT.
const { createClient } = require('@supabase/supabase-js');
const { verifyAdmin } = require('../_auth');

const DAY_MS = 86400000;

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Dashboard-Key, Authorization',
  };
}

// YYYY-MM-DD in the team's local timezone (Toronto) for day bucketing.
function dayKey(d) {
  return new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
}

// Ordered list of the last N local-day keys, oldest first.
function lastNDays(n) {
  const now = Date.now();
  const days = [];
  for (let i = n - 1; i >= 0; i--) days.push(dayKey(now - i * DAY_MS));
  return days;
}

// Bucket rows (with created_at) into the last N local days -> [{date, count}].
function dailyBreakdown(rows, n) {
  const buckets = {};
  for (const key of lastNDays(n)) buckets[key] = 0;
  for (const r of rows || []) {
    const key = dayKey(r.created_at);
    if (key in buckets) buckets[key] += 1;
  }
  return Object.keys(buckets).map((date) => ({ date, count: buckets[date] }));
}

// Page through a filtered table read so aggregations aren't capped at 1000 rows.
async function fetchRows(supabase, table, columns, applyFilters) {
  const pageSize = 1000;
  const all = [];
  let from = 0;
  for (;;) {
    let q = supabase.from(table).select(columns);
    if (applyFilters) q = applyFilters(q);
    const { data, error } = await q.range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function countRows(supabase, table, applyFilters) {
  let q = supabase.from(table).select('*', { count: 'exact', head: true });
  if (applyFilters) q = applyFilters(q);
  const { count, error } = await q;
  if (error) throw error;
  return count || 0;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, cors()); return res.end(); }

  if (req.method !== 'GET') {
    res.writeHead(405, { ...cors(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  const user = await verifyAdmin(req);
  if (!user) {
    res.writeHead(401, { ...cors(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Unauthorized' }));
  }

  const supabase = createClient(
    process.env.SUPABASE_URL.trim(),
    process.env.SUPABASE_SERVICE_KEY.trim()
  );

  try {
    // Window: accept ?days=7|30, default 7.
    let days = 7;
    try {
      const parsed = parseInt(new URL(req.url, 'http://localhost').searchParams.get('days'), 10);
      if (parsed === 30) days = 30;
    } catch { /* default window */ }
    const sinceISO = new Date(Date.now() - days * DAY_MS).toISOString();

    // --- Most viewed properties (window) ---------------------------------
    // Ordered newest-first so the first title we see per property is the latest.
    const propEvents = await fetchRows(
      supabase,
      'events',
      'session_id, data, created_at',
      (q) => q.eq('type', 'property_view').gte('created_at', sinceISO).order('created_at', { ascending: false })
    );
    const propMap = {};
    for (const e of propEvents) {
      const d = e.data || {};
      const id = d.propertyId;
      if (!id) continue;
      if (!propMap[id]) propMap[id] = { propertyId: id, title: d.title || null, views: 0, sessions: new Set() };
      const p = propMap[id];
      p.views += 1;
      if (e.session_id) p.sessions.add(e.session_id);
      if (!p.title && d.title) p.title = d.title;
    }
    const mostViewedProperties = Object.values(propMap)
      .map((p) => ({ propertyId: p.propertyId, title: p.title, views: p.views, uniqueSessions: p.sessions.size }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 10);

    // --- Search volume + daily breakdown ---------------------------------
    const searchEvents = await fetchRows(
      supabase,
      'events',
      'created_at',
      (q) => q.eq('type', 'search').gte('created_at', sinceISO)
    );
    const searchVolume = searchEvents.length;
    const searchByDay = dailyBreakdown(searchEvents, 7);

    // --- Traffic sources (window) ----------------------------------------
    const pageViewEvents = await fetchRows(
      supabase,
      'events',
      'data',
      (q) => q.eq('type', 'page_view').gte('created_at', sinceISO)
    );
    const srcCounts = {};
    for (const e of pageViewEvents) {
      const src = (e.data && e.data.trafficSource) || 'direct';
      srcCounts[src] = (srcCounts[src] || 0) + 1;
    }
    const trafficSources = Object.entries(srcCounts)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);

    // --- Funnel (all-time snapshot) --------------------------------------
    const [visitors, engaged, identified, hot] = await Promise.all([
      countRows(supabase, 'visitors'),
      countRows(supabase, 'visitors', (q) => q.gte('score', 40)),
      countRows(supabase, 'leads'),
      countRows(supabase, 'leads', (q) => q.eq('temperature', 'hot')),
    ]);
    const funnel = { visitors, engaged, identified, hot };

    // --- Leads by type + by day (window; daily = last 7) -----------------
    const windowLeads = await fetchRows(
      supabase,
      'leads',
      'type, created_at',
      (q) => q.gte('created_at', sinceISO)
    );
    const typeCounts = {};
    for (const l of windowLeads) {
      const t = l.type || 'other';
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    }
    const leadsByType = Object.entries(typeCounts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
    const leadsByDay = dailyBreakdown(windowLeads, 7);

    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      insights: {
        window: { days, since: sinceISO },
        mostViewedProperties,
        searchVolume,
        searchByDay,
        trafficSources,
        funnel,
        leadsByType,
        leadsByDay,
      },
    }));
  } catch (err) {
    console.error('[insights]', err?.message || err);
    res.writeHead(500, { ...cors(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
