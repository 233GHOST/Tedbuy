import test from 'node:test';
import assert from 'node:assert/strict';
import { toUserFriendlyError } from './authErrorHelper.ts';

test('returns a specific listing-rate-limit message for too many listing posts', () => {
  const message = toUserFriendlyError(
    'Rate limit exceeded: You can only publish 5 listings within 10 minutes. Please try again in 120 seconds.'
  );

  assert.equal(
    message,
    "You've reached the listing posting limit. Please wait 120 seconds and try again."
  );
});
