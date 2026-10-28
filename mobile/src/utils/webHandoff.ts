// Pure helpers for the embedded Dropship WebView (DropshipWebScreen.tsx) and
// its sign-in handoff bridge with the website. Kept free of React Native
// imports so they run under `node --test`.

export const TEDBUY_WEB_ORIGIN = 'https://www.tedbuy.store';
export const DROPSHIP_EMBED_URL = `${TEDBUY_WEB_ORIGIN}/dropship?embed=app`;

/** app → page */
export const HANDOFF_MESSAGE_TYPE = 'tedbuy-handoff';
/** page → app, on load and after every auth change */
export const READY_MESSAGE_TYPE = 'tedbuy-embed-ready';
/** page → app, after a successful handoff sign-in */
export const SIGNED_IN_MESSAGE_TYPE = 'tedbuy-embed-signed-in';

/** True only for https://www.tedbuy.store itself and paths under it. A plain
 * prefix check on the lowercased URL followed by a strict boundary character —
 * deliberately not `new URL()`, whose React Native polyfill is incomplete. The
 * boundary rejects ports (`:`), lookalike hosts (`.evil.com`), userinfo tricks
 * (`@evil.com`) and backslash host confusion. */
export function isTedbuyOrigin(url: string): boolean {
  if (typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  if (!lower.startsWith(TEDBUY_WEB_ORIGIN)) return false;
  const next = lower.charAt(TEDBUY_WEB_ORIGIN.length);
  return next === '' || next === '/' || next === '?' || next === '#';
}

/** 503 (server can't mint tokens) and network failures fall back to the
 * Chrome Custom Tab; anything else (401/403/429…) is a real refusal. */
export function shouldFallbackToBrowser(status: number | 'network'): boolean {
  return status === 503 || status === 'network';
}

export type EmbedMessage =
  | { type: typeof READY_MESSAGE_TYPE; uid: string | null }
  | { type: typeof SIGNED_IN_MESSAGE_TYPE; uid: string };

/** Parses a page → app message. Returns null for anything that isn't a
 * well-formed ready / signed-in message. */
export function parseEmbedMessage(data: string): EmbedMessage | null {
  if (typeof data !== 'string') return null;
  let msg: any;
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;
  const uid = msg.uid;
  if (msg.type === READY_MESSAGE_TYPE) {
    if (uid === undefined || uid === null) return { type: READY_MESSAGE_TYPE, uid: null };
    return typeof uid === 'string' ? { type: READY_MESSAGE_TYPE, uid } : null;
  }
  if (msg.type === SIGNED_IN_MESSAGE_TYPE) {
    return typeof uid === 'string' && uid ? { type: SIGNED_IN_MESSAGE_TYPE, uid } : null;
  }
  return null;
}

export type ReadyDecision = 'none' | 'handoff' | 'wait' | 'error';

/** What to do when the page reports its signed-in uid.
 * - Same uid as the app (or no app user / not a TedBuy page) → nothing.
 * - First mismatch for this page load → post the handoff.
 * - `null` while our handoff is still pending → wait: on an account switch
 *   the site signs the old account out before signing the new one in.
 * - Any other mismatch after posting → error (never re-post: no loops). */
export function decideOnReady(input: {
  pageUid: string | null;
  appUid: string | null;
  currentUrl: string;
  alreadyPosted: boolean;
  handoffPending: boolean;
}): ReadyDecision {
  const { pageUid, appUid, currentUrl, alreadyPosted, handoffPending } = input;
  if (!appUid || !isTedbuyOrigin(currentUrl)) return 'none';
  if (pageUid === appUid) return 'none';
  if (!alreadyPosted) return 'handoff';
  if (pageUid === null && handoffPending) return 'wait';
  return 'error';
}
