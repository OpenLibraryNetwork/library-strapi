'use strict';

const { tokenize } = require('./text-keys');
const { getUserLibraryId } = require('./library');

const AUTHOR_ROLE_TYPE_ID = '1';
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

class QueryTooShortError extends Error {
  constructor() {
    super('Η αναζήτηση χρειάζεται τουλάχιστον 2 χαρακτήρες.');
    this.name = 'QueryTooShortError';
  }
}

/**
 * Books with at least one copy in the library, with contributors and publisher.
 * Aggregation happens in memory: small libraries (up to a few thousand titles).
 */
async function findLibraryBooks(strapi, libraryId) {
  return strapi.entityService.findMany('api::book.book', {
    filters: { copies: { library: { id: libraryId } } },
    populate: { contributors: { populate: ['person', 'role'] }, publisher: true, magazine: { populate: ['publisher'] } },
  });
}

function authorsOf(book) {
  return (book.contributors || [])
    .filter((c) => c.role?.biblionetTypeId === AUTHOR_ROLE_TYPE_ID)
    .map((c) => c.person);
}

function publisherOf(book) {
  return [book.publisher];
}

function magazineOf(book) {
  return book.type === 'Περιοδικό' ? [book.magazine] : [];
}

/** magazineId → number of its issues that have a copy in the library. */
async function issueCountsInLibrary(strapi, libraryId) {
  const books = await findLibraryBooks(strapi, libraryId);
  return new Map(aggregate(books, magazineOf).map(({ entity, bookCount }) => [entity.id, bookCount]));
}

function aggregate(books, pick) {
  const byId = new Map();
  for (const book of books) {
    for (const entity of pick(book)) {
      if (!entity) continue;
      if (!byId.has(entity.id)) byId.set(entity.id, { entity, bookIds: new Set() });
      byId.get(entity.id).bookIds.add(book.id);
    }
  }
  return [...byId.values()].map(({ entity, bookIds }) => ({ entity, bookCount: bookIds.size }));
}

function parsePaging(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(query.pageSize, 10) || DEFAULT_PAGE_SIZE));
  return { page, pageSize };
}

function filterSortPaginate(entries, q, { page, pageSize }) {
  let rows = entries;
  if (q !== undefined && q !== null && String(q).trim() !== '') {
    const tokens = tokenize(q);
    if (tokens.join('').length < 2) throw new QueryTooShortError();
    rows = rows.filter(({ entity }) => tokens.every((t) => (entity.searchKey || '').includes(t)));
  }
  rows = [...rows].sort(
    (a, b) => (a.entity.searchKey || '').localeCompare(b.entity.searchKey || '') || a.entity.id - b.entity.id
  );
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), pagination: { page, pageSize, pageCount, total } };
}

/**
 * Controller action factory: persons/authors, publishers/in-library.
 * The library comes from the authenticated user, never from a parameter.
 */
function libraryListAction(pick, countField = 'bookCount') {
  return async function libraryList(ctx) {
    const libraryId = await getUserLibraryId(strapi, ctx.state.user);
    if (!libraryId) return ctx.forbidden('Ο χρήστης δεν ανήκει σε βιβλιοθήκη.');

    let result;
    try {
      const books = await findLibraryBooks(strapi, libraryId);
      result = filterSortPaginate(aggregate(books, pick), ctx.query.q, parsePaging(ctx.query));
    } catch (err) {
      if (err instanceof QueryTooShortError) return ctx.badRequest(err.message);
      throw err;
    }

    const sanitized = await this.sanitizeOutput(result.rows.map((r) => r.entity), ctx);
    const body = this.transformResponse(sanitized, { pagination: result.pagination });
    body.data.forEach((item, i) => {
      item.attributes[countField] = result.rows[i].bookCount;
    });
    return body;
  };
}

module.exports = {
  AUTHOR_ROLE_TYPE_ID,
  QueryTooShortError,
  findLibraryBooks,
  authorsOf,
  publisherOf,
  magazineOf,
  issueCountsInLibrary,
  aggregate,
  parsePaging,
  filterSortPaginate,
  libraryListAction,
};
