// Morning digest cron — compiles a daily briefing and emails the owner.
// Called by Vercel Cron (Authorization: Bearer <CRON_SECRET>) or by an admin
// from the console (Authorization: Bearer <JWT>) for a manual test run.
// No-op safe before setup: sendEmail() skips gracefully when RESEND_API_KEY is unset.
const { createClient } = require('@supabase/supabase-js');
const { verifyAdmin } = require('../_auth');
const { sendEmail, emailShell } = require('../_email');

const DAY_MS = 24 * 60 * 60 * 1000;
const TZ = 'America/Toronto';

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
function torontoDay(d) {
  return new Date(d).toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
}
function displayDate(d) {
  return new Date(d).toLocaleDateString('en-US', {
    timeZone: TZ, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}
function fmtWhen(iso) {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
function fmtDuration(sec) {
  sec = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

function section(title, inner) {
  return `<div style="margin:0 0 24px;">
<h2 style="margin:0 0 10px;color:#0D1B3E;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #E2001A;padding-bottom:6px;">${esc(title)}</h2>
${inner}
</div>`;
}
function emptyNote(text) {
  return `<p style="margin:0;color:#8a8f99;font-size:14px;">${esc(text)}</p>`;
}
function th(label) {
  return `<th style="text-align:left;padding:6px 10px;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #eee;">${esc(label)}</th>`;
}

function hotLeadsHtml(leads) {
  if (!leads.length) return emptyNote('No hot leads in the last 24 hours — nothing needs urgent follow-up.');
  const rows = leads.map((l) => {
    const contact = [l.email, l.phone].filter(Boolean).map(esc).join('<br>')
      || '<span style="color:#aaa;">no contact</span>';
    return `<tr>
<td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#0D1B3E;font-weight:600;">${esc(l.name || 'Unknown')}</td>
<td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#444;">${contact}</td>
<td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#666;">${esc(l.type || '\u2014')}</td>
<td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;font-size:12px;color:#999;white-space:nowrap;">${esc(fmtWhen(l.created_at))}</td>
</tr>`;
  }).join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
<tr>${th('Name')}${th('Contact')}${th('Type')}${th('When')}</tr>
${rows}</table>`;
}

function anonHtml(anon) {
  if (!anon.length) return emptyNote('No high-intent anonymous visitors to watch right now.');
  const items = anon.map((v) => {
    const where = v.current_page ? ` \u00b7 last on <span style="color:#666;">${esc(v.current_page)}</span>` : '';
    return `<li style="margin:0 0 8px;font-size:14px;color:#444;">
<strong style="color:#E2001A;">Score ${Math.round(Number(v.score) || 0)}</strong> \u00b7 ${esc(v.page_views || 0)} pages \u00b7 ${esc(fmtDuration(v.total_seconds))} \u00b7 via ${esc(v.traffic_source || 'Direct')}${where}
</li>`;
  }).join('');
  return `<ul style="margin:0;padding-left:18px;">${items}</ul>`;
}

function propertiesHtml(top, titles) {
  if (!top.length) return emptyNote('No property views recorded in the last 7 days.');
  const items = top.map(([id, c]) =>
    `<li style="margin:0 0 6px;font-size:14px;color:#444;">${esc(titles[id] || ('Property ' + id))} <span style="color:#999;">\u2014 ${c} view${c === 1 ? '' : 's'}</span></li>`
  ).join('');
  return `<ol style="margin:0;padding-left:20px;">${items}</ol>`;
}

function sourcesHtml(top) {
  if (!top.length) return emptyNote('No traffic source data in the last 7 days.');
  const items = top.map(([s, c]) =>
    `<li style="margin:0 0 6px;font-size:14px;color:#444;">${esc(s)} <span style="color:#999;">\u2014 ${c} visit${c === 1 ? '' : 's'}</span></li>`
  ).join('');
  return `<ul style="margin:0;padding-left:18px;">${items}</ul>`;
}

function marketNote(events, since7, since14) {
  const thisWeek = events.filter((e) => e.type === 'search' && e.created_at >= since7).length;
  const priorWeek = events.filter((e) => e.type === 'search' && e.created_at < since7 && e.created_at >= since14).length;
  if (thisWeek + priorWeek < 5) {
    return 'Search activity has been light over the past two weeks — a good window to reach out to your pipeline proactively.';
  }
  if (priorWeek === 0) {
    return `Search activity is climbing — ${thisWeek} property searches this week and none the week prior.`;
  }
  const pct = Math.round(((thisWeek - priorWeek) / priorWeek) * 100);
  if (pct > 5) return `Search activity is up ${pct}% this week (${thisWeek} vs ${priorWeek} searches).`;
  if (pct < -5) return `Search activity is down ${Math.abs(pct)}% this week (${thisWeek} vs ${priorWeek} searches).`;
  return `Search activity is holding steady this week (${thisWeek} vs ${priorWeek} searches).`;
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
      .from('settings').select('value').eq('key', 'digest').maybeSingle();
    if (cfgErr) throw cfgErr;
    const cfg = (cfgRow && cfgRow.value) || {};
    if (!cfg.enabled) return json(res, 200, { success: true, skipped: 'disabled' });

    const now = Date.now();
    const today = torontoDay(now);

    // Idempotency: one digest per calendar day for cron; admin may re-send for testing.
    const { data: already, error: logErr } = await supabase
      .from('digest_log').select('sent_for').eq('sent_for', today).maybeSingle();
    if (logErr) throw logErr;
    if (already && auth.isCron) {
      return json(res, 200, { success: true, skipped: 'already sent', sent_for: today });
    }

    const since24 = new Date(now - DAY_MS).toISOString();
    const since7 = new Date(now - 7 * DAY_MS).toISOString();
    const since14 = new Date(now - 14 * DAY_MS).toISOString();

    // Hot leads: temperature=hot AND (created in last 24h OR still status=new).
    const { data: hotRaw, error: hotErr } = await supabase
      .from('leads')
      .select('id, name, email, phone, type, created_at, status, temperature')
      .eq('temperature', 'hot')
      .or(`created_at.gte.${since24},status.eq.new`)
      .order('created_at', { ascending: false })
      .limit(50);
    if (hotErr) throw hotErr;
    const hotLeads = hotRaw || [];

    // Anonymous high-scorers: score>=60, no email, active in last 7 days, top 10.
    const { data: anonRaw, error: anonErr } = await supabase
      .from('visitors')
      .select('session_id, score, page_views, total_seconds, traffic_source, current_page, last_seen')
      .gte('score', 60)
      .is('email', null)
      .gte('last_seen', since7)
      .order('score', { ascending: false })
      .limit(10);
    if (anonErr) throw anonErr;
    const anon = anonRaw || [];

    // Events (last 14d, relevant types) for insights + market stat.
    const { data: evRaw, error: evErr } = await supabase
      .from('events')
      .select('type, data, created_at')
      .in('type', ['property_view', 'page_view', 'search'])
      .gte('created_at', since14)
      .order('created_at', { ascending: false })
      .limit(10000);
    if (evErr) throw evErr;
    const events = evRaw || [];
    const events7 = events.filter((e) => e.created_at >= since7);

    // Top 5 viewed properties.
    const propCounts = {}, propTitles = {};
    for (const e of events7) {
      if (e.type !== 'property_view') continue;
      const d = e.data || {};
      const id = d.propertyId;
      if (!id) continue;
      propCounts[id] = (propCounts[id] || 0) + 1;
      if (d.title) propTitles[id] = d.title;
    }
    const topProps = Object.entries(propCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // Top traffic sources.
    const srcCounts = {};
    for (const e of events7) {
      if (e.type !== 'page_view') continue;
      const src = ((e.data || {}).trafficSource || 'Direct');
      srcCounts[src] = (srcCounts[src] || 0) + 1;
    }
    const topSources = Object.entries(srcCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // Assemble body, honouring include* flags (default on unless explicitly false).
    let body = `<p style="margin:0 0 22px;color:#444;font-size:15px;">Good morning \u2014 here's your briefing for <strong style="color:#0D1B3E;">${esc(displayDate(now))}</strong>.</p>`;
    if (cfg.includeHotLeads !== false) body += section('Hot leads needing follow-up', hotLeadsHtml(hotLeads));
    if (cfg.includeAnonymous !== false) body += section('Visitors to watch', anonHtml(anon));
    if (cfg.includeInsights !== false) {
      body += section('Most-viewed listings', propertiesHtml(topProps, propTitles));
      body += section('Traffic sources', sourcesHtml(topSources));
    }
    if (cfg.includeMarketStat !== false) {
      body += section('Market note', `<p style="margin:0;color:#444;font-size:14px;">${esc(marketNote(events, since7, since14))}</p>`);
    }

    const html = emailShell('Your Golfi Real Estate morning briefing', body);
    const result = await sendEmail({
      to: cfg.recipient,
      subject: 'Golfi Real Estate \u2014 Morning Briefing ' + today,
      html,
    });

    const counts = {
      hotLeads: hotLeads.length,
      anon: anon.length,
      topProperties: topProps.length,
      sources: topSources.length,
    };

    // Record the day only when an email actually went out or was safely skipped (no key).
    if (result.sent || result.skipped) {
      const { error: upErr } = await supabase.from('digest_log').upsert(
        { sent_for: today, sent_at: new Date().toISOString(), summary: { hotLeads: hotLeads.length, anon: anon.length } },
        { onConflict: 'sent_for' }
      );
      if (upErr) throw upErr;
    }

    return json(res, 200, {
      success: true,
      sent: !!result.sent,
      skipped: !!result.skipped,
      resent: !!(already && !auth.isCron),
      error: result.error || null,
      sent_for: today,
      counts,
    });
  } catch (err) {
    console.error('[cron/digest]', err?.message || err);
    return json(res, 500, { error: 'Internal server error' });
  }
};
