function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=30, stale-while-revalidate=300',
      'Netlify-CDN-Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };
}

async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed.' }, { Allow: 'GET' });
  }

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) {
    console.error('Waitlist count storage is not configured.');
    return json(503, { error: 'The waitlist count is temporarily unavailable.' });
  }

  try {
    const response = await fetch(redisUrl.replace(/\/$/, ''), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redisToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['HLEN', 'waitlist:entries'])
    });

    if (!response.ok) throw new Error(`Storage responded with ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    const count = Number(data.result);
    if (!Number.isInteger(count) || count < 0) throw new Error('Storage returned an invalid count');
    return json(200, { count });
  } catch (error) {
    console.error('Waitlist count failed:', error.message);
    return json(500, { error: 'The waitlist count is temporarily unavailable.' });
  }
}

exports.handler = handler;
exports.json = json;
