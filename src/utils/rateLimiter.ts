const CLIENT_LIMITS: Record<string, { durationMs: number; maxCount: number }> = {
  login: { durationMs: 1 * 60 * 1000, maxCount: 5 }, // 5 tries per minute
  register: { durationMs: 5 * 60 * 1000, maxCount: 3 }, // 3 tries per 5 mins
  password_reset: { durationMs: 10 * 60 * 1000, maxCount: 2 }, // 2 per 10 mins
  create_chat: { durationMs: 5 * 60 * 1000, maxCount: 5 }, // 5 chats per 5 mins
  send_message: { durationMs: 60 * 1000, maxCount: 30 }, // 30 messages per min
  add_product: { durationMs: 10 * 60 * 1000, maxCount: 5 }, // 5 ads per 10 mins
  submit_review: { durationMs: 5 * 60 * 1000, maxCount: 3 }, // 3 reviews per 5 mins
  contact_form: { durationMs: 15 * 60 * 1000, maxCount: 3 }, // 3 contact forms per 15 mins
  search_query: { durationMs: 10 * 1000, maxCount: 5 } // 5 searches per 10 secs
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
      } catch (_) {}
    }
    
    // Clean expired timestamps
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
    return { allowed: true };
  }
}
