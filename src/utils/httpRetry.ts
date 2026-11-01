// Whether a failed request is worth repeating: server errors, rate limits and network
// failures (status 0) may pass next time; 4xx answers (bad code, not signed in) will not.
export function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}
