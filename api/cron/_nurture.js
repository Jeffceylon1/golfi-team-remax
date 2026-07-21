// Nurture cron — advances cold/warm leads through the configured email sequence.
// Called by Vercel Cron (Authorization: Bearer <CRON_SECRET>) or by an admin
// from the console (Authorization: Bearer <JWT>) for a manual test run.
// No-op safe before setup: sendEmail() skips when RESEND_API_KEY is unset, and a
// skipped send never advances a lead — so nothing is burned until the key is added.
const { createClient } = require('@supabase/supabase-js');
const { verifyAdmin } = require('../_auth');
const { sendEmail, emailShell } = require('../_email');

const DAY_MS = 24 * 60 * 60 * 1000;
const TZ = 'America/Toronto';
const MAX_LEADS = 50;      // cap leads processed per run
const CANDIDATE_LIMIT = 200; // upper bound on rows pulled before dedupe

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(res, code, obj) {
  res.writeHead(code, { ...corsHeaders(), 'Content-Type': 'application/json' });
  return res.end(JSON.stringify(obj));
}

// Cron secret OR admin JWT. Never runs open: with no CRON_SECRET, an admin JWT is required.
async function authorize(req) {
  const secret = (process.env.CRON_SECRET || '').trim();
  const hdr = (req.headers['authorization'] || req.headers['Authorization'] || '')
    .replace(/^Bearer\s+/i, '').trim();
  if (secret && hdr && hdr === secret) return { ok: true, isCron: true };
  const user = await verifyAdmin(req).catch(() => null);
  if (user) return { ok: true, isCron: false };
  return { ok: false, isCron: false };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function nl2br(s) {
  return String(s == null ? '' : s).replace(/\r\n|\r|\n/g, '<br>');
}
function torontoDay(d) {
  return new Date(d).toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
}
function firstName(name) {
  const n = String(name || '').trim();
  return n ? n.split(/\s+/)[0] : '';
}

// Replace {name}; when there's no first name, drop the token and tidy the
// leading comma/space it leaves behind (e.g. "Hi {name}," -> "Hi,").
function personalize(text, first) {
  const src = String(text == null ? '' : text);
  if (first) return src.replace(/\{name\}/g, first);
  return src
    .replace(/[ \t]*\{name\}/g, '') // token + any space right before it
    .replace(/[ \t]+,/g, ',')       // " ," -> "," for mid-phrase tokens
    .replace(/^,[ \t]*/gm, '');     // leading comma at the start of any line
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, corsHeaders()); return res.end(); }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  const auth = await authorize(req);
  if (!auth.ok) return json(res, 401, { error: 'Unauthorized' });

  const supabase = createClient(
    process.env.SUPABASE_URL.trim(),
    process.env.SUPABASE_SERVICE_KEY.trim()
  );

  try {
    const { data: cfgRow, error: cfgErr } = await supabase
      .from('settings').select('value').eq('key', 'nurture').maybeSingle();
    if (cfgErr) throw cfgErr;
    const cfg = (cfgRow && cfgRow.value) || {};
    const steps = Array.isArray(cfg.steps) ? cfg.steps : [];
    if (!cfg.enabled) return json(res, 200, { success: true, skipped: 'disabled' });
    if (!steps.length) return json(res, 200, { success: true, skipped: 'no steps' });

    const now = Date.now();
    const nowIso = new Date().toISOString();
    const todayStr = torontoDay(now);

    // Candidate leads: has email, cold/warm, not closed (null status allowed).
    const { data: leadRaw, error: leadErr } = await supabase
      .from('leads')
      .select('id, name, email, temperature, status, created_at')
      .in('temperature', ['cold', 'warm'])
      .not('email', 'is', null)
      .or('status.neq.closed,status.is.null')
      .order('created_at', { ascending: true })
      .limit(CANDIDATE_LIMIT);
    if (leadErr) throw leadErr;
    const leads = leadRaw || [];

    // Dedupe by email (nurture_log.email is unique); earliest-created lead wins.
    const leadByEmail = new Map();
    for (const l of leads) {
      if (!l.email) continue;
      if (!leadByEmail.has(l.email)) leadByEmail.set(l.email, l);
    }
    const emails = [...leadByEmail.keys()];
    if (!emails.length) return json(res, 200, { success: true, sent: 0, processed: 0 });

    // Pull existing nurture_log rows in one shot.
    const logByEmail = new Map();
    const { data: logRaw, error: logErr } = await supabase
      .from('nurture_log')
      .select('id, lead_id, email, step, last_sent_at, status')
      .in('email', emails);
    if (logErr) throw logErr;
    for (const r of logRaw || []) logByEmail.set(r.email, r);

    let sent = 0, processed = 0;

    for (const lead of leadByEmail.values()) {
      if (processed >= MAX_LEADS) break;
      const email = lead.email;
      if (!email) continue;

      // Ensure a nurture_log row exists (create at step 0 if missing).
      let log = logByEmail.get(email);
      if (!log) {
        const { data: created, error: insErr } = await supabase
          .from('nurture_log')
          .insert({ lead_id: lead.id, email, step: 0, status: 'active', created_at: nowIso, updated_at: nowIso })
          .select('id, lead_id, email, step, last_sent_at, status')
          .maybeSingle();
        // Unique-email race: another run inserted first — re-read that row.
        if (insErr || !created) {
          const { data: existing } = await supabase
            .from('nurture_log')
            .select('id, lead_id, email, step, last_sent_at, status')
            .eq('email', email).maybeSingle();
          log = existing || { id: null, lead_id: lead.id, email, step: 0, last_sent_at: null, status: 'active' };
        } else {
          log = created;
        }
        logByEmail.set(email, log);
      }

      // Only work active sequences; completed/stopped are skipped.
      if (log.status !== 'active') continue;
      processed++;

      const step = Number(log.step) || 0;
      if (step >= steps.length) {
        if (log.id) {
          await supabase.from('nurture_log')
            .update({ status: 'completed', updated_at: nowIso }).eq('email', email);
        }
        continue;
      }

      const s = steps[step] || {};
      const ageDays = (now - new Date(lead.created_at).getTime()) / DAY_MS;
      const dueByAge = ageDays >= (Number(s.dayOffset) || 0);
      const notSentToday = !log.last_sent_at || torontoDay(log.last_sent_at) !== todayStr;
      if (!dueByAge || !notSentToday) continue;

      // Build and send this one due step.
      const first = firstName(lead.name);
      const subject = personalize(s.subject || 'A note from the Golfi Real Estate', first);
      const bodyText = personalize(s.body || '', first);
      const html = emailShell(
        subject,
        `<div style="color:#444;font-size:15px;line-height:1.6;">${nl2br(esc(bodyText))}</div>`
      );

      const result = await sendEmail({ to: email, subject, html });

      // Advance ONLY on a real send. A skipped (no key) or failed send leaves the
      // lead pending so it goes out for real on a later run — never burns a step.
      if (result.sent) {
        const newStep = step + 1;
        const completed = newStep >= steps.length;
        await supabase.from('nurture_log').update({
          step: newStep,
          last_sent_at: nowIso,
          status: completed ? 'completed' : 'active',
          updated_at: nowIso,
        }).eq('email', email);
        sent++;
      }
    }

    return json(res, 200, { success: true, sent, processed });
  } catch (err) {
    console.error('[cron/nurture]', err?.message || err);
    return json(res, 500, { error: 'Internal server error' });
  }
};
