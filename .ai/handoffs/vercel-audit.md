# Vercel Legacy Infrastructure Audit

**Status:** Read-only audit complete. No files modified or deleted.
**Date:** 2026-09-14
**Context:** TedBuy's production hosting is Render (confirmed live: `www.tedbuy.store` responds with `x-render-origin-server: Render`, fronted by Cloudflare). This audit inventories every Vercel-related artifact still in the repo, classifies it, and recommends a cleanup path — for Vincent to review and approve before anything is deleted.

## Live verification performed (read-only, no secrets touched)

| Check | Result |
|---|---|
| `curl https://www.tedbuy.store/` | `HTTP 200`, `x-render-origin-server: Render`, `server: cloudflare` — confirms Render is the real origin |
| `curl https://tedbuy.vercel.app/` | `HTTP 402` (Vercel's own "payment required / project suspended" response) — the Vercel project still exists at the platform level but is not serving the app |
| DNS: `tedbuy.store` / `www.tedbuy.store` | Resolve to Cloudflare IP ranges (`172.67.x.x`, `2606:4700:...`) — no Vercel IPs anywhere in the resolution chain |
| `package.json` | No Vercel dependency, build script, or `vercel-build` entry |
| `server.ts` | Zero references to any `VERCEL*` environment variable |
| `.vercel/` directory | Does not exist (no Vercel CLI project link cache) |

**Conclusion: production traffic has zero live dependency on Vercel today.** Everything found below is dead weight in the repo, with one exception (see Navbar.tsx below) that has residual *user-facing* content referencing the old domain.

## Inventory & classification

| Item | What it is | Classification | Evidence |
|---|---|---|---|
| `vercel.json` (repo root) | Full Vercel routing config: security headers, `.well-known` content-types, sitemap/robots rewrites, SPA catch-all rewrite | **LEGACY** | Render doesn't read this file at all — `render.yaml` is the actual deploy config, and `server.ts` implements its own equivalent headers/rewrites natively for Express (confirmed by reading the file: identical CSP/security headers exist server-side). Not read by anything in the current production path. |
| `middleware.ts` (repo root) | Vercel Edge Middleware — serves a markdown "AI agent" version of the homepage based on `Accept: text/markdown`, at the edge, before Vercel's cache | **LEGACY** | The file's own top comment says it "mirrors the exact markdown content `server.ts`'s own negotiation middleware returns" — i.e. it was a Vercel-specific implementation of logic that already exists natively in `server.ts` for the Express/Render path. Vercel Edge Middleware is a platform-specific runtime concept; Render never executes this file. |
| `api/index.ts` | 3-line Vercel serverless-function entry point (`export default app` from `server.js`) | **LEGACY** | Vercel's `/api` directory convention for serverless functions. Render runs `dist/server.cjs` directly via `npm start` (see `render.yaml`) — this file is never invoked in production. Harmless (tiny, no logic of its own) but unused. |
| `DEPLOY.md` line 55 | One sentence: "If you want, I can add provider-specific commands for Vercel, Render, or Netlify..." | **LEGACY** (documentation only) | No functional impact — informational leftover from when multiple hosting options were being considered. The same doc's "Render (recommended setup)" section below it is the actually-current guidance. |
| `src/components/Navbar.tsx` (~line 726) | Hardcoded **user-facing** error string listing `tedbuy.vercel.app` as a domain to whitelist in Firebase Auth, shown after a rare 5-tap admin-reveal gesture on a Firebase "unauthorized domain" error | **LEGACY — confirmed stale, user-facing** | Live-verified: `tedbuy.vercel.app` returns `HTTP 402` (broken/suspended), not a working fallback domain. This is the **one item in this audit with real current user impact** — a real user who somehow triggers this rare error path would be told to whitelist a domain that doesn't work. Everything else above is inert dead code; this is live copy. |
| The Vercel project itself (`tedbuy.vercel.app`, at the Vercel platform/account level) | Whatever project/deployment still exists in Vincent's Vercel account | **UNKNOWN** | I cannot see Vercel account/dashboard state from this repo — only that the subdomain still responds (with a 402, suggesting the project exists but is suspended, likely for billing/inactivity reasons, not that it's actively serving anything). Whether it's safe to fully delete from the Vercel dashboard is Vincent's call — it's outside this repo and outside what I can or should touch. |
| `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_URL` in `src/utils/sitemap.ts` | Not Vercel-specific, but worth noting since it came up in the same server-side-secrets sweep: server-only code, never bundled to the client — confirmed no client exposure. | N/A (not a Vercel item; included for completeness of the "shared infra" sweep) | See the earlier security-audit pass this session. |

## Nothing found in these categories

- **No** `VERCEL_*` environment variables referenced anywhere in `server.ts`, `src/`, or `mobile/src/`.
- **No** Vercel Postgres/KV/Blob storage usage — all storage is Supabase + Firebase + Cloudinary, unrelated to Vercel's own storage products.
- **No** Vercel Cron usage — `CRON_SECRET` (in `.env.example` / `render.yaml`) is a bespoke secret checked by TedBuy's own `/api/admin/retention/run-purge`-style endpoints, not a Vercel Cron integration; Render itself has no built-in cron primitive being used here either (this appears to be triggered by an external scheduler hitting the endpoint, unrelated to Vercel).
- **No** Vercel Analytics/Speed Insights script tags found in `index.html` or anywhere in `src/`.
- **No `SHARED` classification items** — nothing found that's still genuinely relied on by both Render and a live Vercel deployment simultaneously. Production is Render-only today.

## Recommended cleanup (for Vincent's approval — not yet executed)

1. **Update `src/components/Navbar.tsx`'s error copy** to drop the `tedbuy.vercel.app` line (or replace it with just `tedbuy.store` / `www.tedbuy.store`). This is the only item with real user-facing exposure, confirmed broken. Low-risk, single-string change.
2. **Delete `vercel.json`, `middleware.ts`, `api/index.ts`** — all three are confirmed unread by the current production path. Safe to remove once Vincent confirms there's no intent to ever redeploy to Vercel again (e.g., as a disaster-recovery fallback host) — worth asking explicitly before deleting, since "delete infrastructure config" is exactly the kind of irreversible-in-spirit action this audit was told to hold for approval, even though restoring these three small files from git history is trivial if ever needed.
3. **Trim the one-line Vercel mention in `DEPLOY.md`** — cosmetic, zero risk, can be bundled with the above.
4. **Vincent's own action, outside this repo:** decide whether to fully delete the `tedbuy.vercel.app` project from the Vercel dashboard/account (currently suspended/402, not deleted) — I have no visibility or access there, and it's unrelated to any file in this repository.

**None of the above has been executed.** This document is the read-only findings handoff requested. I'll wait for explicit approval before touching `vercel.json`, `middleware.ts`, `api/index.ts`, or `Navbar.tsx`.
