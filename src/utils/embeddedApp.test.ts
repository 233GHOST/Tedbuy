import test from 'node:test';
import assert from 'node:assert/strict';
import { isEmbeddedApp, parseHandoffMessage, isHandoffEventTrusted, EMBED_TRUSTED_ORIGIN } from './embeddedApp';

test('isEmbeddedApp needs both ?embed=app and the native bridge', () => {
  assert.equal(isEmbeddedApp('?embed=app', true), true);
  assert.equal(isEmbeddedApp('?foo=1&embed=app', true), true);
  assert.equal(isEmbeddedApp('?embed=app', false), false);
  assert.equal(isEmbeddedApp('', true), false);
  assert.equal(isEmbeddedApp('?embed=web', true), false);
  assert.equal(isEmbeddedApp('?embedded=app', true), false);
});

test('parseHandoffMessage accepts a well-formed JSON string', () => {
  assert.deepEqual(
    parseHandoffMessage('{"type":"tedbuy-handoff","token":"t","uid":"u"}'),
    { token: 't', uid: 'u' },
  );
});

test('parseHandoffMessage rejects everything else', () => {
  const bad: unknown[] = [
    '{"type":"tedbuy-embed-ready","token":"t","uid":"u"}', // wrong type
    '{"type":"tedbuy-handoff","uid":"u"}', // missing token
    '{"type":"tedbuy-handoff","token":"t"}', // missing uid
    '{"type":"tedbuy-handoff","token":"","uid":"u"}', // empty token
    '{"type":"tedbuy-handoff","token":"t","uid":""}', // empty uid
    '{"type":"tedbuy-handoff","token":1,"uid":"u"}', // non-string token
    '{"type":"tedbuy-handoff","token":"t","uid":{}}', // non-string uid
    'not json',
    '',
    'null',
    '"tedbuy-handoff"',
    '[]',
    { type: 'tedbuy-handoff', token: 't', uid: 'u' }, // object form
    null,
    undefined,
    42,
  ];
  for (const raw of bad) assert.equal(parseHandoffMessage(raw), null, JSON.stringify(raw));
});

test('isHandoffEventTrusted: embedded, production origin, no event source', () => {
  const ok = { embedded: true, pageOrigin: EMBED_TRUSTED_ORIGIN, source: null };
  assert.equal(EMBED_TRUSTED_ORIGIN, 'https://www.tedbuy.store');
  assert.equal(isHandoffEventTrusted(ok), true);
  assert.equal(isHandoffEventTrusted({ ...ok, source: undefined }), true);
  assert.equal(isHandoffEventTrusted({ ...ok, embedded: false }), false);
  assert.equal(isHandoffEventTrusted({ ...ok, pageOrigin: 'https://tedbuy.store' }), false);
  assert.equal(isHandoffEventTrusted({ ...ok, pageOrigin: 'http://localhost:3000' }), false);
  // A message from an iframe or another window carries a source.
  assert.equal(isHandoffEventTrusted({ ...ok, source: {} }), false);
});
