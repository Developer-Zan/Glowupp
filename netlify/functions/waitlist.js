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

async function sendConfirmationEmail(email, emailHash) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.WAITLIST_FROM_EMAIL;
  if (!apiKey || !from) {
    console.warn('Confirmation email is not configured.');
    return false;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `upp-waitlist-${emailHash}`
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: 'You’re on the Upp waitlist',
        text: [
          'You’re in.',
          '',
          'Thanks for joining the Upp early-access waitlist. We’ll email you when your invitation is ready.',
          '',
          'Keep moving Upp.'
        ].join('\n'),
        html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#0b0b0b;color:#f7f7f4;font-family:Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;">Your place on the Upp early-access waitlist is confirmed.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b0b0b;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#151515;border:1px solid #2b2b29;border-radius:22px;">
          <tr><td style="padding:40px;">
            <div style="font-size:22px;font-weight:800;margin-bottom:32px;"><span style="display:inline-block;background:#ff5a0a;border-radius:9px;padding:5px 9px;margin-right:8px;">U</span>upp</div>
            <div style="color:#ff6a1a;font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;margin-bottom:14px;">Early access confirmed</div>
            <h1 style="font-size:38px;line-height:1.05;letter-spacing:-1.5px;margin:0 0 20px;">You’re on the list.</h1>
            <p style="color:#aaa9a5;font-size:17px;line-height:1.65;margin:0 0 18px;">Thanks for joining the Upp early-access waitlist. We’ll email you when your invitation is ready.</p>
            <p style="color:#f7f7f4;font-size:16px;font-weight:700;margin:28px 0 0;">Keep moving <span style="color:#ff5a0a;">Upp.</span></p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
      })
    });

    if (!response.ok) throw new Error(`Resend responded with ${response.status}`);
    return true;
  } catch (error) {
    console.error('Confirmation email failed:', error.message);
    return false;
  }
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
    "if n > 20 then return {-1, redis.call('HLEN', KEYS[2])} end",
    "if redis.call('EXISTS', KEYS[1]) == 1 then return {0, redis.call('HLEN', KEYS[2])} end",
    "redis.call('SET', KEYS[1], ARGV[1])",
    "redis.call('HSET', KEYS[2], ARGV[2], ARGV[3])",
    "return {1, redis.call('HLEN', KEYS[2])}"
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
    const [result, rawCount] = Array.isArray(data.result) ? data.result : [data.result, null];
    const count = Number.isInteger(Number(rawCount)) ? Number(rawCount) : null;
    if (result === -1) return json(429, { error: 'Too many attempts. Please try again later.' });
    if (result === 0) return json(200, { ok: true, duplicate: true, count });

    const confirmationSent = await sendConfirmationEmail(email, emailHash);
    return json(201, { ok: true, duplicate: false, count, confirmationSent });
  } catch (error) {
    console.error('Waitlist submission failed:', error.message);
    return json(500, { error: 'We couldn’t save your place. Please try again.' });
  }
}

exports.handler = handler;
exports.json = json;
exports.sendConfirmationEmail = sendConfirmationEmail;
