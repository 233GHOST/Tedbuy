import test from 'node:test';
import assert from 'node:assert/strict';
import { getRegionForLocation, GHANA_REGIONS } from './regions.ts';

// Zero imports, safe to import directly. Confirmed byte-identical to
// mobile/src/regions.ts. getRegionForLocation backs productSelector.ts's
// region filter on both platforms.

test('getRegionForLocation: a dominant city listed in the fast-path checks resolves correctly', () => {
  assert.equal(getRegionForLocation('East Legon, Accra'), 'Greater Accra');
  assert.equal(getRegionForLocation('Kumasi'), 'Ashanti');
  assert.equal(getRegionForLocation('Takoradi'), 'Western');
  assert.equal(getRegionForLocation('Cape Coast'), 'Central');
  assert.equal(getRegionForLocation('Koforidua'), 'Eastern');
  assert.equal(getRegionForLocation('Tamale'), 'Northern');
});

test('getRegionForLocation: "Ho" (Volta capital) matches via its special-cased exact/boundary check, not as a substring of an unrelated word', () => {
  assert.equal(getRegionForLocation('Ho'), 'Volta');
  assert.equal(getRegionForLocation('Ho, Volta Region'), 'Volta');
});

test('getRegionForLocation: a city only present in the GHANA_REGIONS fallback list (not the fast-path) still resolves', () => {
  // "Wa" is Upper West's capital, not covered by any of the fast-path checks above.
  assert.equal(getRegionForLocation('Wa'), 'Upper West');
});

test('getRegionForLocation: matching is case-insensitive', () => {
  assert.equal(getRegionForLocation('ACCRA'), 'Greater Accra');
  assert.equal(getRegionForLocation('kUmAsI'), 'Ashanti');
});

test('getRegionForLocation: an unrecognized location falls back to "Other Region"', () => {
  assert.equal(getRegionForLocation('Nowhereville'), 'Other Region');
});

test('getRegionForLocation: null, undefined, and non-string input all safely return "Other Region"', () => {
  assert.equal(getRegionForLocation(null), 'Other Region');
  assert.equal(getRegionForLocation(undefined), 'Other Region');
  assert.equal(getRegionForLocation(123 as any), 'Other Region');
});

test('getRegionForLocation: a region name itself (not a city) matches via the fallback loop', () => {
  assert.equal(getRegionForLocation('Somewhere in the Savannah area'), 'Savannah');
});

test('GHANA_REGIONS: every region has a non-empty name and at least one city, no duplicate region names', () => {
  assert.ok(GHANA_REGIONS.length > 0);
  const names = GHANA_REGIONS.map(r => r.name);
  assert.equal(new Set(names).size, names.length, 'region names must be unique');
  for (const region of GHANA_REGIONS) {
    assert.ok(region.name.trim().length > 0);
    assert.ok(region.cities.length > 0, `${region.name} should list at least one city`);
  }
});
