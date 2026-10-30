# App accounts match the website (step 2) — design

Date: 2026-10-30. Status: draft for owner review.

## Why

The owner wants Android app users to be able to do everything website users
can (admin excepted) before the next app release (1.3.0). Accounts come first:
how someone signs up and signs in decides whether their account is created
correctly, and that is hard to repair afterwards. Today the app and the
website create and sign in to accounts differently, and the website's own
sign-up has a bug that the app would copy.

## What exists today

**Website** (`src/components/Navbar.tsx` form, `src/context/AppContext.tsx`
`initiateRegistration` / `verifyAndCompleteRegistration` / `registerUser` /
`loginUser` / `loginWithGoogle` / `linkGoogleWithPassword` /
`findAndMigrateExistingUser` / `setupWelcomePackage`):

- Sign-up form: username/store name, email, phone number (required), password
  and confirm password (strength rules in `src/utils/registrationValidation.ts`),
  optional profile picture, and a required "I agree to the Terms of Service and
  TedBuy Policies" checkbox with the policies text.
- `POST /api/auth/send-registration-otp` emails a 6-digit code (Brevo, 10 minute
  expiry, kept in the server's in-memory `registrationOtpStore`). It refuses an
  email that already has an account.
- `POST /api/auth/verify-registration-otp` checks the code and deletes it.
- Then the browser creates the Firebase account itself
  (`createUserWithEmailAndPassword`) and saves the profile through
  `POST /api/users/sync`, then runs the welcome package
  (`POST /api/welcome/setup` = support chat + welcome message, then
  `POST /api/send-welcome-email`).
- Sign-in accepts email, username or phone number. Anything without `@` is
  turned into an email by `POST /api/auth/resolve-login-identifier`. If Firebase
  rejects the password, `POST /api/auth/verify-and-sync-password` checks the
  legacy `password_hash` in Supabase and, on a match, sets that password in
  Firebase, after which sign-in is retried.
- Google: if Firebase reports `auth/account-exists-with-different-credential`,
  the site asks for the account's password, signs in with it and links the
  Google credential (`linkWithCredential`). After any sign-in,
  `findAndMigrateExistingUser` looks for an older profile with the same email
  under a different id and joins it through `POST /api/users/merge-account`
  (the server checks the emails match).
- Password reset: `POST /api/auth/send-password-reset` emails a link to
  www.tedbuy.store, where the reset page sets the new password.

**The website bug.** `/api/users/sync` deliberately takes `emailVerified` from
Firebase Auth, not from the request (a correct security fix). Nothing tells
Firebase that the 6-digit code was checked, so a website sign-up is saved as
**not verified**. From the next load the user probably sees the amber "email not
yet verified" banner and cannot post ads until they also click a Firebase
verification link. Confirmed by reading the code only; reproduce on staging
before fixing.

**App** (`mobile/src/screens/ProfileScreen.tsx`, `mobile/src/firebase.ts`):

- Sign-up asks only store/display name, email, password. No code, no phone,
  no confirm password, no photo, no terms checkbox. The account is created
  straight away, unverified, and `EmailVerificationModal` later asks the user to
  click a Firebase verification link before posting or chatting.
- Sign-in accepts email only. No legacy-password fallback.
- Google sign-in (`signInWithGoogle`) creates a fresh profile if none exists for
  this Firebase id. It does not handle `account-exists-with-different-credential`
  (the user just sees an error) and does not join an older same-email profile,
  so one person can end up with two accounts.
- Never runs the welcome package.
- Password reset already uses the same server endpoint as the website.

## Goals

1. **Server: a correct code marks the email as verified in Firebase.** After a
   successful code check, the account that is then created for that email gets
   `emailVerified: true` in Firebase Auth (Admin SDK `updateUser`), so
   `/api/users/sync` saves it as verified. Both website and app use this.
2. **Website sign-up uses the fix.** Same form and steps as now; the verified
   state comes from the server, not from the browser's own `emailVerified: true`.
3. **App sign-up copies the website exactly:** the same fields, the same rules
   and messages, the terms checkbox with the policies text, then the code screen
   (6 digits, resend, change email), then account creation, server
   verification, profile save, welcome package.
4. **App sign-in copies the website:** email, username or phone number, plus the
   legacy-password fallback.
5. **App Google sign-in copies the website:** the link-with-password prompt, and
   joining an older same-email profile through `merge-account`.
6. **App runs the welcome package** once for a new verified account (code sign-up
   or first Google sign-in), like the website.
   The app's existing `EmailVerificationModal` link route stays for accounts that
   are still unverified (older app sign-ups, failed verify step).
7. **Password reset check:** confirm on the emulator that requesting a reset from
   the app sends the email and the link opens the website reset page and works.
   Build nothing unless it is broken.

## Non-goals

- Admin tools in the app (owner decision: website only).
- Changing how the website's sign-up looks.
- Phone/SMS codes; iOS.
- Back-filling website users already saved as unverified. Owner's call left to
  Claude: not done; they can still use the banner's verification link. Revisit
  if the owner wants it.
- The rest of the 7-step list (server-side featured/trending/similar is step 3).

## Anti-goals (a failure even if it "works")

- Any way to get an email marked verified without receiving that email's code:
  a code checked for one email must never verify a different account, a code
  works once, and it expires.
- Two TedBuy accounts for one person because of how they signed in.
- Breaking sign-in or sign-up for existing website users or for the app version
  people have now (1.1.0 is what /download serves; old apps keep calling
  `/api/users/sync` without the new step and must keep working as they do today).
- The app saying "Welcome" when the profile was not actually saved (the app's
  existing honest-failure behaviour in `signUp` stays).
- An app session that exists without a real Firebase sign-in. The website's
  fallback that builds a "logged in" user from the legacy-password response
  even when the Firebase retry fails is **not** copied: in the app, the fallback
  only counts when the Firebase retry succeeds (Claude's call).

## Constraints

- Server is the single `server.ts` on Render. Pushing to `main` deploys the
  website and server at once, so the server fix and the website change ship in
  the same push. The app changes ship later, in 1.3.0.
- Codes live in server memory: a Render restart loses them and the user just
  asks for a new code. Acceptable, unchanged.
- Expo SDK 57 (read `mobile/AGENTS.md` and the v57 docs before app code). The
  app keeps its own copies of shared logic in `mobile/src/utils` with tests, as
  it already does (e.g. `regions.ts`); copy `registrationValidation.ts` the same way.
- The reserved owner email and "tedbuy" store-name rules apply in the app too
  (the app already has the store-name rule).
- Testing happens on live with throwaway accounts, not locally: the local
  `.env` has no Firebase Admin service account or `BREVO_API_KEY`, so locally
  every account looks unverified and no code can be sent. The app always calls
  www.tedbuy.store, so the server fix ships before the app's emulator checks.
  Firebase project tedbuy-fb79a is shared by staging and live; test accounts
  use throwaway emails and are deleted after.
- The owner only uses an iPhone and the website; every app check is done by the
  owner on the emulator, so each app task ends with a short, plain list of
  things to tap through.

## Decided

- Fix verification on the server for both (owner).
- App sign-up copies the website exactly, code before the account exists (owner).
- Admin stays website-only (owner).
- Legacy-password fallback only with a real Firebase session (Claude).
- No back-fill of existing unverified users (Claude).

## Left to the builder

- How the server ties a checked code to the account created next (for example
  keeping a short-lived "email checked" record after a successful
  `verify-registration-otp` and a new authenticated
  `POST /api/auth/complete-registration` that checks the signed-in user's
  Firebase email matches, sets `emailVerified`, and uses up the record), within
  the anti-goals above.
- What the app does if the account is created but the verify step fails:
  retry, and failing that the existing `EmailVerificationModal` link route,
  with an honest message.
- App screen layout for the extra fields and code screen, following the app's
  current look.
- Which of the website's `findAndMigrateExistingUser` lookups to keep. The
  server-backed ones (lookup by email, then `merge-account`) are needed; the
  browser-cache and `storeNames` guesses have no app equivalent.
- Tests: server tests for the new verify step (wrong email, reused code,
  expired, old-app path unchanged), app unit tests for the copied validation.
