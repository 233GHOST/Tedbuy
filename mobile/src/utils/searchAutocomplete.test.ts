import test from 'node:test';
import assert from 'node:assert/strict';
import { extractProductCandidateTerms, scorePrefixMatch, getPrefixAutocompleteSuggestions } from './searchAutocomplete.ts';

// Zero imports, safe to import directly. Confirmed byte-identical to
// mobile/src/utils/searchAutocomplete.ts (mobile is a standalone Expo
// project with no shared workspace, so the logic is deliberately
// duplicated rather than imported cross-project).

test('extractProductCandidateTerms: pulls brand, full title, and category', () => {
  const terms = extractProductCandidateTerms({ title: 'iPhone 13 Pro Max', brand: 'Apple', category: 'Phones' });
  assert.ok(terms.includes('Apple'));
  assert.ok(terms.includes('iPhone 13 Pro Max'));
  assert.ok(terms.includes('Phones'));
});

test('extractProductCandidateTerms: strips a leading modifier to expose the root model name', () => {
  const terms = extractProductCandidateTerms({ title: 'Clean Hyundai Elantra 2018' });
  assert.ok(terms.includes('Hyundai Elantra 2018'));
  assert.ok(terms.includes('Clean Hyundai Elantra 2018'));
});

test('extractProductCandidateTerms: generates 2-word and 3-word sub-phrases from word boundaries', () => {
  const terms = extractProductCandidateTerms({ title: 'Samsung Galaxy S24 Ultra' });
  assert.ok(terms.includes('Samsung Galaxy'));
  assert.ok(terms.includes('Samsung Galaxy S24'));
});

test('extractProductCandidateTerms: stop words and pure numbers are not added as standalone keywords', () => {
  const terms = extractProductCandidateTerms({ title: 'Car for sale 2018' });
  assert.ok(!terms.includes('for'));
  assert.ok(!terms.includes('sale'));
  assert.ok(!terms.includes('2018'));
});

test('extractProductCandidateTerms: "All" category is excluded, real category/subcategory are included', () => {
  const terms = extractProductCandidateTerms({ title: 'Item', category: 'All', subcategory: 'Sedans' });
  assert.ok(!terms.includes('All'));
  assert.ok(terms.includes('Sedans'));
});

test('extractProductCandidateTerms: brand not present in title gets prefixed onto the first words', () => {
  const terms = extractProductCandidateTerms({ title: 'Elantra 2018', brand: 'Hyundai' });
  assert.ok(terms.includes('Hyundai Elantra 2018'));
});

test('extractProductCandidateTerms: empty/whitespace-only fields contribute nothing', () => {
  assert.deepEqual(extractProductCandidateTerms({ title: ' ', brand: ' ' }), []);
});

test('scorePrefixMatch: exact match scores highest, brand exact match scores even higher', () => {
  const exact = scorePrefixMatch('Toyota', 'Toyota');
  const exactBrand = scorePrefixMatch('Toyota', 'Toyota', true);
  assert.equal(exact, 4000);
  assert.equal(exactBrand, 9000);
});

test('scorePrefixMatch: a direct prefix match scores above a word-boundary/substring match', () => {
  const prefix = scorePrefixMatch('Hyundai Elantra', 'hyun');
  const wordBoundary = scorePrefixMatch('Toyota Hyundai', 'hyun');
  assert.ok(prefix > 0);
  assert.ok(prefix > wordBoundary);
});

test('scorePrefixMatch: direct prefix match is brand-boosted and length-penalized', () => {
  const short = scorePrefixMatch('Hyundai', 'hyun', true);
  const long = scorePrefixMatch('Hyundai Elantra 2018 Clean Foreign Used', 'hyun', true);
  assert.ok(short > long, 'shorter candidate should outscore a longer one for the same prefix match');
});

test('scorePrefixMatch: word-boundary prefix match scores lower than a leading prefix match, earlier words score higher', () => {
  const early = scorePrefixMatch('Elantra Hyundai', 'hyun');
  const later = scorePrefixMatch('Toyota Corolla Hyundai', 'hyun');
  assert.ok(early > 0 && later > 0);
  assert.ok(early > later, 'a word matching earlier in the phrase should score higher');
});

test('scorePrefixMatch: mid-word substring match only kicks in for queries of 4+ chars', () => {
  assert.equal(scorePrefixMatch('Hyundai Elantra', 'und'), 0);
  assert.ok(scorePrefixMatch('Hyundai Elantra', 'unda') > 0);
});

test('scorePrefixMatch: no match at all returns 0', () => {
  assert.equal(scorePrefixMatch('Hyundai Elantra', 'zzz'), 0);
});

test('scorePrefixMatch: empty candidate or query returns 0, never throws', () => {
  assert.equal(scorePrefixMatch('', 'hy'), 0);
  assert.equal(scorePrefixMatch('Hyundai', ''), 0);
});

test('getPrefixAutocompleteSuggestions: empty query returns trending defaults (or popularKeywords if provided)', () => {
  const defaults = getPrefixAutocompleteSuggestions('', []);
  assert.ok(defaults.length > 0);
  assert.ok(defaults.every(s => s.type === 'trending'));

  const withPopular = getPrefixAutocompleteSuggestions('', [], { popularKeywords: ['Custom Trend'] });
  assert.deepEqual(withPopular, [{ text: 'Custom Trend', type: 'trending' }]);
});

test('getPrefixAutocompleteSuggestions: matches products by brand and title prefix, ranked by score', () => {
  const products = [
    { title: 'Hyundai Elantra 2018', brand: 'Hyundai' },
    { title: 'Toyota Corolla 2019', brand: 'Toyota' },
  ];
  const results = getPrefixAutocompleteSuggestions('hyun', products);
  assert.ok(results.some(r => r.text === 'Hyundai'));
  assert.ok(!results.some(r => r.text.toLowerCase().startsWith('toyota')));
});

test('getPrefixAutocompleteSuggestions: results are deduplicated (case-insensitive) across products and popularKeywords', () => {
  const products = [{ title: 'Hyundai Elantra', brand: 'Hyundai' }];
  const results = getPrefixAutocompleteSuggestions('hyun', products, { popularKeywords: ['hyundai'] });
  const hyundaiHits = results.filter(r => r.text.toLowerCase() === 'hyundai');
  assert.equal(hyundaiHits.length, 1);
});

test('getPrefixAutocompleteSuggestions: respects the limit option', () => {
  const products = Array.from({ length: 20 }, (_, i) => ({ title: `Hyundai Model ${i}`, brand: 'Hyundai' }));
  const results = getPrefixAutocompleteSuggestions('hyun', products, { limit: 3 });
  assert.ok(results.length <= 3);
});

test('getPrefixAutocompleteSuggestions: null/undefined entries in the products array are skipped without throwing', () => {
  const products = [null, undefined, { title: 'Hyundai Elantra', brand: 'Hyundai' }] as any;
  const results = getPrefixAutocompleteSuggestions('hyun', products);
  assert.ok(results.some(r => r.text === 'Hyundai'));
});
