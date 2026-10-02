'use strict';

const { buildSearchFilters } = require('./catalog-search');
const { normalizeIsbn } = require('./isbn');

const TYPES = ['Βιβλίο', 'Μπροσούρα', 'Περιοδικό'];
const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;

class BrowseQueryError extends Error {}

const isBlank = (value) => value === undefined || value === null || value === '';

function positiveInteger(raw, name, { max, fallback }) {
  if (isBlank(raw)) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || (max !== undefined && n > max)) {
    throw new BrowseQueryError(`Μη έγκυρη τιμή για το ${name}.`);
  }
  return n;
}

/**
 * GET /api/books/browse query → Document Service filters.
 * Every parameter is optional. `library` and `available` go into ONE `copies` object, so the
 * database joins one copy for both: the available copy must be in that library.
 */
function parseBrowseQuery(query = {}) {
  const conditions = [];

  const q = isBlank(query.q) ? '' : String(query.q).trim();
  if (q) {
    const search = buildSearchFilters(q);
    if (!search) throw new BrowseQueryError('Η αναζήτηση χρειάζεται τουλάχιστον 2 χαρακτήρες.');
    const isbn = normalizeIsbn(q);
    conditions.push(isbn ? { $or: [search, { isbn }] } : search);
  }

  if (!isBlank(query.type)) {
    if (!TYPES.includes(query.type)) throw new BrowseQueryError('Άγνωστος τύπος εντύπου.');
    conditions.push({ type: query.type });
  }

  const copy = {};
  if (!isBlank(query.library)) copy.library = { documentId: String(query.library) };
  if (query.available === 'true') copy.isAvailable = true;
  else if (!isBlank(query.available) && query.available !== 'false') {
    throw new BrowseQueryError('Το available δέχεται μόνο true ή false.');
  }
  if (Object.keys(copy).length > 0) conditions.push({ copies: copy });

  return {
    filters: conditions.length > 0 ? { $and: conditions } : {},
    page: positiveInteger(query.page, 'page', { fallback: 1 }),
    pageSize: positiveInteger(query.pageSize, 'pageSize', { max: MAX_PAGE_SIZE, fallback: DEFAULT_PAGE_SIZE }),
  };
}

module.exports = { parseBrowseQuery, BrowseQueryError, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE };
