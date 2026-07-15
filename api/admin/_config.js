// Admin config — read/write all settings. Protected by Supabase Auth JWT.
const { createClient } = require('@supabase/supabase-js');
const { verifyAdmin } = require('../_auth');

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, cors()); return res.end(); }

  const user = await verifyAdmin(req);
  if (!user) {
    res.writeHead(401, { ...cors(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Unauthorized' }));
  }

  const supabase = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('settings').select('key, value, updated_at');
      if (error) throw error;
      const map = {};
      for (const row of data || []) map[row.key] = row.value;
      res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ settings: map }));
    }

    if (req.method === 'POST') {
      let body;
      try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
      catch { body = null; }
      const { key, value } = body || {};
      if (!key || typeof value === 'undefined') {
        res.writeHead(400, { ...cors(), 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'key and value are required' }));
      }
      const { error } = await supabase.from('settings').upsert(
        { key, value, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
      if (error) throw error;
      res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, key }));
    }

    res.writeHead(405, { ...cors(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  } catch (err) {
    console.error('[admin/config]', err?.message || err);
    res.writeHead(500, { ...cors(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
