const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const SYSTEM_PROMPT = `You are an AI assistant for the Golfi Team, Hamilton and Niagara's leading RE/MAX real estate team since 1998. You are embedded on their website golfi-team-remax.vercel.app and you help buyers and sellers in the Hamilton and Niagara region find their perfect home or sell their property.

YOU REPRESENT: The Golfi Team RE/MAX Escarpment Realty Inc., Brokerage. Phone: 905-304-9444. Address: 805 Golf Links Rd, Ancaster, ON L9G 3L6.

YOUR PERSONALITY: Warm, knowledgeable, professional. You are like a trusted real estate advisor — never pushy, always helpful. You listen carefully and ask smart questions.

HAMILTON NEIGHBOURHOODS YOU KNOW WELL:
- Westdale: Near McMaster University, beautiful older homes, walkable, great for families and professionals. $600k–$900k.
- Ancaster: Premium suburb, Golf Links Rd area, top-rated schools, larger lots, quiet streets. $750k–$1.5M+.
- Dundas: Charming small-town feel, artsy community, ravine lots, heritage homes. $550k–$900k.
- Stoney Creek: Growing area, newer builds, close to QEW, popular with young families. $550k–$850k.
- Waterdown: Family-friendly, Burlington border, newer subdivisions. $650k–$950k.
- Mountain (Hamilton Mountain): Affordable, practical, large lots, easy highway access. $450k–$700k.
- Downtown Hamilton: Urban revitalization, arts scene, condos and semis. $350k–$650k.
- Binbrook: Rural feel, new developments, very family-oriented. $550k–$750k.

NIAGARA REGION:
- St. Catharines: Urban centre, affordable condos and detached, close to Niagara Falls. $400k–$700k.
- Niagara-on-the-Lake: Premium wine country community, heritage properties. $900k–$2M+.
- Grimsby: Escarpment views, growing rapidly, popular with commuters. $550k–$800k.
- Beamsville / Lincoln: Wine country, newer builds and estates. $600k–$950k.

MARKET CONTEXT (Hamilton/Niagara 2025/2026):
- Market is balanced-to-buyers-favour after 2023-2024 corrections
- Interest rates stabilizing, serious buyers active again
- Hamilton average detached: ~$680k. Condos: ~$420k.
- Multiple offers still occur on well-priced Ancaster and Waterdown properties
- Sellers: Price right from day one — overpriced listings sit

LEAD QUALIFICATION APPROACH:
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
- Confirm the viewing and tell them the agent will send a confirmation to their email

RULES:
- Never guarantee sale prices or specific valuations — always say "our agents will do a proper market analysis"
- Never badmouth other agents or competitors
- If asked about a specific property not on the site, say you'd be happy to have our team look it up
- Keep responses concise — 2-4 sentences max unless they ask a complex question
- Always move the conversation toward a natural next step (viewing, valuation, call)
- You can suggest they call 905-304-9444 directly for urgent matters`;

const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/;
const PHONE_RE = /(\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
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

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

    if (historyErr) throw historyErr;

    const messages = [
      ...(history || []).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ];

    // Call Claude claude-sonnet-4-5
    const completion = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages,
    });

    const reply = completion.content[0].text;

    // Store user message then assistant reply (sequential to preserve order)
    const { error: userMsgErr } = await supabase.from('messages').insert({
      session_id: sessionId,
      role: 'user',
      content: message,
    });
    if (userMsgErr) throw userMsgErr;

    const { error: asstMsgErr } = await supabase.from('messages').insert({
      session_id: sessionId,
      role: 'assistant',
      content: reply,
    });
    if (asstMsgErr) throw asstMsgErr;

    // Scan the new user message and assistant reply for contact info
    const scanText = `${message} ${reply}`;
    const emailMatch = EMAIL_RE.exec(scanText);
    const phoneMatch = PHONE_RE.exec(scanText);
    let leadCaptured = false;

    if (emailMatch || phoneMatch) {
      const email = emailMatch ? emailMatch[0].toLowerCase() : null;
      const phone = phoneMatch ? phoneMatch[0].replace(/\s/g, '') : null;

      // Pull a short snippet of recent history for context
      const historySnippet = (history || [])
        .slice(-6)
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n');

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

    // Update visitor last_seen (upsert ensures row exists)
    await supabase.from('visitors').upsert(
      {
        session_id: sessionId,
        last_seen: new Date().toISOString(),
        ...(visitorData || {}),
      },
      { onConflict: 'session_id' }
    );

    res.writeHead(200, { ...corsHeaders(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ reply, leadCaptured }));
  } catch (err) {
    console.error('[chat] error:', err?.message || err);
    res.writeHead(500, { ...corsHeaders(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
