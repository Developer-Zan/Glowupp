# Upp landing page

The site is a dependency-free static landing page deployed by Netlify. Waitlist submissions are handled by a Netlify Function and stored in Upstash Redis.

## Netlify setup

1. Create an Upstash Redis database.
2. In **Netlify → Project configuration → Environment variables**, add:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
3. Make both variables available to the **Functions** scope.
4. Trigger a fresh production deploy after saving them.

Do not put the real token in this repository or in `netlify.toml`. The standard token is only read by `netlify/functions/waitlist.js` at runtime.

The frontend posts to `/api/waitlist`. Netlify rewrites that path to the deployed function using `netlify.toml`. Emails are stored in the `waitlist:entries` Redis hash with atomic duplicate protection and per-IP rate limiting.

## Local verification

With Node.js installed:

```sh
npm run check
npm run build
```

Use `netlify dev` when you want to test the complete function route locally with values from a local `.env` file.
