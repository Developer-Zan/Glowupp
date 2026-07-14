const { createHash } = require('node:crypto');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

module.exports = async function waitlist(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Method not allowed.' });
  }

  UPSTASH_REDIS_REST_URL="https://internal-robin-42179.upstash.io"
  UPSTASH_REDIS_REST_TOKEN="********"
  if (!redisUrl || !redisToken) {
    console.error('Waitlist storage is not configured.');
    return send(res, 503, { error: 'The waitlist is temporarily unavailable. Please try again soon.' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return send(res, 400, { error: 'Invalid request body.' });
  }
  if (body.company) return send(res, 200, { ok: true });

  const email = String(body.email || '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return send(res, 400, { error: 'Enter a valid email address.' });
  }

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const emailHash = createHash('sha256').update(email).digest('hex');
  const ipHash = createHash('sha256').update(ip).digest('hex').slice(0, 24);
  const submittedAt = new Date().toISOString();
  const record = JSON.stringify({ email, submittedAt, source: 'website' });
  const script = [
    "local n = redis.call('INCR', KEYS[3])",
    "if n == 1 then redis.call('EXPIRE', KEYS[3], 3600) end",
    "if n > 20 then return -1 end",
    "if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end",
    "redis.call('SET', KEYS[1], ARGV[1])",
    "redis.call('HSET', KEYS[2], ARGV[2], ARGV[3])",
    "return 1"
  ].join('\n');

  try {
    const response = await fetch(redisUrl.replace(/\/$/, ''), {
      method: 'POST',
      headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['EVAL', script, '3', `waitlist:email:${emailHash}`, 'waitlist:entries', `waitlist:rate:${ipHash}`, submittedAt, email, record])
    });
    if (!response.ok) throw new Error(`Storage responded with ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    if (data.result === -1) return send(res, 429, { error: 'Too many attempts. Please try again later.' });
    if (data.result === 0) return send(res, 200, { ok: true, duplicate: true });
    return send(res, 201, { ok: true, duplicate: false });
  } catch (error) {
    console.error('Waitlist submission failed:', error.message);
    return send(res, 500, { error: 'We couldn’t save your place. Please try again.' });
  }
};
