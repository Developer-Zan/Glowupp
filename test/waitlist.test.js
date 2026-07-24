const test = require('node:test');
const assert = require('node:assert/strict');
const { handler } = require('../netlify/functions/waitlist');

function event(body, httpMethod = 'POST') {
  return {
    httpMethod,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'x-nf-client-connection-ip': '127.0.0.1' }
  };
}

function parsed(response) {
  return JSON.parse(response.body);
}

function configureStorage() {
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'secret';
}

function configureEmail() {
  process.env.RESEND_API_KEY = 're_test';
  process.env.WAITLIST_FROM_EMAIL = 'Upp <hello@example.com>';
}

test('rejects unsupported methods', async () => {
  const response = await handler(event({}, 'GET'));
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, 'POST');
});

test('reports missing storage configuration safely', async () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const response = await handler(event({ email: 'hello@example.com' }));
  assert.equal(response.statusCode, 503);
});

test('validates email before storage', async () => {
  configureStorage();
  const response = await handler(event({ email: 'not-an-email' }));
  assert.equal(response.statusCode, 400);
});

test('rejects invalid JSON', async () => {
  configureStorage();
  const response = await handler(event('{'));
  assert.equal(response.statusCode, 400);
});

test('stores a new signup, returns the count, and sends confirmation', async t => {
  configureStorage();
  configureEmail();
  const requests = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    requests.push({ url, options });
    if (url === 'https://redis.example') {
      return { ok: true, json: async () => ({ result: [1, 42] }) };
    }
    return { ok: true, json: async () => ({ id: 'email_123' }) };
  });

  const response = await handler(event({ email: ' Hello@Example.com ' }));
  assert.equal(response.statusCode, 201);
  assert.deepEqual(parsed(response), {
    ok: true,
    duplicate: false,
    count: 42,
    confirmationSent: true
  });
  assert.equal(requests.length, 2);
  const redisCommand = JSON.parse(requests[0].options.body);
  assert.equal(redisCommand[7], 'hello@example.com');
  const emailRequest = JSON.parse(requests[1].options.body);
  assert.deepEqual(emailRequest.to, ['hello@example.com']);
  assert.match(requests[1].options.headers['Idempotency-Key'], /^upp-waitlist-/);
});

test('keeps a new signup when confirmation delivery fails', async t => {
  configureStorage();
  configureEmail();
  t.mock.method(global, 'fetch', async url => {
    if (url === 'https://redis.example') {
      return { ok: true, json: async () => ({ result: [1, 43] }) };
    }
    return { ok: false, status: 503 };
  });

  const response = await handler(event({ email: 'hello@example.com' }));
  assert.equal(response.statusCode, 201);
  assert.equal(parsed(response).confirmationSent, false);
  assert.equal(parsed(response).count, 43);
});

test('does not resend confirmation for a duplicate', async t => {
  configureStorage();
  configureEmail();
  let calls = 0;
  t.mock.method(global, 'fetch', async () => {
    calls += 1;
    return { ok: true, json: async () => ({ result: [0, 42] }) };
  });

  const response = await handler(event({ email: 'hello@example.com' }));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(parsed(response), { ok: true, duplicate: true, count: 42 });
  assert.equal(calls, 1);
});

test('rate-limits abusive clients', async t => {
  configureStorage();
  t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({ result: [-1, 42] }) }));
  const response = await handler(event({ email: 'hello@example.com' }));
  assert.equal(response.statusCode, 429);
});
