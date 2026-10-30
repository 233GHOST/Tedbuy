import test from 'node:test';
import assert from 'node:assert/strict';
import { plainErrorMessage, CONNECTION_ERROR_MESSAGE, SESSION_EXPIRED_MESSAGE } from './plainErrorMessage.ts';

const FALLBACK = 'Could not save. Please try again.';

test('passes a readable server message through', () => {
  assert.equal(plainErrorMessage(new Error('Only the buyer can confirm pickup.'), FALLBACK), 'Only the buyer can confirm pickup.');
});

test('reads the error out of the JSON that handleBackendError rethrows', () => {
  const err = new Error(JSON.stringify({ error: 'Message cannot exceed 5000 characters.', operationType: 'update', path: 'chats/1' }));
  assert.equal(plainErrorMessage(err, FALLBACK), 'Message cannot exceed 5000 characters.');
});

test('drops a Forbidden: prefix', () => {
  assert.equal(plainErrorMessage('Forbidden: You do not own this listing', FALLBACK), 'You do not own this listing');
});

test('turns connection failures into a plain internet message', () => {
  assert.equal(plainErrorMessage(new TypeError('Failed to fetch'), FALLBACK), CONNECTION_ERROR_MESSAGE);
  assert.equal(plainErrorMessage(JSON.stringify({ error: 'NetworkError when attempting to fetch resource.' }), FALLBACK), CONNECTION_ERROR_MESSAGE);
});

test('lets a readable "invalid or expired" message through', () => {
  assert.equal(plainErrorMessage(new Error('Invalid or expired password reset code.'), FALLBACK), 'Invalid or expired password reset code.');
});

test('turns an expired or invalid sign-in token into a log-in-again message', () => {
  assert.equal(plainErrorMessage(new Error('Unauthorized: Invalid or expired authorization token.'), FALLBACK), SESSION_EXPIRED_MESSAGE);
  assert.equal(plainErrorMessage(JSON.stringify({ error: 'Firebase ID token has expired.' }), FALLBACK), SESSION_EXPIRED_MESSAGE);
});

test('falls back for technical or empty text', () => {
  assert.equal(plainErrorMessage(new Error('Invalid sellerId'), FALLBACK), FALLBACK);
  assert.equal(plainErrorMessage(new Error('Missing or invalid pushToken'), FALLBACK), FALLBACK);
  assert.equal(plainErrorMessage(new Error('Request failed with status code 500'), FALLBACK), FALLBACK);
  assert.equal(plainErrorMessage(new Error('Firebase: Error (auth/internal-error).'), FALLBACK), FALLBACK);
  assert.equal(plainErrorMessage(new Error("Cannot read properties of undefined (reading 'id')"), FALLBACK), FALLBACK);
  assert.equal(plainErrorMessage(new Error('Missing productId'), FALLBACK), FALLBACK);
  assert.equal(plainErrorMessage(new Error(''), FALLBACK), FALLBACK);
  assert.equal(plainErrorMessage(undefined, FALLBACK), FALLBACK);
  assert.equal(plainErrorMessage(JSON.stringify({ path: 'x' }), FALLBACK), FALLBACK);
});
