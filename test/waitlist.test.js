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
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'secret';
  const response = await handler(event({ email: 'not-an-email' }));
  assert.equal(response.statusCode, 400);
});

test('rejects invalid JSON', async () => {
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'secret';
  const response = await handler(event('{'));
  assert.equal(response.statusCode, 400);
});

test('stores and normalizes a valid email', async t => {
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'secret';
  let command;
  t.mock.method(global, 'fetch', async (_url, options) => {
    command = JSON.parse(options.body);
    return { ok: true, json: async () => ({ result: 1 }) };
  });
  const response = await handler(event({ email: ' Hello@Example.com ' }));
  assert.equal(response.statusCode, 201);
  assert.deepEqual(parsed(response), { ok: true, duplicate: false });
  assert.equal(command[7], 'hello@example.com');
});

test('returns a successful duplicate state', async t => {
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'secret';
  t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({ result: 0 }) }));
  const response = await handler(event({ email: 'hello@example.com' }));
  assert.equal(response.statusCode, 200);
  assert.equal(parsed(response).duplicate, true);
});

test('rate-limits abusive clients', async t => {
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'secret';
  t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({ result: -1 }) }));
  const response = await handler(event({ email: 'hello@example.com' }));
  assert.equal(response.statusCode, 429);
});
