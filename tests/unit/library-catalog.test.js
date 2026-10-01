'use strict';

const { aggregate, authorsOf, publisherOf, filterSortPaginate, parsePaging, QueryTooShortError } = require('../../src/utils/library-catalog');

const author = { id: 1, biblionetTypeId: '1' };
const translator = { id: 2, biblionetTypeId: '2' };
const niki = { id: 10, searchKey: 'νικη λοιζιδη' };
const panos = { id: 11, searchKey: 'παναγιωτησ σκονδρασ' };
const books = [
  { id: 100, publisher: { id: 7, searchKey: 'νεφελη' }, contributors: [{ person: niki, role: author }, { person: panos, role: translator }] },
  { id: 101, publisher: { id: 7, searchKey: 'νεφελη' }, contributors: [{ person: niki, role: author }] },
  { id: 102, publisher: null, contributors: [{ person: null, role: author }, { person: panos, role: null }] },
];

test('authors: only author role, distinct books, broken rows ignored (Review Focus 1, 3)', () => {
  const rows = aggregate(books, authorsOf);
  expect(rows.map((r) => [r.entity.id, r.bookCount])).toEqual([[10, 2]]);
});

test('publishers: distinct books, null publisher ignored', () => {
  expect(aggregate(books, publisherOf).map((r) => [r.entity.id, r.bookCount])).toEqual([[7, 2]]);
});

test('filter by every token, sort by searchKey, paginate', () => {
  const entries = [{ entity: panos, bookCount: 1 }, { entity: niki, bookCount: 2 }];
  expect(filterSortPaginate(entries, undefined, { page: 1, pageSize: 1 })).toEqual({
    rows: [{ entity: niki, bookCount: 2 }],
    pagination: { page: 1, pageSize: 1, pageCount: 2, total: 2 },
  });
  expect(filterSortPaginate(entries, 'ΣΚΟΝΔΡΑΣ παν', { page: 1, pageSize: 25 }).rows.map((r) => r.entity.id)).toEqual([11]);
  expect(() => filterSortPaginate(entries, ' α ', { page: 1, pageSize: 25 })).toThrow(QueryTooShortError);
});

test('paging defaults and bounds', () => {
  expect(parsePaging({})).toEqual({ page: 1, pageSize: 25 });
  expect(parsePaging({ page: '0', pageSize: '500' })).toEqual({ page: 1, pageSize: 100 });
  expect(parsePaging({ page: '3', pageSize: 'x' })).toEqual({ page: 3, pageSize: 25 });
});
