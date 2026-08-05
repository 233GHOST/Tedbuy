# Deployment and Firebase Auth Setup

This document lists required environment variables and steps to ensure custom password reset links (using `https://tedbuy.store/__/auth/handler`) work reliably.

## Required environment variables
- `FIREBASE_SERVICE_ACCOUNT_KEY` — JSON content of a Firebase service account (string). Example: paste the JSON or base64-encoded JSON into this variable for your host.
- `GOOGLE_APPLICATION_CREDENTIALS` (optional) — path to service account JSON on the filesystem (use instead of `FIREBASE_SERVICE_ACCOUNT_KEY` if preferred).
- `VITE_FIREBASE_API_KEY` / `FIREBASE_API_KEY` — the Web API key for your Firebase project.
- `VITE_FIREBASE_AUTH_DOMAIN` / `FIREBASE_AUTH_DOMAIN` — should be `www.tedbuy.store` or `tedbuy.store` (client uses `VITE_FIREBASE_AUTH_DOMAIN`).
- `VITE_FIREBASE_PROJECT_ID` / `FIREBASE_PROJECT_ID` — Firebase project id.
- `BREVO_API_KEY` — API key for Brevo (transactional email provider).
- `BREVO_SENDER_EMAIL` — sender address used for transactional emails (e.g. `support@tedbuy.store`).

## GCP / Firebase console steps
1. Create a Service Account in Google Cloud Console for your Firebase project.
2. Grant it permissions: at minimum add the **Firebase Authentication Admin** role (or the equivalent IAM role that allows managing auth and generating OOB links). Also ensure the service account can be used by your runtime (Service Account User / Token Creator where required).
3. Download the service account JSON and either:
   - Paste the JSON into your host's secret `FIREBASE_SERVICE_ACCOUNT_KEY` (recommended), or
   - Upload the file and set `GOOGLE_APPLICATION_CREDENTIALS` to its path.
4. In the Firebase Console -> Authentication -> Settings -> Authorized domains, add:
   - `tedbuy.store`
   - `www.tedbuy.store`

## Identity Toolkit & API key notes
- If your app falls back to the Firebase REST path, the REST API needs the Identity Toolkit API enabled in the Google Cloud Console for your project.
- Ensure the `VITE_FIREBASE_API_KEY` (Web API key) is not overly restricted by referrer or IP restrictions during troubleshooting — restrictive API key settings can cause `INSUFFICIENT_PERMISSION` when requesting `returnOobLink`.

## How to store the service account JSON safely
- Many hosts let you paste a secret value. Either paste the raw JSON (as `FIREBASE_SERVICE_ACCOUNT_KEY`) or store a base64-encoded value and have your runtime decode it into a file at startup.

Example `.env` snippet (local development only):
```
FIREBASE_SERVICE_ACCOUNT_KEY='{"type":"service_account",...}'
VITE_FIREBASE_API_KEY=your_web_api_key
VITE_FIREBASE_AUTH_DOMAIN=www.tedbuy.store
BREVO_API_KEY=xxxx
BREVO_SENDER_EMAIL=support@tedbuy.store
```

## Verifying the setup
1. Deploy changes and confirm the `server` logs show `Generated authentic Firebase OOB code via Admin SDK` when you call `/api/auth/send-password-reset`.
2. If you see `Unable to obtain OOB code` in logs, check service account JSON, IAM roles, and that `FIREBASE_SERVICE_ACCOUNT_KEY` is present in your environment.
3. Test using:
```bash
curl -X POST https://tedbuy.store/api/auth/send-password-reset \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

## Troubleshooting
- `INSUFFICIENT_PERMISSION` from the Identity Toolkit REST call: verify Identity Toolkit API is enabled and the API key is not restricted.
- Admin SDK errors about credentials: ensure `FIREBASE_SERVICE_ACCOUNT_KEY` is present and valid, or `GOOGLE_APPLICATION_CREDENTIALS` points to a valid JSON file.
- If you prefer the Admin SDK method (recommended), ensure the service account is available to the runtime — many hosts support uploading a JSON secret.

If you want, I can add provider-specific commands for Vercel, Render, or Netlify to store the secret.

## Render (recommended setup)

Use the Render Dashboard to securely add the service account JSON and related env vars to your service. GUI steps are safest:

1. Open the Render dashboard and select the service that runs your backend (e.g., `tedbuy-api` or the Web Service for this repo).
2. Go to the **Environment** tab (or **Environment Secrets** / **Environment Variables** section).
3. Add a new secret / env var named `FIREBASE_SERVICE_ACCOUNT_KEY` and paste the full service account JSON as the value.
   - If Render offers a separate _Secrets_ area, prefer that over a plain environment variable so the value is masked.
4. Add the other variables listed above: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`.
5. Save and redeploy (or restart) the service so the new secrets are available to the runtime.

Notes:
- If you prefer not to paste raw JSON into the dashboard, base64-encode the JSON locally and set an env var such as `FIREBASE_SERVICE_ACCOUNT_KEY_BASE64`, then decode it at runtime in your start script (or update `server.ts` to support it).

Base64 example (local):

```bash
base64 -w0 service-account.json > service-account.json.b64
# copy the single-line content and paste into Render's secret value
```

Verification steps on Render:
1. After deployment, open the service Logs in Render.
2. Trigger a password-reset request (use the `curl` example earlier) and watch logs for the message: `Generated authentic Firebase OOB code via Admin SDK`.
3. If you see `Unable to obtain OOB code`, check the secret value and IAM roles.

