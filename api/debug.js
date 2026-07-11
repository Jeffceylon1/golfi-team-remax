// Temporary debug endpoint - REMOVE after fixing
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

module.exports = async function handler(req, res) {
  const results = {};

  // Check env vars
  results.env = {
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    anthropicKeyStart: (process.env.ANTHROPIC_API_KEY || '').slice(0, 15),
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    supabaseUrl: process.env.SUPABASE_URL,
    hasServiceKey: !!process.env.SUPABASE_SERVICE_KEY,
    serviceKeyStart: (process.env.SUPABASE_SERVICE_KEY || '').slice(0, 20),
  };

  // Test Supabase
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data, error } = await supabase.from('messages').select('count').limit(1);
    results.supabase = error ? { error: error.message, code: error.code } : { ok: true };
  } catch (e) {
    results.supabase = { exception: e.message };
  }

  // Test Anthropic
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 20000 });
    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Say OK' }]
    });
    results.anthropic = { ok: true, reply: r.content[0].text };
  } catch (e) {
    results.anthropic = { error: e.message, status: e.status, type: e.constructor.name, code: e.code };
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(results, null, 2));
};
