const { createHash } = require('node:crypto');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };
}

async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed.' }, { Allow: 'POST' });
  }

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) {
    console.error('Waitlist storage is not configured.');
    return json(503, { error: 'The waitlist is temporarily unavailable. Please try again soon.' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid request body.' });
  }

  // Quietly accept bot submissions so the honeypot cannot be probed.
  if (body.company) return json(200, { ok: true });

  const email = String(body.email || '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return json(400, { error: 'Enter a valid email address.' });
  }

  const headers = event.headers || {};
  const forwardedFor = headers['x-nf-client-connection-ip'] || headers['x-forwarded-for'] || 'unknown';
  const ip = String(forwardedFor).split(',')[0].trim();
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
      headers: {
        Authorization: `Bearer ${redisToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([
        'EVAL', script, '3',
        `waitlist:email:${emailHash}`,
        'waitlist:entries',
        `waitlist:rate:${ipHash}`,
        submittedAt,
        email,
        record
      ])
    });

    if (!response.ok) throw new Error(`Storage responded with ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    if (data.result === -1) return json(429, { error: 'Too many attempts. Please try again later.' });
    if (data.result === 0) return json(200, { ok: true, duplicate: true });
    return json(201, { ok: true, duplicate: false });
  } catch (error) {
    console.error('Waitlist submission failed:', error.message);
    return json(500, { error: 'We couldn’t save your place. Please try again.' });
  }
}

exports.handler = handler;
exports.json = json;
