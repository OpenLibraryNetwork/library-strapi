'use strict';

/**
 * catalog controller: the public site's lists. Every list is filtered, sorted and paginated here;
 * each record carries only the fields the site shows.
 */

const {
  CatalogQueryError,
  parsePaging,
  parsePublicationQuery,
  parseSearchQuery,
  publicationFilters,
} = require('../../../utils/catalog-query');
const { CARD_FIELDS, CARD_POPULATE, availabilityByBook, toCard, roleFacets } = require('../../../utils/catalog-cards');

const BOOK = 'api::book.book';

const ALPHABETICAL = [{ searchKey: 'asc' }, { id: 'asc' }];
const NEWEST_FIRST = [{ createdAt: 'desc' }, { id: 'desc' }];
const ISSUE_ORDER = [{ issueOrder: 'desc' }, ...NEWEST_FIRST];

const pagination = (page, pageSize, total) => ({ page, pageSize, pageCount: Math.ceil(total / pageSize), total });

// One page of a collection with only `fields`; `shape` builds each record explicitly.
async function listPage(uid, { filters, sort, page, pageSize, fields, shape }) {
  const documents = strapi.documents(uid);
  const [rows, total] = await Promise.all([
    documents.findMany({ filters, fields, sort, start: (page - 1) * pageSize, limit: pageSize }),
    documents.count({ filters }),
  ]);
  return { data: rows.map(shape), meta: { pagination: pagination(page, pageSize, total) } };
}

const entity = (row) => ({ documentId: row.documentId, name: row.name, qualifier: row.qualifier ?? null });

function searchList(uid) {
  return guarded(async (ctx) => {
    const { filters, page, pageSize } = parseSearchQuery(ctx.query, { required: true });
    ctx.body = await listPage(uid, { filters, sort: ALPHABETICAL, page, pageSize, fields: ['name', 'qualifier'], shape: entity });
  });
}

// Runs an action; a CatalogQueryError becomes 400 with its message.
const guarded = (action) => async (ctx) => {
  try {
    return await action(ctx);
  } catch (err) {
    if (err instanceof CatalogQueryError) return ctx.badRequest(err.message);
    throw err;
  }
};

module.exports = {
  /**
   * GET /api/catalog/publications?q=&type=&library=&available=&person=&role=&publisher=&magazine=&page=&pageSize=
   */
  publications: guarded(async (ctx) => {
    const parsed = parsePublicationQuery(ctx.query);
    const { page, pageSize } = parsed;
    const filters = publicationFilters(parsed);
    const documents = strapi.documents(BOOK);
    const [books, total, roles] = await Promise.all([
      documents.findMany({
        filters,
        fields: CARD_FIELDS,
        populate: CARD_POPULATE,
        sort: parsed.magazine ? ISSUE_ORDER : NEWEST_FIRST,
        start: (page - 1) * pageSize,
        limit: pageSize,
      }),
      documents.count({ filters }),
      parsed.person ? roleFacets(strapi, parsed) : undefined,
    ]);
    const availability = await availabilityByBook(strapi, books.map((b) => b.id));
    const meta = { pagination: pagination(page, pageSize, total) };
    if (roles) meta.roles = roles;
    ctx.body = { data: books.map((b) => toCard(b, availability.get(b.id))), meta };
  }),

  /**
   * GET /api/catalog/search-counts?q=&type=&library=&available=  — the counts of the search tabs.
   */
  searchCounts: guarded(async (ctx) => {
    const { filters: search } = parseSearchQuery({ q: ctx.query.q }, { required: true });
    const publications = publicationFilters(parsePublicationQuery({
      q: ctx.query.q, type: ctx.query.type, library: ctx.query.library, available: ctx.query.available,
    }));
    const count = (uid, filters) => strapi.documents(uid).count({ filters });
    const [p, persons, publishers, magazines] = await Promise.all([
      count(BOOK, publications),
      count('api::person.person', search),
      count('api::publisher.publisher', search),
      count('api::magazine.magazine', search),
    ]);
    ctx.body = { data: { publications: p, persons, publishers, magazines } };
  }),

  /** GET /api/catalog/persons?q=&page=&pageSize= */
  persons: searchList('api::person.person'),

  /** GET /api/catalog/publishers?q=&page=&pageSize= */
  publishers: searchList('api::publisher.publisher'),

  /**
   * GET /api/catalog/magazines?q=  or  ?publisher=  (one of the two is required)
   */
  magazines: guarded(async (ctx) => {
    const publisher = ctx.query.publisher ? String(ctx.query.publisher) : '';
    const { filters, page, pageSize } = parseSearchQuery(ctx.query, { required: !publisher });
    const conditions = [filters, publisher ? { publisher: { documentId: publisher } } : null]
      .filter((c) => c && Object.keys(c).length > 0);
    ctx.body = await listPage('api::magazine.magazine', {
      filters: conditions.length ? { $and: conditions } : {},
      sort: ALPHABETICAL,
      page,
      pageSize,
      fields: ['title', 'qualifier', 'issn'],
      shape: (row) => ({ documentId: row.documentId, title: row.title, qualifier: row.qualifier ?? null, issn: row.issn ?? null }),
    });
  }),

  /**
   * GET /api/catalog/libraries?compact=true&page=&pageSize=  — compact: only documentId and name (dropdown).
   */
  libraries: guarded(async (ctx) => {
    const { page, pageSize } = parsePaging(ctx.query);
    const compact = ctx.query.compact === 'true';
    ctx.body = await listPage('api::library.library', {
      filters: {},
      sort: [{ name: 'asc' }, { id: 'asc' }],
      page,
      pageSize,
      fields: compact ? ['name'] : ['name', 'description'],
      shape: (row) => (compact
        ? { documentId: row.documentId, name: row.name }
        : { documentId: row.documentId, name: row.name, description: row.description ?? null }),
    });
  }),
};
