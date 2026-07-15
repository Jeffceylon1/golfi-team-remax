// Admin bookings — list property-viewing requests and confirm them, producing a
// Google Calendar link + .ics and (optionally) emailing the client. Protected by
// Supabase Auth JWT.
const { createClient } = require('@supabase/supabase-js');
const { verifyAdmin } = require('../_auth');
const { sendEmail, emailShell } = require('../_email');

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

// UTC basic-format timestamp for calendars: YYYYMMDDTHHMMSSZ.
function calDate(d) {
  return new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// Escape a value for an iCalendar text field (RFC 5545 §3.3.11).
function icsEscape(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, cors()); return res.end(); }

  const user = await verifyAdmin(req);
  if (!user) {
    res.writeHead(401, { ...cors(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Unauthorized' }));
  }

  const supabase = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());

  try {
    // --- List viewing requests -------------------------------------------
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('leads')
        .select('id, name, email, phone, data, status, created_at')
        .eq('type', 'viewing')
        .order('created_at', { ascending: false });
      if (error) throw error;

      const bookings = (data || []).map((l) => ({
        id: l.id,
        name: l.name || null,
        email: l.email || null,
        phone: l.phone || null,
        data: l.data || {},
        status: l.status || 'new',
        confirmed: (l.data && l.data.confirmedAt) || null,
        created_at: l.created_at,
      }));

      res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ bookings }));
    }

    // --- Confirm / update a viewing --------------------------------------
    if (req.method === 'POST') {
      let body;
      try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
      catch { body = null; }
      const { id, confirmedAt, notify } = body || {};

      if (!id) {
        res.writeHead(400, { ...cors(), 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'id is required' }));
      }
      const start = new Date(confirmedAt);
      if (!confirmedAt || isNaN(start.getTime())) {
        res.writeHead(400, { ...cors(), 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'confirmedAt must be a valid ISO datetime' }));
      }
      let durationMins = parseInt(body && body.durationMins, 10);
      if (!Number.isFinite(durationMins) || durationMins <= 0) durationMins = 45;
      const end = new Date(start.getTime() + durationMins * 60000);

      const { data: existing, error: fErr } = await supabase
        .from('leads')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (fErr) throw fErr;
      if (!existing) {
        res.writeHead(404, { ...cors(), 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Booking not found' }));
      }

      const prev = (existing.data && typeof existing.data === 'object') ? existing.data : {};
      const newData = {
        ...prev,
        confirmedAt: start.toISOString(),
        durationMins,
      };

      const { data: lead, error: uErr } = await supabase
        .from('leads')
        .update({ data: newData, status: 'qualified', updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single();
      if (uErr) throw uErr;

      // --- Build calendar artefacts --------------------------------------
      const clientName = existing.name || 'Client';
      const property = prev.property || prev.title || '';
      const listing = prev.title && prev.title !== property ? prev.title : '';
      const location = property || listing || 'Golfi Team RE/MAX';
      const title = `Property Viewing - ${clientName}`;

      const detailLines = [];
      if (property) detailLines.push(`Property: ${property}`);
      if (listing) detailLines.push(`Listing: ${listing}`);
      if (prev.preferredTime) detailLines.push(`Preferred time (requested): ${prev.preferredTime}`);
      detailLines.push(`Client: ${clientName}`);
      if (existing.email) detailLines.push(`Email: ${existing.email}`);
      if (existing.phone) detailLines.push(`Phone: ${existing.phone}`);
      detailLines.push(`Duration: ${durationMins} minutes`);
      const details = detailLines.join('\n');

      const googleCalendarUrl =
        'https://calendar.google.com/calendar/render?action=TEMPLATE' +
        `&text=${encodeURIComponent(title)}` +
        `&dates=${calDate(start)}/${calDate(end)}` +
        `&details=${encodeURIComponent(details)}` +
        `&location=${encodeURIComponent(location)}`;

      const ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Golfi Team RE/MAX//Property Viewing//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:viewing-${id}@golfiteam.com`,
        `DTSTAMP:${calDate(new Date())}`,
        `DTSTART:${calDate(start)}`,
        `DTEND:${calDate(end)}`,
        `SUMMARY:${icsEscape(title)}`,
        `DESCRIPTION:${icsEscape(details)}`,
        `LOCATION:${icsEscape(location)}`,
        'STATUS:CONFIRMED',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      // --- Optional client notification (non-fatal) ----------------------
      let notified = false;
      if (notify === true && existing.email) {
        try {
          const when = start.toLocaleString('en-CA', {
            timeZone: 'America/Toronto',
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            hour: 'numeric', minute: '2-digit',
          });
          const propRow = property
            ? `<tr><td style="padding:6px 12px;color:#555;font-weight:600;white-space:nowrap">Property</td><td style="padding:6px 12px;color:#222">${property}</td></tr>`
            : '';
          const bodyHtml = `
<p style="margin:0 0 14px;color:#333;font-size:15px;line-height:1.5">Hi ${clientName},</p>
<p style="margin:0 0 14px;color:#333;font-size:15px;line-height:1.5">Your property viewing with the Golfi Team is confirmed. We look forward to seeing you.</p>
<table cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid #eee;border-radius:8px;overflow:hidden;width:100%">
<tr><td style="padding:6px 12px;color:#555;font-weight:600;white-space:nowrap">Date &amp; time</td><td style="padding:6px 12px;color:#222">${when}</td></tr>
<tr><td style="padding:6px 12px;color:#555;font-weight:600;white-space:nowrap">Duration</td><td style="padding:6px 12px;color:#222">${durationMins} minutes</td></tr>
${propRow}
</table>
<a href="${googleCalendarUrl}" style="display:inline-block;background:#E2001A;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:8px">Add to your calendar</a>
<p style="margin:18px 0 0;color:#777;font-size:13px;line-height:1.5">Need to reschedule? Just reply to this email or call us at 905-304-9444.</p>`;
          const result = await sendEmail({
            to: existing.email,
            subject: 'Your viewing is confirmed',
            html: emailShell('Your viewing is confirmed', bodyHtml),
          });
          notified = !!(result && result.sent);
        } catch (mailErr) {
          console.error('[admin/booking] notify failed:', mailErr?.message || mailErr);
        }
      }

      res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, googleCalendarUrl, ics, notified, lead }));
    }

    res.writeHead(405, { ...cors(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  } catch (err) {
    console.error('[admin/booking]', err?.message || err);
    res.writeHead(500, { ...cors(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
