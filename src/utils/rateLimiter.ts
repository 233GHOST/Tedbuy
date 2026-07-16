/**
 * Client-side rate limiter for TedBuy.
 *
 * ⚠️  SECURITY NOTE: This is a UX-layer convenience ONLY.  It MUST be
 *     complemented by server-side rate-limiting (the server already uses
 *     `serverRateLimiter()` on sensitive endpoints).  A determined attacker
 *     can bypass client-side checks by clearing localStorage or crafting
 *     direct HTTP requests.
 */

const CLIENT_LIMITS: Record<string, { durationMs: number; maxCount: number }> = {
  login: { durationMs: 1 * 60 * 1000, maxCount: 5 },
  register: { durationMs: 5 * 60 * 1000, maxCount: 3 },
  password_reset: { durationMs: 10 * 60 * 1000, maxCount: 2 },
  create_chat: { durationMs: 5 * 60 * 1000, maxCount: 5 },
  send_message: { durationMs: 60 * 1000, maxCount: 30 },
  add_product: { durationMs: 10 * 60 * 1000, maxCount: 5 },
  submit_review: { durationMs: 5 * 60 * 1000, maxCount: 3 },
  contact_form: { durationMs: 15 * 60 * 1000, maxCount: 3 },
  search_query: { durationMs: 10 * 1000, maxCount: 5 }
};

export function checkClientRateLimit(action: string, identifier = 'default'): { allowed: boolean; remainingSecs?: number } {
  try {
    const config = CLIENT_LIMITS[action];
    if (!config) return { allowed: true };

    const key = `tedbuy_rate_limit_${action}_${identifier}`;
    const now = Date.now();

    let state: { timestamps: number[] } = { timestamps: [] };
    const storedStr = localStorage.getItem(key);
    if (storedStr) {
      try {
        state = JSON.parse(storedStr);
      } catch (_) {
        // Corrupted state – treat as fresh
        state = { timestamps: [] };
      }
    }

    state.timestamps = (state.timestamps || []).filter(ts => now - ts < config.durationMs);

    if (state.timestamps.length >= config.maxCount) {
      const oldestActive = state.timestamps[0];
      const remainingSecs = Math.ceil((config.durationMs - (now - oldestActive)) / 1000);
      return { allowed: false, remainingSecs };
    }

    state.timestamps.push(now);
    localStorage.setItem(key, JSON.stringify(state));
    return { allowed: true };
  } catch (err) {
    // On any error (e.g. storage quota), DENY the action for safety
    console.warn('[RateLimiter] Error checking rate limit, denying by default:', err);
    return { allowed: false, remainingSecs: 60 };
  }
}
