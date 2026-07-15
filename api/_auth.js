// Shared admin auth — verifies a Supabase Auth JWT from the Authorization header.
const { createClient } = require('@supabase/supabase-js');

/**
 * Returns the authenticated user, or null if the token is missing/invalid.
 * @param {import('http').IncomingMessage} req
 */
async function verifyAdmin(req) {
  const header = req.headers['authorization'] || req.headers['Authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;

  const supabase = createClient(
    process.env.SUPABASE_URL.trim(),
    process.env.SUPABASE_SERVICE_KEY.trim()
  );
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data || !data.user) return null;
  return data.user;
}

module.exports = { verifyAdmin };
