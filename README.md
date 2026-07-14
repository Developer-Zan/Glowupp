# Upp landing page

The site is a dependency-free static landing page with a Vercel serverless waitlist endpoint.

## Waitlist setup

1. Create an Upstash Redis database.
2. Copy `.env.example` to `.env.local` and add the REST URL and token.
3. Add the same variables to the Vercel project environment.
4. Deploy the project to Vercel.

The endpoint validates email addresses, rate-limits submissions, and atomically prevents duplicate entries. Emails are stored in the `waitlist:entries` Redis hash. Secrets are read only by `api/waitlist.js` and are never sent to the browser.

## Verification

Run `npm run build` to syntax-check the endpoint and execute its tests.
