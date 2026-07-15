// Shared email helper — sends via Resend using raw fetch (SDK-free, Vercel-safe).
// No-ops gracefully when RESEND_API_KEY is unset so nothing breaks pre-setup.

const RESEND_API = 'https://api.resend.com/emails';

/**
 * @param {{to:string|string[], subject:string, html:string, from?:string}} opts
 * @returns {Promise<{sent:boolean, skipped?:boolean, error?:string, id?:string}>}
 */
async function sendEmail(opts) {
  const key = (process.env.RESEND_API_KEY || '').trim();
  if (!key) return { sent: false, skipped: true };
  if (!opts || !opts.to || !opts.subject || !opts.html) {
    return { sent: false, error: 'missing to/subject/html' };
  }

  const from = opts.from || (process.env.EMAIL_FROM || '').trim() || 'Golfi Team <onboarding@resend.dev>';
  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: Array.isArray(opts.to) ? opts.to : [opts.to], subject: opts.subject, html: opts.html }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { sent: false, error: `Resend ${res.status}: ${txt.slice(0, 200)}` };
    }
    const data = await res.json();
    return { sent: true, id: data.id };
  } catch (err) {
    return { sent: false, error: err?.message || 'send failed' };
  }
}

// Branded HTML email wrapper — RE/MAX red header, clean body.
function emailShell(title, bodyHtml) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06);">
<tr><td style="background:#0D1B3E;padding:22px 28px;">
<span style="color:#fff;font-size:18px;font-weight:800;letter-spacing:.5px;">GOLFI TEAM</span>
<span style="color:#E2001A;font-size:18px;font-weight:800;"> RE/MAX</span>
</td></tr>
<tr><td style="padding:28px;">
<h1 style="margin:0 0 16px;color:#0D1B3E;font-size:20px;font-weight:800;">${title}</h1>
${bodyHtml}
</td></tr>
<tr><td style="padding:18px 28px;background:#fafbfc;border-top:1px solid #eee;color:#999;font-size:12px;">
Golfi Team RE/MAX · Hamilton &amp; Niagara · 905-304-9444
</td></tr>
</table></td></tr></table></body></html>`;
}

module.exports = { sendEmail, emailShell };
