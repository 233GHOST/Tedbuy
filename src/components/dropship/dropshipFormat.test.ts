import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  buildProductPayload, cedisToPesewas, dropshipErrorMessage, emptyProductForm, pesewasToCedisInput, productToForm,
  supplierStatusActions, type SupplierProduct, parseCedisToPesewas, isDropshipRowId,
} from './dropshipFormat';
import { isDropshipRowId as serverIsDropshipRowId } from '../../../server/dropship/legacyGuards';
// The server's own validator: the form's payloads must pass it unchanged.
import { parseProductCreate, parseProductUpdate } from '../../../server/dropship/validation';

const CLOUD = 'dfm3g2qvg';
const IMG = `https://res.cloudinary.com/${CLOUD}/image/upload/v1712000000/tedbuy_products/abc123.jpg`;

const filledForm = () => ({
  ...emptyProductForm(),
  title: 'Rice cooker 1.8L', description: 'Non-stick rice cooker, 700W, keeps warm.', category: 'Home Appliances',
  images: [IMG], wholesale: '250.00', suggestedRetail: '320', stockOnHand: '10', shipsFromRegion: 'Greater Accra',
  shipsFromCity: 'Accra', deliverySame: '15', deliveryOther: '',
});

const product = (over: Partial<SupplierProduct> = {}): SupplierProduct => ({
  id: crypto.randomUUID(), supplierId: 'u1', title: 'Rice cooker 1.8L', description: 'Non-stick rice cooker, 700W, keeps warm.',
  category: 'Home Appliances', condition: 'Brand New', brand: null, images: [IMG], wholesalePricePesewas: 25000,
  suggestedRetailPesewas: 32000, stockOnHand: 10, stockReserved: 0, stockAvailable: 10, maxPerOrder: 5,
  shipsFromRegion: 'Greater Accra', shipsFromCity: 'Accra', deliveryFeeSameRegionPesewas: 1500, deliveryFeeOtherRegionPesewas: null,
  leadTimeMinDays: 1, leadTimeMaxDays: 3, returnWindowDays: 3, returnConditions: null, status: 'active', moderationReason: null,
  publishedAt: '2026-10-26T10:00:00Z', contentVersion: 4, priceVersion: 2, createdAt: '', updatedAt: '', ...over,
});

test('cedis to pesewas is exact and rejects malformed amounts', () => {
  assert.equal(cedisToPesewas('250'), 25000);
  assert.equal(cedisToPesewas('250.5'), 25050);
  assert.equal(cedisToPesewas('0.07'), 7);
  assert.equal(cedisToPesewas('1,250.99'), 125099);
  assert.equal(cedisToPesewas(' 19.99 '), 1999); // 19.99 * 100 is 1998.9999... in floating point
  for (const bad of ['', '-5', '1.234', 'abc', '1e3', '12.', '.5']) assert.equal(cedisToPesewas(bad), null, bad);
  for (const p of [0, 7, 1999, 25050, 125099]) assert.equal(cedisToPesewas(pesewasToCedisInput(p)), p);
});

test('a new-product form produces a body the server validator accepts', () => {
  const payload = buildProductPayload(filledForm());
  assert.equal(payload.wholesalePricePesewas, 25000);
  assert.equal(payload.suggestedRetailPesewas, 32000);
  assert.equal(payload.stockOnHand, 10);
  const parsed = parseProductCreate({ ...payload, clientRequestId: crypto.randomUUID(), submit: true }, CLOUD, false);
  assert.equal(parsed.fields.wholesalePricePesewas, 25000);
  assert.equal(parsed.submit, true);
});

test('an edit sends only changed fields, and the server validator accepts it', () => {
  const original = product();
  assert.deepEqual(buildProductPayload(productToForm(original), original), {}, 'unchanged form sends nothing');

  const form = { ...productToForm(original), wholesale: '260', title: 'Rice cooker 1.8L (white)' };
  const changed = buildProductPayload(form, original);
  assert.deepEqual(changed, { title: 'Rice cooker 1.8L (white)', wholesalePricePesewas: 26000 });
  const parsed = parseProductUpdate({ ...changed, expectedContentVersion: original.contentVersion }, CLOUD, false);
  assert.deepEqual(parsed.fields, changed);
  assert.ok(!('stockOnHand' in changed), 'stock is never part of an edit');
});

test('form checks catch the common mistakes before a request is sent', () => {
  const cases: Array<[Partial<ReturnType<typeof filledForm>>, RegExp]> = [
    [{ images: [] }, /photo/],
    [{ wholesale: '' }, /Wholesale price is required/],
    [{ wholesale: '12.345' }, /amount in cedis/],
    [{ suggestedRetail: '100' }, /not be below the wholesale/],
    [{ stockOnHand: '-1' }, /whole number/],
    [{ leadMin: '5', leadMax: '2' }, /must not exceed/],
    [{ shipsFromRegion: '' }, /region/],
  ];
  for (const [over, msg] of cases) assert.throws(() => buildProductPayload({ ...filledForm(), ...over }), msg);
});

test('status actions match what the server permits', () => {
  assert.deepEqual(supplierStatusActions(product({ status: 'draft' })).map(a => a.to), ['pending_review', 'archived']);
  assert.deepEqual(supplierStatusActions(product({ status: 'active' })).map(a => a.to), ['paused', 'archived']);
  assert.deepEqual(supplierStatusActions(product({ status: 'paused' })).map(a => a.to), ['active', 'archived']);
  assert.deepEqual(supplierStatusActions(product({ status: 'paused', publishedAt: null })).map(a => a.to), ['archived']);
  assert.deepEqual(supplierStatusActions(product({ status: 'archived' })), []);
});

test('API error codes become user guidance', () => {
  assert.match(dropshipErrorMessage('FULFILMENT_ONLY', undefined), /suspended/);
  assert.match(dropshipErrorMessage('IMPERSONATION_FORBIDDEN', undefined), /another user/);
  assert.match(dropshipErrorMessage('STATE_CONFLICT', 'product was changed by someone else; reload it'), /reload it\.$/);
  assert.equal(dropshipErrorMessage('VALIDATION', 'title must be 3–128 characters.'), 'title must be 3–128 characters.');
});

test('parseCedisToPesewas parses user input to integer pesewas', () => {
  assert.equal(parseCedisToPesewas('150'), 15000);
  assert.equal(parseCedisToPesewas('150.5'), 15050);
  assert.equal(parseCedisToPesewas('1,250.00'), 125000);
  assert.equal(parseCedisToPesewas('abc'), null);
  assert.equal(parseCedisToPesewas('-1'), null);
  assert.equal(parseCedisToPesewas('0.001'), null);
});

test('client isDropshipRowId matches the server rule', () => {
  for (const id of ['dsl_abc', 'DSL_abc', 'Dsl_1', 'dsl', 'prod_1', '', null, undefined, 5, 'xdsl_1']) {
    assert.equal(isDropshipRowId(id), serverIsDropshipRowId(id), String(id));
  }
  assert.equal(isDropshipRowId('dsl_abc'), true);
});
