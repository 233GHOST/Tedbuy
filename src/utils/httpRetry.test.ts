import test from 'node:test';
import assert from 'node:assert/strict';
import { isRetryableStatus } from './httpRetry.ts';

test('only server trouble and rate limits are worth retrying', () => {
  for (const s of [500, 502, 503, 504, 429, 0]) assert.equal(isRetryableStatus(s), true, String(s));
  for (const s of [400, 401, 403, 404, 409, 422]) assert.equal(isRetryableStatus(s), false, String(s));
});
