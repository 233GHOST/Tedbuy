import test from 'node:test';
import assert from 'node:assert/strict';
import { renderOrderEmail } from './orderEmail.js';

const base = { orderNumber: 'TB-1A2B3C4D', title: 'm2 Mac', quantity: 1, totalPesewas: 20000, link: 'https://www.tedbuy.store/#/orders' };

test('confirm email: subject, pay-on-delivery line, total and button', () => {
  const m = renderOrderEmail({ ...base, kind: 'confirm' });
  assert.equal(m.subject, 'Please confirm your TedBuy order TB-1A2B3C4D');
  for (const part of [m.text, m.html]) {
    assert.match(part, /Pay only when you receive your order/);
    assert.match(part, /GH₵200\.00/);
  }
  assert.match(m.html, /<a [^>]*href="https:\/\/www\.tedbuy\.store\/#\/orders"[^>]*>[\s\S]*View your order/);
});

test('new order email for the reseller', () => {
  const m = renderOrderEmail({ ...base, kind: 'new_order', area: 'Adum', link: 'https://www.tedbuy.store/#/dropship' });
  assert.equal(m.subject, 'New order TB-1A2B3C4D: m2 Mac');
  for (const part of [m.text, m.html]) {
    assert.match(part, /Call the buyer, then accept the order/);
    assert.match(part, /Adum/);
  }
  assert.match(m.html, /Open your orders/);
});

test('on its way email carries the delivery code and its warnings', () => {
  const m = renderOrderEmail({ ...base, kind: 'on_its_way', code: '135790' });
  assert.equal(m.subject, 'Your TedBuy order TB-1A2B3C4D is on its way');
  for (const part of [m.text, m.html]) {
    assert.match(part, /135790/);
    assert.match(part, /It is not a payment/);
    assert.match(part, /Give this code to the seller only when the item is in your hands/);
  }
});

test('values are HTML-escaped', () => {
  const m = renderOrderEmail({ ...base, kind: 'confirm', title: 'Mac <b>&"x"' });
  assert.match(m.html, /Mac &lt;b&gt;&amp;&quot;x&quot;/);
  assert.doesNotMatch(m.html, /<b>/);
});

test('branded, readable without images', () => {
  const m = renderOrderEmail({ ...base, kind: 'confirm' });
  assert.match(m.html, /Ted[\s\S]{0,80}Buy/);
  assert.match(m.html, /support@tedbuy\.store/);
  assert.doesNotMatch(m.html, /<img/);
});
