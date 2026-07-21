// Public config — safe subset the widget needs at runtime. No secrets.
const { createClient } = require('@supabase/supabase-js');

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=60',
  };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, cors()); return res.end(); }
  if (req.method !== 'GET') {
    res.writeHead(405, { ...cors(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());
    const { data, error } = await supabase.from('settings').select('key, value')
      .in('key', ['widget', 'hooks', 'agent', 'business']);
    if (error) throw error;

    const map = {};
    for (const row of data || []) map[row.key] = row.value;

    // Curate the public payload — only what the widget legitimately needs.
    const payload = {
      widget: map.widget || {},
      hooks: map.hooks || {},
      greeting: (map.agent && map.agent.greeting) || '',
      phone: (map.business && map.business.phone) || '',
      title: (map.widget && map.widget.title) || 'Golfi Real Estate AI',
      subtitle: (map.widget && map.widget.subtitle) || '',
    };

    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(payload));
  } catch (err) {
    console.error('[config]', err?.message || err);
    res.writeHead(500, { ...cors(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
