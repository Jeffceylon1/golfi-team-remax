// Single Vercel function routing both cron jobs (/api/cron/digest, /api/cron/nurture).
const handlers = {
  digest:  require('./_digest'),
  nurture: require('./_nurture'),
};

module.exports = async function handler(req, res) {
  const job = req.query && req.query.job;
  const fn = handlers[job];
  if (!fn) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Unknown job' }));
  }
  return fn(req, res);
};
