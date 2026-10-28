# Dropship Inside the App (WebView + Sign-in Handoff) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the Android app, Profile → TedBuy Dropship opens the Dropship hub inside the app (an embedded WebView screen, no Chrome UI), already signed in as the app's user, with the website's own header/footer hidden.

**Architecture:** The app asks the server for a short-lived Firebase custom token for the signed-in user (`POST /api/auth/app-handoff`, authenticated with the app's Firebase ID token). A new native screen hosts a `react-native-webview` WebView on `https://www.tedbuy.store/dropship?embed=app`; once the page signals it is ready, the app posts the custom token to it, and the web app signs in with `signInWithCustomToken`. The web app's "embedded" mode hides its chrome and routes non-TedBuy links back to the app. If the server can't mint tokens (no Firebase service-account key on the host), the endpoint answers 503 and the app falls back to today's Chrome Custom Tab.

**Tech Stack:** Express + firebase-admin (`server.ts`), React web app (Vite), Expo SDK 57 / React Native 0.86 with `react-native-webview` 13.16.1 (already a dependency).

**Spec:** Owner decision 2026-10-28 ("keep everything inside the app", route 1), extending TedBuy Dropship v0.2.3 UI_UX_SPEC §1 (management pages are the responsive website opened inside the app). Previous plan: `docs/superpowers/plans/2026-10-28-dropship-mobile-catchup.md`.

## Global Constraints

- Custom tokens are minted only for the verified caller's own uid (`verifyUser(authHeader)` with NO impersonation argument), never for a uid from the request body; impersonated sessions get 403.
- Token handoff happens only into a page whose current URL origin is exactly `https://www.tedbuy.store` (check in the app before posting; check `event.origin`/page origin on the web side). Never put the token in a URL, a log line, or storage the app persists.
- The WebView loads only `https://www.tedbuy.store` pages; any navigation to another origin is cancelled in the WebView and opened with `Linking.openURL` instead. `setSupportMultipleWindows={false}`.
- Rate limit on the handoff endpoint: 20 per minute per IP (existing `serverRateLimiter`).
- Handoff failure modes: 401 (no/invalid token), 403 (impersonation or restricted account per the existing `ACCOUNT_RESTRICTED` rules if present — at least suspended/deleted users must be refused), 503 `{ error: 'App sign-in handoff is not available' }` when the Admin SDK cannot sign tokens. The app treats 503 (and any network failure) as "fall back to the Chrome Custom Tab".
- Embedded mode on the web is entered only when BOTH `?embed=app` is in the URL AND `window.ReactNativeWebView` exists; in embedded mode the site hides its top navbar, mobile bottom nav and footer; everything else (including the admin PIN gate) works unchanged.
- Android hardware Back inside the screen goes back in WebView history first; at the first page it closes the screen.
- Ordinary website behaviour (not embedded) is unchanged.

## Review Focus

1. The app user switches accounts (sign out, sign in as someone else) and reopens Dropship: the WebView must end up signed in as the NEW user, never the previous one. Test in Task 3 (web-side: a handoff for a different uid signs out first, then signs in).
2. The server has no service-account key: the card still works (Chrome tab fallback), with no error alert loop. Test in Task 1 (503 path) and Task 2 (fallback decision helper).
3. A page inside the WebView links to WhatsApp, Paystack or any other site: it opens outside the WebView, and the token is never posted to that site. Test in Task 2 (origin decision helper).
4. A slow or offline network while opening Dropship: a visible loading state and a retry/close option, not a blank screen. Task 2 UI.
5. Uploading product photos from inside the WebView (supplier form) works on Android (file chooser). Device check in Task 4.

---

### Task 1: Server — `POST /api/auth/app-handoff`

**Files:**
- Create: `server/auth/appHandoff.ts` (`decideAppHandoff(input: { verified: { uid: string; isImpersonating?: boolean; originalAdmin?: unknown } | null; restricted: boolean }): { ok: true; uid: string } | { ok: false; status: 401 | 403; error: string }`)
- Create: `server/auth/appHandoff.test.ts` (add to `test:auth` in `package.json`)
- Modify: `server.ts` (register the route next to the other `/api/auth/*` routes; mint with `getAdminAuth().createCustomToken(uid, { via: 'app_handoff' })`; any error from `createCustomToken` → 503 with the exact body above; check the account restriction with the same users-row fields the Dropship gate uses: `isSuspended`, `securityHold`, `isDeleted`, `status in ('suspended','deleted')`)

**Interfaces:**
- Produces: `POST /api/auth/app-handoff` with header `Authorization: Bearer <Firebase ID token>`, empty body → `200 { success: true, customToken: string }` | 401 | 403 | 503 | 429.

- [ ] **Step 1: Failing tests** for `decideAppHandoff`: null verified → 401; impersonating (`originalAdmin` set or `isImpersonating`) → 403; restricted → 403; normal → `{ ok: true, uid }` with the verified uid.
- [ ] **Step 2: Run** `npx tsx --test server/auth/appHandoff.test.ts` → FAIL.
- [ ] **Step 3: Implement** the helper and the route.
- [ ] **Step 4: Verify** `npm run test:auth && npx tsx --test server.test.ts && npx tsc --noEmit -p . && npm run build` → pass.
- [ ] **Step 5: Commit.**

### Task 2: App — embedded Dropship screen

**Files:**
- Create: `mobile/src/screens/DropshipWebScreen.tsx` (native-stack screen: header with title "TedBuy Dropship" and close; WebView on `https://www.tedbuy.store/dropship?embed=app`; loading overlay; error state with Retry and "Open in browser"; Android Back handling; message bridge)
- Create: `mobile/src/utils/webHandoff.ts` (`isTedbuyOrigin(url: string): boolean` — true only for `https://www.tedbuy.store` and paths under it; `shouldFallbackToBrowser(status: number | 'network'): boolean` — true for 503 and 'network'; `HANDOFF_MESSAGE_TYPE = 'tedbuy-handoff'`, `READY_MESSAGE_TYPE = 'tedbuy-embed-ready'`, `SIGNED_IN_MESSAGE_TYPE = 'tedbuy-embed-signed-in'`)
- Create: `mobile/src/utils/webHandoff.test.ts`
- Modify: `mobile/src/navigation/index.tsx` (register `DropshipWeb`), `mobile/src/screens/ProfileScreen.tsx` (card navigates to `DropshipWeb` instead of opening the Custom Tab), `mobile/src/firebase.ts` (`requestAppHandoffToken(): Promise<{ ok: true; token: string } | { ok: false; status: number | 'network' }>` using the current user's ID token)

**Interfaces:**
- Consumes: Task 1 endpoint.
- Produces (message contract with the web app, JSON strings):
  - page → app: `{ type: 'tedbuy-embed-ready', uid: string | null }` (posted on load and after auth changes), `{ type: 'tedbuy-embed-signed-in', uid: string }`.
  - app → page: `{ type: 'tedbuy-handoff', token: string, uid: string }` posted with `webviewRef.postMessage` only after a `ready` message whose `uid` differs from the app user's uid, and only when the WebView's current URL passes `isTedbuyOrigin`.

- [ ] **Step 1: Failing tests:** `isTedbuyOrigin('https://www.tedbuy.store/dropship?embed=app') === true`; `('https://tedbuy.store/x') === false`; `('https://www.tedbuy.store.evil.com/') === false`; `('http://www.tedbuy.store/') === false`; `('https://evil.com/?u=https://www.tedbuy.store') === false`; `shouldFallbackToBrowser(503) === true`, `('network') === true`, `(401) === false`, `(403) === false`.
- [ ] **Step 2: Run** `cd mobile && node --test src/utils/webHandoff.test.ts` → FAIL.
- [ ] **Step 3: Implement.** On 401/403 from the handoff show an Alert ("Couldn't sign you in to Dropship") and close; on fallback statuses open the Custom Tab (existing `WebBrowser.openBrowserAsync`) and close the screen. `onShouldStartLoadWithRequest`: allow only `isTedbuyOrigin`, otherwise `Linking.openURL` and return false. Enable file uploads on Android (react-native-webview defaults allow `<input type=file>`; set `allowFileAccess` only if required by the library docs for SDK 57 — check `mobile/AGENTS.md` and the library README).
- [ ] **Step 4: Verify** `cd mobile && node --test src/utils/webHandoff.test.ts src/utils/dropship.test.ts src/regions.test.ts && npx tsc --noEmit -p .` → pass.
- [ ] **Step 5: Commit.**

### Task 3: Web — embedded mode and handoff receiver

**Files:**
- Create: `src/utils/embeddedApp.ts` (`isEmbeddedApp(search: string, hasBridge: boolean): boolean`; `parseHandoffMessage(raw: unknown): { token: string; uid: string } | null` — accepts only a JSON string or object with `type === 'tedbuy-handoff'`, non-empty string `token` and `uid`)
- Create: `src/utils/embeddedApp.test.ts` (add to `test:dropship` or a new `test:web` script — prefer adding to `test:dropship` to keep CI simple)
- Modify: `src/App.tsx` and/or `src/components/Navbar.tsx` and the bottom-nav/footer components (hide in embedded mode), `src/context/AppContext.tsx` (listen for `message` events on `window` and `document` — react-native-webview delivers to both on Android; on a valid handoff: if `auth.currentUser?.uid !== uid`, sign out first when someone else is signed in, then `signInWithCustomToken(auth, token)`; post `tedbuy-embed-ready` with the current uid on mount and on every auth state change, and `tedbuy-embed-signed-in` after a successful handoff, via `window.ReactNativeWebView.postMessage(JSON.stringify(...))`)

**Interfaces:**
- Consumes: Task 2 message contract.

- [ ] **Step 1: Failing tests:** `isEmbeddedApp('?embed=app', true) === true`, `('?embed=app', false) === false`, `('', true) === false`; `parseHandoffMessage('{"type":"tedbuy-handoff","token":"t","uid":"u"}')` → `{token:'t',uid:'u'}`; wrong type, missing token, non-JSON, object form, empty strings → null.
- [ ] **Step 2: Run** `npx tsx --test src/utils/embeddedApp.test.ts` → FAIL.
- [ ] **Step 3: Implement** (embedded mode is computed once at startup from `window.location.search` and `!!window.ReactNativeWebView`, then kept in app state so hash-route changes don't drop it).
- [ ] **Step 4: Verify** `npm run test:dropship && npx tsc --noEmit -p . && npm run build` → pass.
- [ ] **Step 5: Commit.**

### Task 4: Release (owner + controller)

- [ ] Owner confirms Render has `GOOGLE_SERVICE_ACCOUNT_JSON` or `FIREBASE_SERVICE_ACCOUNT_KEY` set (names only). If not, decide whether to add one (Firebase console → Project settings → Service accounts → Generate new private key) or accept the Chrome-tab fallback.
- [ ] Merge `dropship-mobile-catchup` to `main` and push (Render deploys server + web).
- [ ] Bump `mobile/app.json` version to `1.2.0`; owner builds `npx eas-cli@latest build -p android --profile production-apk`; publish GitHub release `v1.2.0` with asset `tedbuy.apk`; set Render `ANDROID_APP_VERSION=1.2.0`, `ANDROID_APK_RELEASE_DATE`.
- [ ] Device checks: card opens Dropship inside the app already signed in; no TedBuy website header/footer inside; Back navigates inside then closes; switching app accounts switches the Dropship account; a supplier can upload a product photo inside; a WhatsApp/external link opens outside; with the key missing, the card falls back to the Chrome tab.
