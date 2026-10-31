import test from 'node:test';
import assert from 'node:assert/strict';
import { invalidatesProducts } from './routes.js';

// Product caches are cleared only when a call can change what shoppers see.
test('order steps clear product caches only when stock changes', () => {
  const r = { changed: true };
  assert.equal(invalidatesProducts('dropship_supplier_order_action', { p_action: 'confirm_reservation' }, r), true);
  assert.equal(invalidatesProducts('dropship_supplier_order_action', { p_action: 'confirm_payment' }, r), false);
  assert.equal(invalidatesProducts('dropship_supplier_order_action', { p_action: 'released' }, r), false);
  assert.equal(invalidatesProducts('dropship_reseller_order_action', { p_action: 'cancel' }, r), true);
  assert.equal(invalidatesProducts('dropship_reseller_order_action', { p_action: 'verify_code' }, r), false);
  assert.equal(invalidatesProducts('dropship_reseller_order_action', { p_action: 'set_costs' }, r), false);
  assert.equal(invalidatesProducts('dropship_buyer_order_action', { p_action: 'confirm' }, r), false);
  assert.equal(invalidatesProducts('dropship_buyer_order_action', { p_action: 'cancel' }, r), true);
  assert.equal(invalidatesProducts('dropship_admin_cancel_order', {}, r), true);
  // A retry that changed nothing, or a failed call, clears nothing.
  assert.equal(invalidatesProducts('dropship_buyer_order_action', { p_action: 'cancel' }, { changed: false }), false);
  assert.equal(invalidatesProducts('dropship_buyer_order_action', { p_action: 'cancel' }, undefined), false);
  // Catalogue and listing writes still always clear.
  assert.equal(invalidatesProducts('dropship_set_stock', {}, undefined), true);
  assert.equal(invalidatesProducts('dropship_place_order', {}, r), false);
});
