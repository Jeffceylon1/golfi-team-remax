const { createClient } = require('@supabase/supabase-js');
const twilio = require('twilio');
const { sendEmail, emailShell } = require('./_email');

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function calcTemperature(type, phone) {
  if (type === 'chat' && phone) return 'hot';
  if (type === 'chat' || type === 'viewing') return 'hot';
  if (type === 'property_save' || type === 'valuation') return 'warm';
  return 'cold';
}

function tempEmoji(temp) {
  if (temp === 'hot') return '🔥 HOT';
  if (temp === 'warm') return '🌡️ WARM';
  return '❄️ COLD';
}

function formatWhatsApp({ name, email, phone, type, temperature, data, source }) {
  const now = new Date().toLocaleString('en-CA', {
    timeZone: 'America/Toronto',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const dataLines = data && typeof data === 'object'
    ? Object.entries(data)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')
    : data || '';

  return [
    `🔥 New Lead — ${type} — Golfi Team`,
    '',
    `Name: ${name || 'Not provided'}`,
    `Email: ${email || 'Not provided'}`,
    `Phone: ${phone || 'Not provided'}`,
    `Type: ${type}`,
    `Temperature: ${tempEmoji(temperature)}`,
    '',
    dataLines,
    '',
    `Source: ${source || 'website'}`,
    `Time: ${now}`,
  ]
    .join('\n')
    .trim();
}

function formatEmail({ name, email, phone, type, temperature, data, source }) {
  const now = new Date().toLocaleString('en-CA', {
    timeZone: 'America/Toronto',
    dateStyle: 'full',
    timeStyle: 'short',
  });

  const dataRows = data && typeof data === 'object'
    ? Object.entries(data)
        .filter(([, v]) => v)
        .map(
          ([k, v]) =>
            `<tr><td style="padding:6px 12px;color:#555;font-weight:600;white-space:nowrap">${k}</td><td style="padding:6px 12px;color:#222">${v}</td></tr>`
        )
        .join('')
    : data
    ? `<tr><td colspan="2" style="padding:6px 12px;color:#222">${data}</td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
        <!-- Header -->
        <tr>
          <td style="background:#E2001A;padding:24px 32px">
            <p style="margin:0;color:#ffffff;font-size:12px;letter-spacing:2px;text-transform:uppercase">RE/MAX Escarpment Realty Inc.</p>
            <h1 style="margin:4px 0 0;color:#ffffff;font-size:22px;font-weight:700">🔥 New Lead: ${type}</h1>
          </td>
        </tr>
        <!-- Temperature badge -->
        <tr>
          <td style="background:#0D1B3E;padding:10px 32px">
            <p style="margin:0;color:#ffffff;font-size:14px;font-weight:700;letter-spacing:1px">${tempEmoji(temperature)}</p>
          </td>
        </tr>
        <!-- Contact details -->
        <tr>
          <td style="padding:28px 32px 0">
            <h2 style="margin:0 0 16px;color:#0D1B3E;font-size:16px;border-bottom:2px solid #E2001A;padding-bottom:8px">Contact Information</h2>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
              <tr style="background:#f9f9f9">
                <td style="padding:8px 12px;color:#555;font-weight:600;width:120px">Name</td>
                <td style="padding:8px 12px;color:#222">${name || '<em>Not provided</em>'}</td>
              </tr>
              <tr>
                <td style="padding:8px 12px;color:#555;font-weight:600">Email</td>
                <td style="padding:8px 12px;color:#222">${email ? `<a href="mailto:${email}" style="color:#E2001A">${email}</a>` : '<em>Not provided</em>'}</td>
              </tr>
              <tr style="background:#f9f9f9">
                <td style="padding:8px 12px;color:#555;font-weight:600">Phone</td>
                <td style="padding:8px 12px;color:#222">${phone ? `<a href="tel:${phone}" style="color:#E2001A">${phone}</a>` : '<em>Not provided</em>'}</td>
              </tr>
              <tr>
                <td style="padding:8px 12px;color:#555;font-weight:600">Type</td>
                <td style="padding:8px 12px;color:#222">${type}</td>
              </tr>
              <tr style="background:#f9f9f9">
                <td style="padding:8px 12px;color:#555;font-weight:600">Source</td>
                <td style="padding:8px 12px;color:#222">${source || 'website'}</td>
              </tr>
            </table>
          </td>
        </tr>
        ${dataRows ? `
        <!-- Additional data -->
        <tr>
          <td style="padding:24px 32px 0">
            <h2 style="margin:0 0 16px;color:#0D1B3E;font-size:16px;border-bottom:2px solid #E2001A;padding-bottom:8px">Lead Details</h2>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
              ${dataRows}
            </table>
          </td>
        </tr>` : ''}
        <!-- Footer -->
        <tr>
          <td style="padding:28px 32px;color:#888;font-size:12px;border-top:1px solid #eee;margin-top:24px">
            <p style="margin:0">Received: ${now}</p>
            <p style="margin:4px 0 0">Golfi Team RE/MAX Escarpment Realty Inc. · 805 Golf Links Rd, Ancaster, ON · 905-304-9444</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Visitor-facing valuation report — sleek, Gina-branded, site colours. ──
function money(n) {
  const v = Number(n);
  return Number.isFinite(v) ? '$' + Math.round(v).toLocaleString('en-CA') : '';
}
function valuationReportEmail(p) {
  const d = (p && p.data && typeof p.data === 'object') ? p.data : {};
  const addr = d.address || 'your property';
  const range = (money(d.estimateLow) && money(d.estimateHigh))
    ? money(d.estimateLow) + ' &ndash; ' + money(d.estimateHigh)
    : 'Prepared just for you';
  const beds = d.beds || '&mdash;';
  const baths = d.baths || '&mdash;';
  const sqft = d.sqft ? Number(d.sqft).toLocaleString('en-CA') : '&mdash;';
  const ptype = d.propertyType || 'Home';
  const avatar = 'https://golfi-team-remax.vercel.app/assets/img/agent/gina-avatar.jpg';
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#eef1f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;padding:28px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(13,27,62,.10);">
  <tr><td style="background:#0D1B3E;padding:22px 30px;">
    <span style="color:#fff;font-size:19px;font-weight:800;letter-spacing:.5px;">GOLFI TEAM</span><span style="color:#E2001A;font-size:19px;font-weight:800;"> RE/MAX</span>
  </td></tr>
  <tr><td style="padding:32px 30px 10px;text-align:center;">
    <div style="color:#8a93a3;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Your Estimated Home Value</div>
    <div style="color:#0D1B3E;font-size:36px;font-weight:800;margin:10px 0 4px;">${range}</div>
    <div style="color:#8a93a3;font-size:13px;">${addr}</div>
  </td></tr>
  <tr><td style="padding:18px 30px 6px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eceef2;border-radius:10px;"><tr>
      <td style="padding:14px;text-align:center;border-right:1px solid #eceef2;"><div style="font-size:20px;font-weight:800;color:#0D1B3E;">${beds}</div><div style="font-size:11px;color:#8a93a3;text-transform:uppercase;letter-spacing:.5px;">Beds</div></td>
      <td style="padding:14px;text-align:center;border-right:1px solid #eceef2;"><div style="font-size:20px;font-weight:800;color:#0D1B3E;">${baths}</div><div style="font-size:11px;color:#8a93a3;text-transform:uppercase;letter-spacing:.5px;">Baths</div></td>
      <td style="padding:14px;text-align:center;border-right:1px solid #eceef2;"><div style="font-size:20px;font-weight:800;color:#0D1B3E;">${sqft}</div><div style="font-size:11px;color:#8a93a3;text-transform:uppercase;letter-spacing:.5px;">Sq Ft</div></td>
      <td style="padding:14px;text-align:center;"><div style="font-size:20px;font-weight:800;color:#0D1B3E;">${ptype}</div><div style="font-size:11px;color:#8a93a3;text-transform:uppercase;letter-spacing:.5px;">Type</div></td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:20px 30px 4px;">
    <div style="color:#0D1B3E;font-size:15px;font-weight:800;margin-bottom:6px;">What this means</div>
    <p style="margin:0;color:#4a5262;font-size:14px;line-height:1.6;">This is an automated estimate based on recent comparable sales in your area. Your home's <strong>exact</strong> value depends on its condition, upgrades, and current buyer demand &mdash; things only a local expert can price precisely.</p>
  </td></tr>
  <tr><td style="padding:22px 30px 6px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f9fc;border-radius:12px;"><tr>
      <td width="78" style="padding:16px 0 16px 16px;vertical-align:top;"><img src="${avatar}" alt="Gina Gratta" width="62" height="62" style="width:62px;height:62px;border-radius:50%;object-fit:cover;object-position:center 22%;border:3px solid #E2001A;display:block;"></td>
      <td style="padding:16px;vertical-align:top;">
        <p style="margin:0 0 8px;color:#4a5262;font-size:14px;line-height:1.6;">"An algorithm gets you close &mdash; I get you the <strong>real</strong> number. I'll personally review your home and the exact comparables, then send your precise valuation. No pressure, no obligation."</p>
        <div style="color:#0D1B3E;font-weight:800;font-size:14px;">Gina Gratta</div>
        <div style="color:#8a93a3;font-size:12px;">REALTOR&reg;, Golfi Team RE/MAX</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:22px 30px 30px;text-align:center;">
    <a href="tel:+19055313741" style="display:inline-block;background:#E2001A;color:#fff;text-decoration:none;font-size:15px;font-weight:800;padding:15px 34px;border-radius:9px;">Get My Exact Value &rarr;</a>
    <div style="margin-top:14px;color:#8a93a3;font-size:13px;">Or call Gina directly at <strong style="color:#0D1B3E;">(905) 531-3741</strong></div>
  </td></tr>
  <tr><td style="padding:16px 30px;background:#0D1B3E;color:#9fb0c9;font-size:11px;line-height:1.5;">
    Gina Gratta, REALTOR&reg; &middot; Golfi Team RE/MAX &middot; Hamilton, Burlington &amp; Niagara<br>This estimate is for informational purposes only and is not a formal appraisal.
  </td></tr>
</table></td></tr></table></body></html>`;
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

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    res.writeHead(400, { ...corsHeaders(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Invalid JSON' }));
  }

  const { sessionId, name, email, phone, type, data, source } = body || {};

  // Validate required fields
  if (!sessionId) {
    res.writeHead(400, { ...corsHeaders(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'sessionId is required' }));
  }
  if (!email && !phone) {
    res.writeHead(400, { ...corsHeaders(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'email or phone is required' }));
  }
  if (!type) {
    res.writeHead(400, { ...corsHeaders(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'type is required' }));
  }

  try {
    const temperature = calcTemperature(type, phone);
    const now = new Date().toISOString();

    // Dedup by email when present; otherwise insert a fresh row.
    const leadRow = {
      session_id: sessionId,
      ...(name && { name }),
      ...(email && { email: email.toLowerCase() }),
      ...(phone && { phone }),
      type,
      temperature,
      source: source || 'website',
      ...(data && { data }),
      updated_at: now,
    };
    const leadQuery = email
      ? supabase.from('leads').upsert(leadRow, { onConflict: 'email' })
      : supabase.from('leads').insert(leadRow);
    const { data: lead, error: leadErr } = await leadQuery.select('id').single();

    if (leadErr) throw leadErr;

    // Ensure visitor row exists for this session
    await supabase.from('visitors').upsert(
      {
        session_id: sessionId,
        last_seen: now,
      },
      { onConflict: 'session_id' }
    );

    const alertPayload = { name, email, phone, type, temperature, data, source };

    // Send WhatsApp via Twilio (non-fatal — log but don't fail the request)
    if (
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_WHATSAPP_FROM &&
      process.env.GOLFI_WHATSAPP_TO
    ) {
      try {
        const twilioClient = twilio(
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_AUTH_TOKEN
        );
        await twilioClient.messages.create({
          from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
          to: `whatsapp:${process.env.GOLFI_WHATSAPP_TO}`,
          body: formatWhatsApp(alertPayload),
        });
      } catch (twilioErr) {
        console.error('[lead] Twilio error:', twilioErr?.message || twilioErr);
      }
    }

    // Send email via Resend (non-fatal)
    if (process.env.RESEND_API_KEY && process.env.GOLFI_ALERT_EMAIL) {
      try {
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Golfi Leads <leads@golfi-team-remax.vercel.app>',
            to: [process.env.GOLFI_ALERT_EMAIL],
            subject: `🔥 New ${type} lead — ${name || email || phone} — Golfi Team`,
            html: formatEmail(alertPayload),
          }),
        });
        if (!resendRes.ok) {
          const resendBody = await resendRes.text();
          console.error('[lead] Resend error:', resendRes.status, resendBody);
        }
      } catch (resendErr) {
        console.error('[lead] Resend fetch error:', resendErr?.message || resendErr);
      }
    }

    // Valuation report to the visitor — sleek Gina-branded email (non-fatal).
    // Sends whenever RESEND_API_KEY is configured; no-ops safely otherwise.
    const isValuation =
      type === 'valuation' ||
      (typeof source === 'string' && source.toLowerCase().includes('valuation'));
    if (isValuation && email) {
      try {
        const html = valuationReportEmail({ name, data });
        const result = await sendEmail({
          to: email,
          subject: 'Your Home Value Estimate — Golfi Team RE/MAX',
          html,
          from: 'Gina Gratta <onboarding@resend.dev>',
        });
        if (result && result.error) {
          console.error('[lead] valuation report error:', result.error);
        }
      } catch (valErr) {
        console.error('[lead] valuation report error:', valErr?.message || valErr);
      }
    }

    res.writeHead(200, { ...corsHeaders(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, leadId: lead?.id ?? null }));
  } catch (err) {
    console.error('[lead] error:', err?.message || err);
    res.writeHead(500, { ...corsHeaders(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
