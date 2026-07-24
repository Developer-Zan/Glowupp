# Upp landing page

The site is a dependency-free static landing page deployed by Netlify. Waitlist submissions are handled by a Netlify Function and stored in Upstash Redis.

## Netlify setup

1. Create an Upstash Redis database.
2. In **Netlify → Project configuration → Environment variables**, add:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   - `RESEND_API_KEY`
   - `WAITLIST_FROM_EMAIL` (for example, `Upp <hello@yourdomain.com>`)
3. Make all variables available to the **Functions** scope.
4. Trigger a fresh production deploy after saving them.

Do not put the real token in this repository or in `netlify.toml`. The standard token is only read by `netlify/functions/waitlist.js` at runtime.

Before adding the Resend variables, verify your sending domain in Resend. The confirmation email is sent only for a new address and uses an idempotency key to prevent duplicate delivery. A temporary email-provider failure does not remove the signup.

The frontend posts to `/api/waitlist`. Netlify rewrites that path to the deployed function using `netlify.toml`. Emails are stored in the `waitlist:entries` Redis hash with atomic duplicate protection and per-IP rate limiting. The public `/api/waitlist-count` endpoint returns only the unique-entry count and is cached; it never exposes addresses.

## Local verification

With Node.js installed:

```sh
npm run check
npm run build
```

Use `netlify dev` when you want to test the complete function route locally with values from a local `.env` file.
