# App Accounts Match the Website — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A correct 6-digit sign-up code marks the email as verified in Firebase (website and app), and the Android app's sign-up, sign-in, Google sign-in and welcome package work like the website's.

**Architecture:** The server remembers, for a short time, which emails passed the code check. A new authenticated endpoint `POST /api/auth/complete-registration` uses that record to set `emailVerified` in Firebase for the signed-in account with that email. The website and app both call it after creating the Firebase account and before `/api/users/sync`. The app gets ported validation, new API helpers in `mobile/src/firebase.ts`, and an auth panel component pulled out of `ProfileScreen.tsx`.

**Tech Stack:** Express + Firebase Admin (`server.ts`), React + Firebase web SDK (website), Expo SDK 57 / React Native + Firebase JS SDK + `@react-native-google-signin/google-signin` (app), `node:test` via `tsx --test` / `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-30-app-accounts-parity-design.md`

## Global Constraints

- Pushing `main` deploys website + server on Render together; the server and website changes go in one push (Task 3), and only with the owner's go-ahead.
- The app always calls `https://www.tedbuy.store` (`apiOrigin()` in `mobile/src/firebase.ts`), so app tasks are tested on the emulator against **live** after Task 3. Test accounts use throwaway emails and are deleted afterwards (Firebase project tedbuy-fb79a is shared by staging and live).
- The app version people have now (1.1.0) must keep working unchanged: `/api/users/sync`, `/api/auth/verify-registration-otp` and every existing endpoint keep their current request/response shapes.
- The 6-digit code expiry stays 10 minutes; codes stay in server memory.
- Read `mobile/AGENTS.md` and https://docs.expo.dev/versions/v57.0.0/ before writing app code.
- Reserved email `asumaduvincent7@gmail.com` cannot register; store names containing "tedbuy" are reserved (`isReservedStoreName`).
- The app keeps its own copies of shared logic in `mobile/src/utils/` with `node:test` tests (existing pattern).
- Never print `.env` values; check names and lengths only.

## Review Focus

1. **A code checked for one email verifies a different account.** Signed-in user's Firebase email ≠ checked email → 403, nothing changes. Test in Task 1.
2. **Code used twice / after 30 minutes.** The checked record is used up by the first successful completion and expires 30 min after the check. Tests in Task 1.
3. **Email case and spaces.** `Ama@Gmail.com ` checked and `ama@gmail.com` signed in must match. Test in Task 1.
4. **Account created but the verify step fails (network, server restart lost the record).** The user is told honestly, the account stays unverified, and the existing verification-link route still works. Website: Task 2 step; app: Task 5 step.
5. **Google sign-in for an email that already has a password account.** The user gets the password prompt and ends up with ONE account that has both sign-in methods. Emulator check in Task 7.

---

### Task 1: Server — code check marks the email verified

**Files:**
- Create: `server/auth/registrationVerification.ts`
- Create: `server/auth/registrationVerification.test.ts`
- Modify: `server.ts` — `/api/auth/verify-registration-otp` (~line 7314), new route right after it
- Modify: `package.json` — add the new test file to `test:auth`

**Interfaces:**
- Produces:
  - `export const CHECKED_EMAIL_TTL_MS = 30 * 60 * 1000`
  - `export function normalizeRegistrationEmail(email: string): string` (trim + lowercase)
  - `export function createCheckedEmailStore(now?: () => number): { markChecked(email: string): void; consume(email: string): boolean; has(email: string): boolean }`
  - `export function decideCompleteRegistration(input: { verified: { uid: string; email?: string | null; isImpersonating?: boolean; originalAdmin?: unknown } | null; impersonationHeaderPresent?: boolean; alreadyVerified: boolean; checked: boolean }): { ok: true; action: 'already-verified' | 'mark-verified' } | { ok: false; status: 400 | 401 | 403; error: string }`
  - Route `POST /api/auth/complete-registration` (Bearer Firebase ID token, no body) → `200 { success: true, emailVerified: true }` or `{ success: false, error }` with 400/401/403/500.

- [ ] **Step 0: Reproduce the website bug on live first (owner).** It cannot be reproduced locally: the local `.env` has no Firebase Admin service account (`FIREBASE_SERVICE_ACCOUNT_KEY` / `GOOGLE_SERVICE_ACCOUNT_JSON`) or `BREVO_API_KEY`, so locally `getUser()` fails and every account looks unverified regardless. The owner signs up on www.tedbuy.store with a throwaway email, enters the code, reloads the page. Expected (bug): amber "email ... is not yet verified" banner appears. Keep that account for the Task 3 check. If the banner does NOT appear, stop and report to the owner before continuing.

- [ ] **Step 1: Write the failing tests** in `server/auth/registrationVerification.test.ts` (style of `appHandoff.test.ts`):
  - `markChecked then consume -> true, second consume -> false`
  - `consume after CHECKED_EMAIL_TTL_MS -> false` (fake `now` advanced by `30*60*1000 + 1`)
  - `case and spaces are ignored`: `markChecked(' Ama@Gmail.com ')`, `consume('ama@gmail.com') === true`
  - `consume of an email never checked -> false`
  - `decide: verified null -> { ok:false, status:401 }`
  - `decide: impersonating (flag, originalAdmin, or header) -> 403`
  - `decide: no email on token -> 400`
  - `decide: alreadyVerified -> { ok:true, action:'already-verified' }` (even when `checked` is false)
  - `decide: checked false -> 403 'No checked sign-up code for this email. Request a new code.'`
  - `decide: checked true -> { ok:true, action:'mark-verified' }`

- [ ] **Step 2: Run** `npx tsx --test server/auth/registrationVerification.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `server/auth/registrationVerification.ts` with the Interfaces above. `has()` must not consume. Expired entries are dropped on access.

- [ ] **Step 4: Wire into `server.ts`.**
  - Module-level `const checkedRegistrationEmails = createCheckedEmailStore();`.
  - In `/api/auth/verify-registration-otp`, right after the existing `registrationOtpStore.delete(cleanEmail)` on success, call `checkedRegistrationEmails.markChecked(cleanEmail)`. Response shape unchanged.
  - New `app.post('/api/auth/complete-registration', serverRateLimiter(15 * 60 * 1000, 10, "complete-registration"), ...)`: `verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id'])`; read `alreadyVerified` from `getAdminAuth().getUser(verified.uid).emailVerified`; `checked = checkedRegistrationEmails.has(verified.email)` (do NOT consume yet, so a rejected request never uses up the record); call `decideCompleteRegistration`. On `mark-verified`: `checkedRegistrationEmails.consume(verified.email)` first (if it now returns false, a parallel request won → 403 as above), `getAdminAuth().updateUser(uid, { emailVerified: true })`, then best-effort `backendSupabase.from('users').update({ emailVerified: true }).eq('id', uid)` (the row may not exist yet; ignore "no row"). Respond `{ success: true, emailVerified: true }`. Errors → 500 with a generic message, no stack.
  - Add `server/auth/registrationVerification.test.ts` to the `test:auth` script.

- [ ] **Step 5: Verify** `npm run test:auth && npx tsx --test server.test.ts && npx tsc --noEmit -p . && npm run build` → all pass.

- [ ] **Step 6: Commit** `feat(server): sign-up code marks the email verified via /api/auth/complete-registration`.

### Task 2: Website — sign-up uses the server verification

**Files:**
- Modify: `src/context/AppContext.tsx` — `registerUser` (~line 2890)

**Interfaces:**
- Consumes: `POST /api/auth/complete-registration` (Task 1).

- [ ] **Step 1: Change `registerUser`** (real Firebase branch only; leave the sandbox branch alone): after `createUserWithEmailAndPassword`, call `/api/auth/complete-registration` with `getAuthHeader()`, up to 3 attempts 800 ms apart (same retry shape as the app's `signUp`). On success: `await userCredential.user.reload()` and `await userCredential.user.getIdToken(true)`, set `newUser.emailVerified = true`. On failure: `newUser.emailVerified = false`, continue (the banner's link route covers them), and `console.warn`. Remove the comment claiming the client-side `true` is authoritative. Then the existing `/api/users/sync` call.
- [ ] **Step 2: Verify** `npx tsc --noEmit -p . && npm run build` → pass.
- [ ] **Step 3: Commit** `fix(web): sign-up code now leaves the account verified after reload`.

### Task 3: Ship server + website (owner go-ahead required)

- [ ] **Step 1:** Ask the owner for the OK to push `main` (deploys www.tedbuy.store). Do not push without it.
- [ ] **Step 2:** `git push origin main`; wait for Render deploy (poll `curl -s -o /dev/null -w '%{http_code}' -X POST https://www.tedbuy.store/api/auth/complete-registration` until it returns `401` instead of `404`).
- [ ] **Step 3: Live check with the owner:** a NEW sign-up on www.tedbuy.store with another throwaway email → code → reload → **no** amber banner, and posting an ad is not blocked. The Task 1 Step 0 account (created before the fix) still shows the banner and its "send link" button still works. Owner deletes both test accounts afterwards (website admin → user delete, then Firebase Console → tedbuy-fb79a → Authentication).
- [ ] **Step 4:** Record in memory that the server fix is live.

### Task 4: App — validation and account API helpers

**Files:**
- Create: `mobile/src/utils/registrationValidation.ts` — copy of `src/utils/registrationValidation.ts` (same four exports, same messages)
- Create: `mobile/src/utils/registrationValidation.test.ts` — port `src/utils/registrationValidation.test.ts`
- Create: `mobile/src/utils/authFlow.ts`, `mobile/src/utils/authFlow.test.ts`
- Modify: `mobile/src/firebase.ts`

**Interfaces:**
- Produces (`authFlow.ts`, pure):
  - `export function isEmailIdentifier(identifier: string): boolean` (contains `@` after trim)
  - `export function normalizeOtpInput(raw: string): string` (digits only, max 6)
  - `export const RESERVED_REGISTRATION_EMAIL = 'asumaduvincent7@gmail.com'`
  - `export const RESERVED_EMAIL_MESSAGE` = the website's exact text: `'Registration Limit: The email address "asumaduvincent7@gmail.com" has been reserved for system security. Please use a different individual email address to register.'`
- Produces (`firebase.ts`, all use `apiFetch`, all return the server's `{ success, error }`-style result without throwing on `success:false` unless stated):
  - `sendRegistrationCode(email: string, username: string): Promise<{ success: boolean; error?: string }>` → `/api/auth/send-registration-otp`
  - `verifyRegistrationCode(email: string, otp: string): Promise<{ success: boolean; error?: string }>` → `/api/auth/verify-registration-otp`
  - `completeRegistration(): Promise<boolean>` → `/api/auth/complete-registration`, 3 attempts 800 ms apart; on success `auth.currentUser.reload()` + `getIdToken(true)`
  - `resolveLoginIdentifier(identifier: string): Promise<string | null>` → `/api/auth/resolve-login-identifier`, returns email
  - `runWelcomePackage(username: string, email: string): Promise<void>` → `/api/welcome/setup` then `/api/send-welcome-email` (body `{ email, username }`), never throws
  - Change `signUp(email, password, username)` to `signUp(input: { email: string; password: string; username: string; phoneNumber: string; photoUri?: string }): Promise<{ verified: boolean }>`: create Firebase user → `completeRegistration()` → `/api/users/sync` (existing retry + honest error; include `phoneNumber`; `emailVerified` left for the server) → if `photoUri`, upload with `uploadMediaToCloudinaryMobile` and `updateUserProfile({ photoUrl })`, best-effort → if verified, `runWelcomePackage`.
  - Change `signIn(identifier: string, password: string)`: resolve non-email identifiers via `resolveLoginIdentifier` (no match → throw `'No account found with that username or phone number.'`); on Firebase `auth/invalid-credential` / `auth/wrong-password`, POST `/api/auth/verify-and-sync-password` `{ email, password }`; if it succeeds retry `signInWithEmailAndPassword` once; if the retry fails, throw the ORIGINAL Firebase error (spec anti-goal: no session without Firebase).

- [ ] **Step 1: Write failing tests**: ported validation tests; `authFlow.test.ts` with `isEmailIdentifier('a@b.com')===true`, `isEmailIdentifier('0241234567')===false`, `isEmailIdentifier(' nana_gadgets ')===false`, `normalizeOtpInput('12 34-56')==='123456'`, `normalizeOtpInput('1234567')==='123456'`.
- [ ] **Step 2: Run** `cd mobile && node --test src/utils/registrationValidation.test.ts src/utils/authFlow.test.ts` → FAIL.
- [ ] **Step 3: Implement** the two utils, then the `firebase.ts` helpers and signature changes above. Update every caller of `signUp`/`signIn` (`ProfileScreen.tsx` only, today) to compile; UI changes come in Task 5.
- [ ] **Step 4: Verify** `cd mobile && node --test src/utils/*.test.ts src/regions.test.ts && npx tsc --noEmit -p .` → pass.
- [ ] **Step 5: Commit** `feat(mobile): account API helpers and validation matching the website`.

### Task 5: App — sign-up screen copies the website

**Files:**
- Create: `mobile/src/components/AuthPanel.tsx` — the signed-out UI now inline in `ProfileScreen.tsx` (sign-in, sign-up, forgot password, Google button), moved here unchanged first, then extended
- Create: `mobile/src/content/policies.ts` — `export const TERMS_SECTIONS: { title: string; body: string }[]` copied word for word from the website's terms modal in `src/components/Navbar.tsx` (~lines 1290–1340, "Agreement to Terms & General Usage", "CRITICAL PEER SAFETY WARNING", etc.)
- Modify: `mobile/src/screens/ProfileScreen.tsx` — render `<AuthPanel />` when signed out

**Interfaces:**
- Consumes: Task 4 `signUp`, `sendRegistrationCode`, `verifyRegistrationCode`, validators, `normalizeOtpInput`, `RESERVED_*`.
- Produces: `export function AuthPanel(props: { onSignedIn?: () => void }): JSX.Element`

- [ ] **Step 1: Move** the signed-out block and its handlers/state (`isRegisterMode`, `email`, `password`, `username`, `showForgotPassword`, `resetEmail`, `handleAuth`, `handleGoogleAuth`, `handleSendPasswordReset`) into `AuthPanel.tsx`, no behaviour change. Verify `cd mobile && npx tsc --noEmit -p .` → pass. Commit `refactor(mobile): move signed-out UI into AuthPanel`.
- [ ] **Step 2: Sign-up form** with the website's fields, labels and placeholders: "Username / Store Name *" (`e.g. Ama's Boutique, David Apparels`), "Email Address *" (`name@example.com`), "Phone Number *" (`e.g. 0241234567 or +233241234567`), "Account Password *" (`Minimum 8 characters with upper, lower, number, symbol`), "Confirm Password *" (`Re-enter your password`), "Profile Picture (Optional)" (pick with the same image picker `handlePickNewAvatar` uses), and the checkbox "I have read and I agree to the Terms of Service and TedBuy Policies" whose link opens a modal showing `TERMS_SECTIONS`. On submit, run the website's checks in the website's order with its messages (terms → username → email → phone → password strength → "Passwords do not match." → reserved email → reserved store name), then `sendRegistrationCode`; on `success:false` show its `error`.
- [ ] **Step 3: Code screen**: "Verify your Email", 6-digit input through `normalizeOtpInput`, "Verify & Create Account" button → `verifyRegistrationCode` → `signUp(...)`. "Resend code" (calls `sendRegistrationCode` again, disabled 60 s after each send) and "Change email" (back to the form, fields kept). Keep pending details only in component state.
- [ ] **Step 4: Outcomes**: `signUp` → `{ verified: true }` → "Welcome to TedBuy! 🎉" alert. `{ verified: false }` → alert "Your account was created, but we couldn't confirm your email yet. Use 'Verify email' when asked to finish." (the existing `EmailVerificationModal` route). Thrown error → existing `getFriendlyAuthErrorMessage` alert.
- [ ] **Step 5: Verify** `cd mobile && node --test src/utils/*.test.ts src/regions.test.ts && npx tsc --noEmit -p .` → pass.
- [ ] **Step 6: Commit** `feat(mobile): sign-up with email code, matching the website`.

### Task 6: App — sign-in by username/phone, Google linking and old-profile join

**Files:**
- Modify: `mobile/src/components/AuthPanel.tsx`, `mobile/src/firebase.ts`

**Interfaces:**
- Consumes: Task 4 `signIn(identifier, password)`, `runWelcomePackage`.
- Produces (`firebase.ts`):
  - `signInWithGoogle(): Promise<{ status: 'signed-in'; isNewProfile: boolean } | { status: 'needs-password'; email: string }>` — on `auth/account-exists-with-different-credential` keep the pending Google credential in a module variable and return `needs-password`
  - `linkPendingGoogleWithPassword(password: string): Promise<void>` — `signInWithEmailAndPassword(email, password)` then `linkWithCredential(user, pending)`; clears the pending credential
  - `joinExistingProfileIfAny(): Promise<boolean>` — when `fetchUserById(uid)` is null, look up `GET /api/users/get?email=<firebase email>`; if a profile with a different id is found and not deleted (`isDeleted`/`status === 'deleted'`), POST `/api/users/merge-account` `{ oldUserId, photoUrl }`; returns true when merged. Called before creating a fresh profile in `signInWithGoogle`, and after email sign-in when no profile exists.

- [ ] **Step 1:** Sign-in field label "Email Address or Phone Number" (website's label), placeholder `Email, username or phone number`, `autoCapitalize="none"`; calls `signIn(identifier, password)`.
- [ ] **Step 2:** Implement the three Google functions. In `signInWithGoogle`, profile order: existing by uid → `joinExistingProfileIfAny()` → create fresh (existing code). When a fresh profile is created, call `runWelcomePackage`.
- [ ] **Step 3:** `AuthPanel`: on `needs-password`, show "An account already exists with this email address. Enter its password to link Google." with a password field and "Confirm and Link Google" (website's button text) → `linkPendingGoogleWithPassword`; "Cancel and return to sign in" clears it.
- [ ] **Step 4: Verify** `cd mobile && node --test src/utils/*.test.ts src/regions.test.ts && npx tsc --noEmit -p .` → pass.
- [ ] **Step 5: Commit** `feat(mobile): sign in with username or phone, link Google to existing accounts`.

### Task 7: Emulator check with the owner

Needs Task 3 live. Run the app on the owner's Android emulator (`cd mobile && npx expo start --android`; give the owner the exact steps if the emulator isn't set up). The owner taps through; Claude gives this list in plain words and records results:

- [ ] Sign-up with a throwaway email: every website check message appears for bad input; terms must be ticked; code arrives; wrong code shows the error; right code → Welcome alert; the TedBuy Support welcome chat appears in Chats; welcome email arrives; posting an ad is NOT blocked by "verify your email".
- [ ] Sign out, sign in with that account's **username**, then with its **phone number**, then with email.
- [ ] Google sign-in with a Gmail that already has a password account on TedBuy → password prompt → after linking, one account (same listings/followers), and next time Google works directly.
- [ ] Google sign-in with a brand-new Gmail → fresh profile + welcome chat.
- [ ] Forgot password from the app → email arrives → link opens www.tedbuy.store reset page → new password works in the app. If broken, stop and report (spec goal 7: fix only if broken).
- [ ] Owner deletes all test accounts (Firebase Console and website admin).
- [ ] Commit nothing new unless a fix was needed; update memory with results. App release itself happens in step 7 of the overall list (version 1.3.0), not here.
