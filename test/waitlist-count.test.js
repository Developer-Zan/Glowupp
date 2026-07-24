const test = require('node:test');
const assert = require('node:assert/strict');
const { handler } = require('../netlify/functions/waitlist-count');

test('count endpoint only allows GET', async () => {
  const response = await handler({ httpMethod: 'POST' });
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, 'GET');
});

test('count endpoint reports missing configuration safely', async () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 503);
});

test('count endpoint returns only the unique signup count', async t => {
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'secret';
  let command;
  t.mock.method(global, 'fetch', async (_url, options) => {
    command = JSON.parse(options.body);
    return { ok: true, json: async () => ({ result: 127 }) };
  });

  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { count: 127 });
  assert.deepEqual(command, ['HLEN', 'waitlist:entries']);
  assert.match(response.headers['Netlify-CDN-Cache-Control'], /s-maxage=60/);
});

test('count endpoint rejects invalid storage responses', async t => {
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'secret';
  t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({ result: 'invalid' }) }));
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 500);
});
