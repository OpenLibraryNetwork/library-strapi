'use strict';

const {
  parsePublicationQuery,
  publicationFilters,
  parseSearchQuery,
  parsePaging,
  CatalogQueryError,
} = require('../../src/utils/catalog-query');

const filtersOf = (query) => publicationFilters(parsePublicationQuery(query));

test('no parameters: no filters, first page of 24', () => {
  expect(filtersOf({})).toEqual({});
  expect(parsePublicationQuery({})).toMatchObject({ page: 1, pageSize: 24 });
});

test('q becomes accent-insensitive searchKey tokens', () => {
  expect(filtersOf({ q: '  Οικολογία  ελευθερίας ' })).toEqual({
    $and: [{ $and: [{ searchKey: { $contains: 'οικολογια' } }, { searchKey: { $contains: 'ελευθεριασ' } }] }],
  });
});

test('a valid ISBN (with hyphens) also matches the isbn field', () => {
  expect(filtersOf({ q: '978-618-5895-00-6' }).$and[0].$or).toContainEqual({ isbn: '9786185895006' });
});

test('type is an exact filter', () => {
  expect(filtersOf({ type: 'Μπροσούρα' })).toEqual({ $and: [{ type: 'Μπροσούρα' }] });
});

test('library and available apply to the same copy (one relation object)', () => {
  expect(filtersOf({ library: 'lib-a', available: 'true' })).toEqual({
    $and: [{ copies: { library: { documentId: 'lib-a' }, isAvailable: true } }],
  });
});

test('available=false and empty values are ignored', () => {
  expect(filtersOf({ q: '', type: '', library: '', available: 'false', person: '', publisher: '' })).toEqual({});
});

test('page and pageSize', () => {
  expect(parsePublicationQuery({ page: '3', pageSize: '100' })).toMatchObject({ page: 3, pageSize: 100 });
  expect(parsePaging({ page: '2' })).toEqual({ page: 2, pageSize: 24 });
});

test('person and role go into ONE contributors object', () => {
  expect(filtersOf({ person: 'p1', role: 'r1' })).toEqual({
    $and: [{ contributors: { person: { documentId: 'p1' }, role: { documentId: 'r1' } } }],
  });
});

test('role override for facet counts', () => {
  const parsed = parsePublicationQuery({ person: 'p1', role: 'r1', type: 'Βιβλίο' });
  expect(publicationFilters(parsed, { role: 'r2' }).$and)
    .toContainEqual({ contributors: { person: { documentId: 'p1' }, role: { documentId: 'r2' } } });
  expect(publicationFilters(parsed, { role: null }).$and).toContainEqual({ contributors: { person: { documentId: 'p1' } } });
  expect(publicationFilters(parsed, { role: null }).$and).toContainEqual({ type: 'Βιβλίο' });
});

test('publisher and magazine', () => {
  expect(filtersOf({ publisher: 'pub1', magazine: 'm1' }).$and)
    .toEqual([{ publisher: { documentId: 'pub1' } }, { magazine: { documentId: 'm1' } }]);
  expect(parsePublicationQuery({ magazine: 'm1' }).magazine).toBe('m1');
});

test('search lists: q required unless told otherwise', () => {
  expect(() => parseSearchQuery({}, { required: true })).toThrow(CatalogQueryError);
  expect(() => parseSearchQuery({ q: 'α' }, { required: true })).toThrow(CatalogQueryError);
  expect(parseSearchQuery({}, { required: false })).toEqual({ filters: {}, page: 1, pageSize: 24 });
  expect(parseSearchQuery({ q: 'Λοϊζίδη', pageSize: '5' }, { required: true }))
    .toEqual({ filters: { $and: [{ searchKey: { $contains: 'λοιζιδη' } }] }, page: 1, pageSize: 5 });
});

test.each([
  [{ q: 'α' }],
  [{ q: '--' }],
  [{ type: 'Άλλο' }],
  [{ page: '0' }],
  [{ page: '1.5' }],
  [{ page: 'abc' }],
  [{ pageSize: '0' }],
  [{ pageSize: '101' }],
  [{ available: 'yes' }],
  [{ role: 'r1' }],
])('%j is rejected', (query) => {
  expect(() => parsePublicationQuery(query)).toThrow(CatalogQueryError);
});
