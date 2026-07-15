// Single Vercel function that routes all /api/admin/* endpoints.
// Keeps URLs identical (/api/admin/config, /api/admin/insights, ...) while
// counting as ONE serverless function. Handlers live in underscore helpers.
const handlers = {
  config:   require('./_config'),
  insights: require('./_insights'),
  lead:     require('./_lead'),
  messages: require('./_messages'),
  booking:  require('./_booking'),
};

module.exports = async function handler(req, res) {
  const resource = req.query && req.query.resource;
  const fn = handlers[resource];
  if (!fn) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Not found' }));
  }
  return fn(req, res);
};
