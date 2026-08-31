# Shared Expenses

Shared Expenses lets groups record expenses and payments, track balances, and
settle shared accounts.

## Free hosting

The production web app is hosted on GitHub Pages. A Cloudflare Worker and D1
database provide the API, authentication, and shared data within Cloudflare's
free daily limits. No AWS, EC2, SMTP server, or paid deployment service is
required.

Follow [DEPLOYMENT.md](DEPLOYMENT.md) to configure Cloudflare and publish the web
app. The GitHub Actions workflow refuses to deploy until `VITE_API_URL` is set.

## Local development

```bash
cd frontend
npm ci
npm run dev
```

Set `VITE_API_URL` to the local or deployed Cloudflare Worker API URL before
signing in. See `worker/README.md` for backend setup.

The Expo mobile app is separate from GitHub Pages. Set
`EXPO_PUBLIC_API_URL` to the Cloudflare Worker API URL before building it.
