// Admin conversations — chat transcript for a session, or a list of recent
// distinct chat sessions. Protected by Supabase Auth JWT.
const { createClient } = require('@supabase/supabase-js');
const { verifyAdmin } = require('../_auth');

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

// Cap on how many recent messages we scan to derive the distinct-session list.
const SCAN_CAP = 5000;
const PAGE_SIZE = 1000;
const SESSION_LIMIT = 30;

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, cors()); return res.end(); }

  const user = await verifyAdmin(req);
  if (!user) {
    res.writeHead(401, { ...cors(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Unauthorized' }));
  }

  if (req.method !== 'GET') {
    res.writeHead(405, { ...cors(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  const supabase = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());

  try {
    let session = '';
    try { session = (new URL(req.url, 'http://localhost').searchParams.get('session') || '').trim(); }
    catch { session = ''; }

    // --- Single transcript ------------------------------------------------
    if (session) {
      const { data: messages, error: mErr } = await supabase
        .from('messages')
        .select('role, content, created_at')
        .eq('session_id', session)
        .order('created_at', { ascending: true });
      if (mErr) throw mErr;

      const { data: visitor, error: vErr } = await supabase
        .from('visitors')
        .select('*')
        .eq('session_id', session)
        .maybeSingle();
      if (vErr) throw vErr;

      // A session can spawn multiple leads (chat + viewing) — take the latest.
      const { data: lead, error: lErr } = await supabase
        .from('leads')
        .select('*')
        .eq('session_id', session)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lErr) throw lErr;

      res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        session,
        messages: messages || [],
        visitor: visitor || null,
        lead: lead || null,
      }));
    }

    // --- Recent distinct sessions ----------------------------------------
    // Scan recent messages newest-first; first time we see a session_id it is
    // the latest message for that session (preview + last_at).
    const seen = new Map();
    for (let from = 0; from < SCAN_CAP; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('messages')
        .select('session_id, content, created_at')
        .order('created_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;

      for (const m of data) {
        if (!m.session_id || seen.has(m.session_id)) continue;
        seen.set(m.session_id, {
          session_id: m.session_id,
          last_at: m.created_at,
          preview: (m.content || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        });
      }
      if (seen.size >= SESSION_LIMIT || data.length < PAGE_SIZE) break;
    }

    const picked = Array.from(seen.values()).slice(0, SESSION_LIMIT);

    // Accurate per-session message counts (parallel head counts).
    const counts = await Promise.all(picked.map((s) =>
      supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', s.session_id)
        .then(({ count }) => count || 0)
    ));

    const sessions = picked.map((s, i) => ({
      session_id: s.session_id,
      last_at: s.last_at,
      message_count: counts[i],
      preview: s.preview,
    }));

    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ sessions }));
  } catch (err) {
    console.error('[admin/messages]', err?.message || err);
    res.writeHead(500, { ...cors(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
