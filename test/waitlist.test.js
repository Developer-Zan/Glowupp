const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/waitlist');

function request(body, method = 'POST') {
  return { method, body, headers: { 'x-forwarded-for': '127.0.0.1' }, socket: {} };
}

function response() {
  return {
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    end(value) { this.body = JSON.parse(value); }
  };
}

test('rejects unsupported methods', async () => {
  const res = response();
  await handler(request({}, 'GET'), res);
  assert.equal(res.statusCode, 405);
});

test('validates email before storage', async () => {
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'secret';
  const res = response();
  await handler(request({ email: 'not-an-email' }), res);
  assert.equal(res.statusCode, 400);
});

test('rejects invalid JSON', async () => {
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'secret';
  const res = response();
  await handler(request('{'), res);
  assert.equal(res.statusCode, 400);
});

test('stores a valid email', async t => {
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'secret';
  t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({ result: 1 }) }));
  const res = response();
  await handler(request({ email: 'Hello@Example.com' }), res);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, { ok: true, duplicate: false });
});

test('returns a successful duplicate state', async t => {
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'secret';
  t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({ result: 0 }) }));
  const res = response();
  await handler(request({ email: 'hello@example.com' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.duplicate, true);
});
