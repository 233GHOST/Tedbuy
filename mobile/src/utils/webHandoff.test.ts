import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isTedbuyOrigin,
  shouldFallbackToBrowser,
  HANDOFF_MESSAGE_TYPE,
  READY_MESSAGE_TYPE,
  SIGNED_IN_MESSAGE_TYPE,
  parseEmbedMessage,
  decideOnReady,
  foreignNavigationAction,
  foreignRecoveryAction,
  MAX_FOREIGN_RECOVERIES,
  FOREIGN_DEDUPE_MS,
} from './webHandoff.ts';

test('isTedbuyOrigin accepts only https://www.tedbuy.store pages', () => {
  assert.equal(isTedbuyOrigin('https://www.tedbuy.store/dropship?embed=app'), true);
  assert.equal(isTedbuyOrigin('https://www.tedbuy.store'), true);
  assert.equal(isTedbuyOrigin('https://www.tedbuy.store/'), true);
  assert.equal(isTedbuyOrigin('https://WWW.TEDBUY.STORE/dropship'), true);
});

test('isTedbuyOrigin rejects lookalikes, other schemes and other hosts', () => {
  assert.equal(isTedbuyOrigin('https://tedbuy.store/x'), false);
  assert.equal(isTedbuyOrigin('https://www.tedbuy.store.evil.com/'), false);
  assert.equal(isTedbuyOrigin('http://www.tedbuy.store/'), false);
  assert.equal(isTedbuyOrigin('https://evil.com/?u=https://www.tedbuy.store'), false);
  assert.equal(isTedbuyOrigin('https://www.tedbuy.store:8443/'), false);
  assert.equal(isTedbuyOrigin('https://user@www.tedbuy.store/'), false);
  assert.equal(isTedbuyOrigin('https://www.tedbuy.store@evil.com/'), false);
  assert.equal(isTedbuyOrigin('https://evil.com/www.tedbuy.store'), false);
  assert.equal(isTedbuyOrigin('https://wa.me/233000000'), false);
  assert.equal(isTedbuyOrigin('whatsapp://send?text=hi'), false);
  assert.equal(isTedbuyOrigin('about:blank'), false);
  assert.equal(isTedbuyOrigin(''), false);
  assert.equal(isTedbuyOrigin(undefined as any), false);
  assert.equal(isTedbuyOrigin(null as any), false);
});

test('shouldFallbackToBrowser is true only for 503 and network failures', () => {
  assert.equal(shouldFallbackToBrowser(503), true);
  assert.equal(shouldFallbackToBrowser('network'), true);
  assert.equal(shouldFallbackToBrowser(401), false);
  assert.equal(shouldFallbackToBrowser(403), false);
});

test('message type constants match the web contract', () => {
  assert.equal(HANDOFF_MESSAGE_TYPE, 'tedbuy-handoff');
  assert.equal(READY_MESSAGE_TYPE, 'tedbuy-embed-ready');
  assert.equal(SIGNED_IN_MESSAGE_TYPE, 'tedbuy-embed-signed-in');
});

test('parseEmbedMessage accepts only well-formed ready / signed-in messages', () => {
  assert.deepEqual(parseEmbedMessage('{"type":"tedbuy-embed-ready","uid":null}'), { type: 'tedbuy-embed-ready', uid: null });
  assert.deepEqual(parseEmbedMessage('{"type":"tedbuy-embed-ready","uid":"u1"}'), { type: 'tedbuy-embed-ready', uid: 'u1' });
  assert.deepEqual(parseEmbedMessage('{"type":"tedbuy-embed-signed-in","uid":"u1"}'), { type: 'tedbuy-embed-signed-in', uid: 'u1' });
  assert.deepEqual(parseEmbedMessage('{"type":"tedbuy-embed-ready"}'), { type: 'tedbuy-embed-ready', uid: null });
  assert.equal(parseEmbedMessage('not json'), null);
  assert.equal(parseEmbedMessage('"string"'), null);
  assert.equal(parseEmbedMessage('null'), null);
  assert.equal(parseEmbedMessage('{"type":"tedbuy-handoff","token":"x","uid":"u"}'), null);
  assert.equal(parseEmbedMessage('{"type":"tedbuy-embed-ready","uid":42}'), null);
  assert.equal(parseEmbedMessage('{"type":"tedbuy-embed-signed-in","uid":null}'), null);
  assert.equal(parseEmbedMessage(undefined as any), null);
});

const PAGE = 'https://www.tedbuy.store/dropship?embed=app';
const base = { appUid: 'u1', currentUrl: PAGE, alreadyPosted: false, handoffPending: false };

test('decideOnReady: nothing to do when the page is already signed in as the app user', () => {
  assert.equal(decideOnReady({ ...base, pageUid: 'u1' }), 'none');
  assert.equal(decideOnReady({ ...base, pageUid: 'u1', alreadyPosted: true }), 'none');
});

test('decideOnReady: hands off once when the page uid differs (signed out or another account)', () => {
  assert.equal(decideOnReady({ ...base, pageUid: null }), 'handoff');
  assert.equal(decideOnReady({ ...base, pageUid: 'old' }), 'handoff');
});

test('decideOnReady: the transitional signed-out ready during a pending handoff is waited out', () => {
  // Web signs the previous account out before signing in the new one.
  assert.equal(decideOnReady({ ...base, pageUid: null, alreadyPosted: true, handoffPending: true }), 'wait');
});

test('decideOnReady: a mismatch after posting is an error, never another post', () => {
  assert.equal(decideOnReady({ ...base, pageUid: null, alreadyPosted: true }), 'error');
  assert.equal(decideOnReady({ ...base, pageUid: 'old', alreadyPosted: true }), 'error');
  assert.equal(decideOnReady({ ...base, pageUid: 'old', alreadyPosted: true, handoffPending: true }), 'error');
});

test('decideOnReady: never hands off to a non-TedBuy page or without an app user', () => {
  assert.equal(decideOnReady({ ...base, pageUid: null, currentUrl: 'https://evil.com/' }), 'none');
  assert.equal(decideOnReady({ ...base, pageUid: null, currentUrl: 'http://www.tedbuy.store/' }), 'none');
  assert.equal(decideOnReady({ ...base, pageUid: null, appUid: null }), 'none');
});

test('foreignNavigationAction: TedBuy pages and about:blank stay in the WebView', () => {
  assert.equal(foreignNavigationAction('https://www.tedbuy.store/dropship?embed=app', false), 'allow');
  assert.equal(foreignNavigationAction('https://www.tedbuy.store/dropship', true), 'allow');
  assert.equal(foreignNavigationAction('about:blank', false), 'allow');
  assert.equal(foreignNavigationAction('about:blank', true), 'allow');
});

test('foreignNavigationAction: a foreign page that slipped through is backed out of', () => {
  assert.equal(foreignNavigationAction('https://checkout.paystack.com/abc', true), 'go_back');
  assert.equal(foreignNavigationAction('https://www.tedbuy.store.evil.com/', true), 'go_back');
  assert.equal(foreignNavigationAction('https://checkout.paystack.com/abc', false), 'reload');
  assert.equal(foreignNavigationAction('http://www.tedbuy.store/', false), 'reload');
});

test('foreignNavigationAction: an empty url is ignored', () => {
  assert.equal(foreignNavigationAction('', false), 'allow');
  assert.equal(foreignNavigationAction(undefined as any, true), 'allow');
});

const FOREIGN = 'https://checkout.paystack.com/abc';
const fr = { url: FOREIGN, canGoBack: false, recoveries: 0, lastHandled: null, now: 100000 };

test('foreignRecoveryAction: TedBuy pages are allowed regardless of counters', () => {
  assert.equal(foreignRecoveryAction({ ...fr, url: PAGE }), 'allow');
  assert.equal(foreignRecoveryAction({ ...fr, url: 'about:blank', recoveries: 5 }), 'allow');
});

test('foreignRecoveryAction: first recoveries go back or reload', () => {
  assert.equal(MAX_FOREIGN_RECOVERIES, 2);
  assert.equal(foreignRecoveryAction({ ...fr }), 'reload');
  assert.equal(foreignRecoveryAction({ ...fr, canGoBack: true }), 'go_back');
  assert.equal(foreignRecoveryAction({ ...fr, recoveries: 1 }), 'reload');
});

test('foreignRecoveryAction: the third recovery in one visit is an error (redirect loop)', () => {
  assert.equal(foreignRecoveryAction({ ...fr, recoveries: 2 }), 'error');
  assert.equal(foreignRecoveryAction({ ...fr, recoveries: 2, canGoBack: true }), 'error');
  assert.equal(foreignRecoveryAction({ ...fr, recoveries: 3, lastHandled: { url: 'https://other.example/', at: fr.now - 10 } }), 'error');
});

test('foreignRecoveryAction: a repeat of the same URL within the window only stops loading', () => {
  const lastHandled = { url: FOREIGN, at: fr.now - (FOREIGN_DEDUPE_MS - 1) };
  assert.equal(foreignRecoveryAction({ ...fr, recoveries: 1, lastHandled }), 'stop_only');
  assert.equal(foreignRecoveryAction({ ...fr, recoveries: 2, lastHandled }), 'stop_only');
  assert.equal(foreignRecoveryAction({ ...fr, recoveries: 1, canGoBack: true, lastHandled }), 'stop_only');
});

test('foreignRecoveryAction: same URL after the window, or a different URL, counts as a new recovery', () => {
  const old = { url: FOREIGN, at: fr.now - FOREIGN_DEDUPE_MS };
  assert.equal(foreignRecoveryAction({ ...fr, recoveries: 1, lastHandled: old }), 'reload');
  assert.equal(foreignRecoveryAction({ ...fr, recoveries: 2, lastHandled: old }), 'error');
  const other = { url: 'https://other.example/', at: fr.now - 10 };
  assert.equal(foreignRecoveryAction({ ...fr, recoveries: 1, canGoBack: true, lastHandled: other }), 'go_back');
});
