// Embedded mode for the TedBuy Android app's in-app Dropship WebView
// (mobile/src/screens/DropshipWebScreen.tsx) and the sign-in handoff bridge.
// Message contract (JSON strings, see mobile/src/utils/webHandoff.ts):
//   app → page: { type: 'tedbuy-handoff', token, uid }
//   page → app: { type: 'tedbuy-embed-ready', uid | null },
//               { type: 'tedbuy-embed-signed-in', uid }
// The pure helpers here run under `tsx --test`; only postToApp touches window.

declare global {
  interface Window {
    /** Injected by react-native-webview inside the app. */
    ReactNativeWebView?: { postMessage: (data: string) => void };
  }
}

/** The only page origin that may accept a handoff token. */
export const EMBED_TRUSTED_ORIGIN = 'https://www.tedbuy.store';

export const HANDOFF_MESSAGE_TYPE = 'tedbuy-handoff';
export const READY_MESSAGE_TYPE = 'tedbuy-embed-ready';
export const SIGNED_IN_MESSAGE_TYPE = 'tedbuy-embed-signed-in';

/** Embedded mode needs BOTH `?embed=app` and the native bridge: the query
 * alone (a shared link) never hides the site's chrome in a normal browser. */
export function isEmbeddedApp(search: string, hasBridge: boolean): boolean {
  if (!hasBridge || typeof search !== 'string') return false;
  return new URLSearchParams(search).get('embed') === 'app';
}

/** Parses an app → page handoff. Only a JSON string is accepted (the RN
 * WebView always delivers strings); anything malformed → null. */
export function parseHandoffMessage(raw: unknown): { token: string; uid: string } | null {
  if (typeof raw !== 'string') return null;
  let msg: any;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object' || msg.type !== HANDOFF_MESSAGE_TYPE) return null;
  const { token, uid } = msg;
  if (typeof token !== 'string' || !token || typeof uid !== 'string' || !uid) return null;
  return { token, uid };
}

/** A handoff is acted on only in embedded mode, on the production origin,
 * and from react-native-webview itself: its synthetic MessageEvents carry no
 * `source`, while messages from iframes or other windows always do. */
export function isHandoffEventTrusted(input: { embedded: boolean; pageOrigin: string; source: unknown }): boolean {
  return input.embedded && input.pageOrigin === EMBED_TRUSTED_ORIGIN && input.source == null;
}

/** Posts a page → app message through the native bridge, if present. */
export function postToApp(message: { type: string; uid: string | null }): void {
  try {
    window.ReactNativeWebView?.postMessage(JSON.stringify(message));
  } catch {
    // The bridge can vanish while the screen closes; nothing to do.
  }
}
