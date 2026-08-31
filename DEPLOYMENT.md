# Free deployment: GitHub Pages and Cloudflare

The web client is deployed to GitHub Pages. A Cloudflare Worker runs the API
and a D1 database stores shared data. GitHub Pages cannot run an API or persist
a database by itself, so GitHub-only hosting is not possible for this app.

## 1. Create and configure Cloudflare

1. Create a Cloudflare account on its Workers Free plan.
2. Follow [worker/README.md](worker/README.md): create the D1 database, copy
   its ID into `worker/wrangler.toml`, apply the migration, set `JWT_SECRET`,
   and deploy the Worker.
3. Copy the deployed Worker URL and append `/api`, for example:
   `https://shared-expense-tracker-api.<your-subdomain>.workers.dev/api`.
4. Set `ALLOWED_ORIGINS` on the Worker to your GitHub Pages URL if you want to
   restrict browser requests to your site.

## 2. Configure GitHub Pages

1. In GitHub, open **Settings > Pages** and set **Source** to **GitHub
   Actions**.
2. Open **Settings > Secrets and variables > Actions > Variables** and add:

   | Variable | Value |
   | --- | --- |
   | `VITE_API_URL` | `https://<worker>.<your-subdomain>.workers.dev/api` |

3. Push to `main`, or run **Deploy web app to GitHub Pages** manually.

The workflow deliberately fails when `VITE_API_URL` is missing rather than
publishing a web app that points to localhost.

## Limitations

GitHub Pages does not host native mobile apps. Set
`EXPO_PUBLIC_API_URL=https://<worker>.<your-subdomain>.workers.dev/api` before
building the Expo app.

The free Worker/D1 implementation supports email/password accounts and shared
data. It intentionally excludes Google sign-in, email verification/delivery,
receipt uploads, and PDF exports because those features require an additional
provider or storage service. CSV exports remain available.

## Cost and limits

GitHub Pages is free for public repositories. Cloudflare's Workers Free plan
has daily limits: 100,000 Worker requests, 5 million D1 rows read, 100,000 D1
rows written, and 5 GB D1 storage. At a free limit, the affected request fails
until the limit resets; no charge occurs unless you explicitly upgrade.
