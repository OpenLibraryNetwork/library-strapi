'use strict';

const { parseBrowseQuery, BrowseQueryError } = require('../../src/utils/catalog-browse');

test('no parameters: no filters, first page of 24', () => {
  expect(parseBrowseQuery({})).toEqual({ filters: {}, page: 1, pageSize: 24 });
});

test('q becomes accent-insensitive searchKey tokens', () => {
  expect(parseBrowseQuery({ q: '  Οικολογία  ελευθερίας ' }).filters).toEqual({
    $and: [{ $and: [{ searchKey: { $contains: 'οικολογια' } }, { searchKey: { $contains: 'ελευθεριασ' } }] }],
  });
});

test('a valid ISBN (with hyphens) also matches the isbn field', () => {
  const { filters } = parseBrowseQuery({ q: '978-618-5895-00-6' });
  expect(filters.$and[0].$or).toContainEqual({ isbn: '9786185895006' });
});

test('type is an exact filter', () => {
  expect(parseBrowseQuery({ type: 'Μπροσούρα' }).filters).toEqual({ $and: [{ type: 'Μπροσούρα' }] });
});

test('library and available apply to the same copy (one relation object)', () => {
  expect(parseBrowseQuery({ library: 'lib-a', available: 'true' }).filters).toEqual({
    $and: [{ copies: { library: { documentId: 'lib-a' }, isAvailable: true } }],
  });
});

test('available=false and empty values are ignored', () => {
  expect(parseBrowseQuery({ q: '', type: '', library: '', available: 'false' })).toEqual({ filters: {}, page: 1, pageSize: 24 });
});

test('page and pageSize', () => {
  expect(parseBrowseQuery({ page: '3', pageSize: '100' })).toMatchObject({ page: 3, pageSize: 100 });
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
])('%j is rejected', (query) => {
  expect(() => parseBrowseQuery(query)).toThrow(BrowseQueryError);
});
