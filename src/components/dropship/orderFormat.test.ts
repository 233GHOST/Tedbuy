import test from 'node:test';
import assert from 'node:assert/strict';
import { marginFigures, needsAction, orderStatusLabel, orderTotal, paymentStatusText, timeLeft, timelineLabel } from './orderFormat';

test('buyers never see supplier steps; staff see the next step', () => {
  for (const s of ['reservation_requested', 'reserved', 'supplier_payment_declared', 'supplier_paid', 'released'] as const) {
    assert.equal(orderStatusLabel(s, 'buyer'), 'Seller is getting your item');
  }
  assert.equal(orderStatusLabel('delivered', 'dropshipper'), 'Delivered: payment pending');
  assert.equal(orderStatusLabel('supplier_payment_declared', 'supplier'), 'Reseller says paid: confirm');
});

test('needsAction per audience', () => {
  assert.equal(needsAction('placed', 'buyer'), true);
  assert.equal(needsAction('placed', 'dropshipper'), false);
  assert.equal(needsAction('delivered', 'dropshipper'), true);
  assert.equal(needsAction('supplier_paid', 'supplier'), true);
  assert.equal(needsAction('delivered', 'supplier'), false);
});

test('money helpers: gross vs estimated net, totals in pesewas', () => {
  assert.deepEqual(marginFigures({ retailTotalPesewas: 17000, wholesaleTotalPesewas: 10000, deliveryCostPesewas: 1500, otherCostPesewas: 500 }), { gross: 7000, net: 5000 });
  assert.equal(orderTotal(15000, 2, 2000), 32000);
});

test('payment wording never claims TedBuy checked a buyer payment', () => {
  assert.match(paymentStatusText('buyer_to_reseller', 'recorded'), /not checked by TedBuy/);
  assert.equal(paymentStatusText('reseller_to_supplier', 'confirmed'), 'Confirmed by supplier');
});

test('timeLeft and timeline labels', () => {
  const now = Date.parse('2026-10-30T10:00:00Z');
  assert.equal(timeLeft('2026-10-30T10:30:00Z', now), '30 min left');
  assert.equal(timeLeft('2026-10-30T15:00:00Z', now), '5 h left');
  assert.equal(timeLeft('2026-10-30T09:00:00Z', now), 'time is up');
  assert.equal(timeLeft(null, now), null);
  assert.equal(timelineLabel('expired'), 'Cancelled: a step ran out of time');
});
