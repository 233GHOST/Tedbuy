// Turns the error from a failed action into one short sentence a buyer or seller can act on.
// Readable server messages ("You can only delete your own listings.") pass through;
// connection failures get a plain "check your internet" line; anything technical
// (JSON, status codes, service names, stack text) falls back to the caller's message.

const NETWORK_PATTERN = /failed to fetch|networkerror|network request failed|network-request-failed|load failed|net::err|timed? ?out|offline/i;
const TECHNICAL_PATTERN = /[{}<>[\]]|\b(?:typeerror|syntaxerror|referenceerror|json|unexpected token|undefined|null|nan|status code|https?|firebase|supabase|cloudinary|brevo|paystack|api|sdk|payload|econn\w*|stack|sql|rls|uid)\b|\b[45]\d\d\b|^(?:missing|invalid|expected)\b/i;

export const CONNECTION_ERROR_MESSAGE = "Can't reach TedBuy. Check your internet connection and try again.";

export function plainErrorMessage(err: unknown, fallback: string): string {
  let raw = '';
  if (typeof err === 'string') {
    raw = err;
  } else if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    raw = (err as { message: string }).message;
  }

  // handleBackendError rethrows its details as JSON; the readable part is in `.error`
  if (raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      raw = typeof parsed?.error === 'string' ? parsed.error : '';
    } catch {
      // not JSON after all; judged as plain text below
    }
  }

  const text = raw.trim().replace(/^(?:forbidden|unauthorized|error)\s*:\s*/i, '');
  if (!text) return fallback;
  if (NETWORK_PATTERN.test(text)) return CONNECTION_ERROR_MESSAGE;
  if (TECHNICAL_PATTERN.test(text) || text.length > 160) return fallback;
  return text;
}
