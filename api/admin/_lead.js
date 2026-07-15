// Admin lead update — edit CRM status and/or notes. Protected by Supabase Auth JWT.
const { createClient } = require('@supabase/supabase-js');
const { verifyAdmin } = require('../_auth');

const STATUSES = ['new', 'contacted', 'qualified', 'closed'];

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

  if (req.method !== 'POST') {
    res.writeHead(405, { ...cors(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  const supabase = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());

  try {
    let body;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
    catch { body = null; }
    const { id, status, notes } = body || {};

    if (!id) {
      res.writeHead(400, { ...cors(), 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'id is required' }));
    }
    if (typeof status !== 'undefined' && status !== null && !STATUSES.includes(status)) {
      res.writeHead(400, { ...cors(), 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: `status must be one of ${STATUSES.join(', ')}` }));
    }
    if (typeof status === 'undefined' && typeof notes === 'undefined') {
      res.writeHead(400, { ...cors(), 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'nothing to update — provide status and/or notes' }));
    }

    const patch = { updated_at: new Date().toISOString() };
    if (typeof status !== 'undefined' && status !== null) patch.status = status;
    if (typeof notes !== 'undefined') patch.notes = notes;

    const { data: lead, error } = await supabase
      .from('leads')
      .update(patch)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) throw error;
    if (!lead) {
      res.writeHead(404, { ...cors(), 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Lead not found' }));
    }

    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, lead }));
  } catch (err) {
    console.error('[admin/lead]', err?.message || err);
    res.writeHead(500, { ...cors(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
