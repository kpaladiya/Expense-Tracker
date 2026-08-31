# Cloudflare Worker API (free tier)

This directory contains the Cloudflare Worker backed only by D1. The static
React application can remain on GitHub Pages; point its `VITE_API_URL` at
`https://<worker>.<account>.workers.dev/api` when building the Pages site.

## Deploy

1. Install Wrangler if it is not already available (`npm install -g wrangler`) and
   authenticate with `wrangler login`.
2. From this directory create the database:
   `wrangler d1 create shared-expense-tracker`.
3. Copy the reported `database_id` into `wrangler.toml`. Keep the `DB` binding.
4. Apply the schema:
   `wrangler d1 migrations apply shared-expense-tracker --remote`.
   For local development use `--local` instead.
5. Create `worker/.dev.vars` from `.dev.vars.example` for local development.
   For production, set the secret without committing it:
   `wrangler secret put JWT_SECRET`.
   Optionally set a comma-separated Pages allowlist:
   `wrangler secret put ALLOWED_ORIGINS`.
6. Deploy: `wrangler deploy`.

Run locally with `wrangler dev`. No Worker npm dependencies are required.

## Authentication and limitations

Registration and login use Web Crypto PBKDF2-SHA-256 password hashes and HMAC
SHA-256 signed bearer tokens. Tokens expire after seven days; logout revokes the
current token in D1. This implementation deliberately has no Google login,
email activation/delivery, or object-storage integration.

Worker responses retain the frontend REST contract. In particular, settlement
responses expose `transferSuggestions` and each member balance includes
`amountSpent`, `amountReceived`, `netAfterOwnActivity`, `profitShare`, and
`balance`. Monthly summaries provide nested `totals` and `records`.

Attachment upload endpoints are **not supported**. Requests containing a file
return `501`; D1 cannot safely store receipt files and adding R2 would introduce
another Cloudflare service. CSV exports are supported. The PDF route returns a
clear `501` response because generating PDFs without a dependency/service is not
practical on this free, dependency-free Worker.
