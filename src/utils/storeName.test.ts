import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateStoreName } from './storeName.ts';

test('real shop names are accepted', () => {
  for (const n of ['ISBON STORE | Laptops, Gaming & More', "Ama's Boutique", 'Nana Gadgets', 'Kofi-Phones_GH', 'Café Accra (Osu)', 'A+ Electronics / Kumasi']) {
    assert.equal(validateStoreName(n).isValid, true, n);
  }
});

test('length is 3 to 50 characters after trimming', () => {
  assert.equal(validateStoreName('  ab  ').isValid, false);
  assert.equal(validateStoreName('abc').isValid, true);
  assert.equal(validateStoreName('x'.repeat(50)).isValid, true);
  assert.equal(validateStoreName('x'.repeat(51)).isValid, false);
  assert.equal(validateStoreName('').isValid, false);
});

test('markup, emoji and other symbols are refused with a plain message', () => {
  for (const n of ['<b>Shop</b>', 'Shop 🔥', 'Shop $$$', 'Shop@home', 'Shop#1']) {
    const r = validateStoreName(n);
    assert.equal(r.isValid, false, n);
    assert.match(r.error ?? '', /letters, numbers, spaces/);
  }
});

test('the app copy of the rule matches this one (only the first comment line differs)', () => {
  const body = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8').split('\n').slice(1).join('\n');
  assert.equal(body('../../mobile/src/utils/storeName.ts'), body('./storeName.ts'));
});
