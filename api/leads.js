const { createClient } = require('@supabase/supabase-js');
const { verifyAdmin } = require('./_auth');

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Dashboard-Key, Authorization',
  };
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
  const providedKey  = (req.headers['x-dashboard-key'] || '').trim();
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
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  try {
    const { data: leads, error } = await supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    res.writeHead(200, { ...corsHeaders(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ leads: leads || [] }));
  } catch (err) {
    console.error('[leads] error:', err?.message || err);
    res.writeHead(500, { ...corsHeaders(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
