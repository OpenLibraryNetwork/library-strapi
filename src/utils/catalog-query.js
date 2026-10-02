'use strict';

const { buildSearchFilters } = require('./catalog-search');
const { normalizeIsbn } = require('./isbn');

const TYPES = ['Βιβλίο', 'Μπροσούρα', 'Περιοδικό'];
const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;

/** Invalid query parameter of a /api/catalog endpoint: the controller answers 400 with this message. */
class CatalogQueryError extends Error {}

const isBlank = (value) => value === undefined || value === null || value === '';
const text = (value) => (isBlank(value) ? undefined : String(value));

function positiveInteger(raw, name, { max, fallback }) {
  if (isBlank(raw)) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || (max !== undefined && n > max)) {
    throw new CatalogQueryError(`Μη έγκυρη τιμή για το ${name}.`);
  }
  return n;
}

function parsePaging(query = {}) {
  return {
    page: positiveInteger(query.page, 'page', { fallback: 1 }),
    pageSize: positiveInteger(query.pageSize, 'pageSize', { max: MAX_PAGE_SIZE, fallback: DEFAULT_PAGE_SIZE }),
  };
}

function searchCondition(q) {
  const search = buildSearchFilters(q);
  if (!search) throw new CatalogQueryError('Η αναζήτηση χρειάζεται τουλάχιστον 2 χαρακτήρες.');
  return search;
}

/**
 * GET /api/catalog/publications query. Every parameter is optional.
 * `conditions` holds every filter except person/role: those must share ONE contributors object
 * (see publicationFilters), exactly as library/available share one copies object.
 */
function parsePublicationQuery(query = {}) {
  const conditions = [];

  const q = isBlank(query.q) ? '' : String(query.q).trim();
  if (q) {
    const search = searchCondition(q);
    const isbn = normalizeIsbn(q);
    conditions.push(isbn ? { $or: [search, { isbn }] } : search);
  }

  if (!isBlank(query.type)) {
    if (!TYPES.includes(query.type)) throw new CatalogQueryError('Άγνωστος τύπος εντύπου.');
    conditions.push({ type: query.type });
  }

  const copy = {};
  if (!isBlank(query.library)) copy.library = { documentId: String(query.library) };
  if (query.available === 'true') copy.isAvailable = true;
  else if (!isBlank(query.available) && query.available !== 'false') {
    throw new CatalogQueryError('Το available δέχεται μόνο true ή false.');
  }
  if (Object.keys(copy).length > 0) conditions.push({ copies: copy });

  const publisher = text(query.publisher);
  if (publisher) conditions.push({ publisher: { documentId: publisher } });
  const magazine = text(query.magazine);
  if (magazine) conditions.push({ magazine: { documentId: magazine } });

  const person = text(query.person);
  const role = text(query.role);
  if (role && !person) throw new CatalogQueryError('Το φίλτρο ρόλου θέλει πρόσωπο.');

  return { conditions, person, role, magazine, ...parsePaging(query) };
}

/**
 * Document Service filters of a parsed publication query. `options.role` replaces the role
 * (a documentId, or null for "any role"): used for the per-role counts of a person.
 */
function publicationFilters(parsed, options = {}) {
  const conditions = [...parsed.conditions];
  if (parsed.person) {
    const role = Object.prototype.hasOwnProperty.call(options, 'role') ? options.role : parsed.role;
    const contributor = { person: { documentId: parsed.person } };
    if (role) contributor.role = { documentId: role };
    conditions.push({ contributors: contributor });
  }
  return conditions.length > 0 ? { $and: conditions } : {};
}

/** Persons, publishers, magazines: `q` on the searchKey; `required` → 400 without it. */
function parseSearchQuery(query = {}, { required }) {
  const q = isBlank(query.q) ? '' : String(query.q).trim();
  if (!q && required) throw new CatalogQueryError('Η αναζήτηση χρειάζεται τουλάχιστον 2 χαρακτήρες.');
  return { filters: q ? searchCondition(q) : {}, ...parsePaging(query) };
}

module.exports = {
  CatalogQueryError,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  parsePaging,
  parsePublicationQuery,
  publicationFilters,
  parseSearchQuery,
};
