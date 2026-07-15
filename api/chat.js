// Uses raw fetch — Anthropic SDK has a connection issue on Vercel Node 24
const { createClient } = require('@supabase/supabase-js');

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-5';

const BEHAVIOUR_GUIDANCE = `LEAD QUALIFICATION APPROACH:
For BUYERS naturally find out:
1. What type of property (detached, condo, townhome, semi)?
2. Which neighbourhood(s) or areas?
3. Budget range?
4. Timeline (buying in 30 days? 3 months? Just browsing?)
5. Mortgage pre-approval status?
6. First-time buyer or moving up/down?

For SELLERS naturally find out:
1. What address or area are they selling in?
2. Timeline to sell?
3. Have they spoken to any other agents?
4. What is their situation (upsizing, downsizing, relocating)?

CAPTURING CONTACT INFO:
- After 2-3 exchanges, naturally ask for their name and best way to reach them
- Say something like: "To send you a personalized shortlist, what's the best email for you?"
- Or: "I'd love to set up a quick call with one of our agents — what's your name and a good number?"
- Never ask for phone AND email in the same message — one at a time

BOOKING VIEWINGS:
- If someone wants to see a property: "Great choice! I can book that for you. What days/times work best this week or next?"
- Confirm the viewing and tell them the agent will send a confirmation to their email`;

const DEFAULT_RULES = [
  'Never guarantee sale prices or specific valuations — always say our agents will do a proper market analysis',
  'Never badmouth other agents or competitors',
  'Keep responses concise — 2-4 sentences max unless they ask a complex question',
  'Always move the conversation toward a natural next step (viewing, valuation, call)',
].map((r) => `- ${r}`).join('\n');

// Minimal, business-agnostic prompt used only if the settings read fails or is empty,
// so the chat agent never goes offline just because config is unavailable.
const FALLBACK_PROMPT = `You are a warm, knowledgeable, professional AI assistant for a real estate team. You help buyers and sellers find the right home or sell their property. You are like a trusted advisor — never pushy, always helpful — and you ask smart qualifying questions.

RULES:
${DEFAULT_RULES}

${BEHAVIOUR_GUIDANCE}`;

// Load the owner-configured agent + business settings from the database.
// Returns null when nothing is configured so the caller can fall back safely.
async function loadAgentConfig(supabase) {
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', ['agent', 'business']);
    if (error) throw error;
    const map = {};
    for (const row of data || []) map[row.key] = row.value || {};
    if (!map.agent && !map.business) return null;
    return { agent: map.agent || {}, business: map.business || {} };
  } catch (err) {
    console.error('[chat] loadAgentConfig:', err?.message || err);
    return null;
  }
}

// Normalise the rules field (array or string) into bullet lines.
function formatRules(rules) {
  if (Array.isArray(rules)) {
    return rules
      .filter((r) => r != null && String(r).trim() !== '')
      .map((r) => `- ${String(r).trim()}`)
      .join('\n');
  }
  if (typeof rules === 'string' && rules.trim() !== '') return rules.trim();
  return '';
}

// Assemble the system prompt entirely from DB settings (business + agent).
// Every section is optional; missing fields simply drop out.
function buildSystemPrompt(cfg) {
  const b = (cfg && cfg.business) || {};
  const a = (cfg && cfg.agent) || {};
  const sections = [];

  // Identity
  const name = (b.name || '').toString().trim();
  const brokerage = (b.brokerage || '').toString().trim();
  const identity = name || brokerage || 'a professional real estate team';
  let intro = `You are an AI assistant for ${identity}`;
  if (brokerage && brokerage !== name) intro += `, ${brokerage}`;
  if (b.market) intro += `, serving the ${String(b.market).trim()} region`;
  if (b.since) intro += ` since ${String(b.since).trim()}`;
  intro += '. You help buyers and sellers find the right home or sell their property.';
  sections.push(intro);

  // Representation / contact
  const rep = [];
  if (brokerage) rep.push(brokerage);
  if (b.phone) rep.push(`Phone: ${String(b.phone).trim()}`);
  if (b.email) rep.push(`Email: ${String(b.email).trim()}`);
  if (b.address) rep.push(`Address: ${String(b.address).trim()}`);
  if (rep.length) sections.push(`YOU REPRESENT: ${rep.join('. ')}.`);

  // Personality
  if (a.personality) sections.push(`YOUR PERSONALITY: ${String(a.personality).trim()}`);

  // Neighbourhoods
  if (Array.isArray(a.neighbourhoods) && a.neighbourhoods.length) {
    const lines = a.neighbourhoods
      .filter((n) => n && n.area)
      .map((n) => {
        const detail = [n.note, n.range]
          .filter((x) => x != null && String(x).trim() !== '')
          .map((x) => String(x).trim())
          .join(' ');
        return `- ${String(n.area).trim()}: ${detail}`.trimEnd();
      });
    if (lines.length) sections.push(`NEIGHBOURHOODS YOU KNOW WELL:\n${lines.join('\n')}`);
  }

  // Market context
  if (a.marketContext) sections.push(`MARKET CONTEXT:\n${String(a.marketContext).trim()}`);

  // Standard behavioural guidance (template — behaviour, not business data)
  sections.push(BEHAVIOUR_GUIDANCE);

  // Rules (DB-configured, else sensible behavioural defaults) + dynamic contact line
  let rulesSection = `RULES:\n${formatRules(a.rules) || DEFAULT_RULES}`;
  if (b.phone) {
    rulesSection += `\n- For urgent matters, you can suggest they call ${String(b.phone).trim()} directly`;
  }
  sections.push(rulesSection);

  return sections.join('\n\n');
}

const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/;
const PHONE_RE = /(\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

async function callClaude(messages, systemPrompt, model) {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': (process.env.ANTHROPIC_API_KEY || '').trim(),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: model || MODEL, max_tokens: 1024, system: systemPrompt, messages }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.content[0].text;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, corsHeaders());
    return res.end();
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { ...corsHeaders(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  const supabase = createClient(
    process.env.SUPABASE_URL.trim(),
    process.env.SUPABASE_SERVICE_KEY.trim()
  );

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    res.writeHead(400, { ...corsHeaders(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Invalid JSON' }));
  }

  const { sessionId, message, visitorData } = body || {};
  if (!sessionId || !message) {
    res.writeHead(400, { ...corsHeaders(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'sessionId and message are required' }));
  }

  try {
    // Load last 20 messages for this session
    const { data: history, error: historyErr } = await supabase
      .from('messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(20);

    if (historyErr) throw new Error(`DB history: ${historyErr.message}`);

    const messages = [
      ...(history || []).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ];

    const cfg = await loadAgentConfig(supabase);
    const systemPrompt = cfg ? buildSystemPrompt(cfg) : FALLBACK_PROMPT;
    const model = (cfg && cfg.agent && typeof cfg.agent.model === 'string' && cfg.agent.model.trim())
      ? cfg.agent.model.trim()
      : MODEL;

    const reply = await callClaude(messages, systemPrompt, model);

    // Store messages
    await supabase.from('messages').insert({ session_id: sessionId, role: 'user', content: message });
    await supabase.from('messages').insert({ session_id: sessionId, role: 'assistant', content: reply });

    // Detect contact info → capture lead
    const scanText = `${message} ${reply}`;
    const emailMatch = EMAIL_RE.exec(scanText);
    const phoneMatch = PHONE_RE.exec(scanText);
    let leadCaptured = false;

    if (emailMatch || phoneMatch) {
      const email = emailMatch ? emailMatch[0].toLowerCase() : null;
      const phone = phoneMatch ? phoneMatch[0].replace(/\s/g, '') : null;
      const historySnippet = (history || []).slice(-6)
        .map((m) => `${m.role}: ${m.content}`).join('\n');

      const { error: upsertErr } = await supabase.from('leads').upsert(
        {
          session_id: sessionId,
          ...(email && { email }),
          ...(phone && { phone }),
          type: 'chat',
          temperature: 'hot',
          source: 'chat_widget',
          data: { conversation_snippet: historySnippet.slice(0, 600) },
          updated_at: new Date().toISOString(),
        },
        { onConflict: email ? 'email' : 'session_id' }
      );
      if (!upsertErr) leadCaptured = true;
    }

    // Update visitor
    await supabase.from('visitors').upsert(
      { session_id: sessionId, last_seen: new Date().toISOString(), ...(visitorData || {}) },
      { onConflict: 'session_id' }
    );

    res.writeHead(200, { ...corsHeaders(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ reply, leadCaptured }));
  } catch (err) {
    console.error('[chat] error:', err?.message || err);
    res.writeHead(500, { ...corsHeaders(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Internal server error', detail: err?.message }));
  }
};
