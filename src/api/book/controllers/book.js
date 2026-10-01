'use strict';

/**
 * book controller
 * Librarians never write books through the generic CRUD actions:
 * - isbnLookup: catalog → Biblionet import
 * - browse: public catalogue listing (frontend token)
 * (search and createLocal are added in later tasks)
 */

const { createCoreController } = require('@strapi/strapi').factories;
const quota = require('../services/biblionet-quota');
const {
  InvalidIsbnError,
  QuotaExceededError,
  BiblionetUnavailableError,
} = require('../../../utils/catalog-errors');
const { searchAction } = require('../../../utils/catalog-search');
const { BOOK_POPULATE } = require('../../../utils/book-populate');
const { parseBrowseQuery, BrowseQueryError } = require('../../../utils/catalog-browse');
const { normalizeIsbn } = require('../../../utils/isbn');
const {
  LOCAL_FIELDS,
  LocalInputError,
  pickFields,
  resolveDocumentIds,
  createLocalRecord,
} = require('../../../utils/local-catalog');

const LOCAL_TYPES = ['Βιβλίο', 'Μπροσούρα', 'Περιοδικό'];

function handleImportError(ctx, err) {
  if (err instanceof InvalidIsbnError) return ctx.badRequest(err.message);
  if (err instanceof QuotaExceededError) return ctx.tooManyRequests(err.message);
  if (err instanceof BiblionetUnavailableError) return ctx.throw(502, err.message);
  throw err;
}

// Kept outside the controller object so it is never mistaken for a route action.
async function respondWithBook(controller, ctx, source, book, status = 200) {
  const data = book ? (await controller.transformResponse(await controller.sanitizeOutput(book, ctx))).data : null;
  ctx.status = status;
  ctx.body = { source, data, quota: quota.getUsage() };
}

module.exports = createCoreController('api::book.book', ({ strapi }) => ({
  /**
   * GET /api/books/search?q=&type=
   */
  search: searchAction('api::book.book', { populate: BOOK_POPULATE, allowType: true }),

  /**
   * GET /api/books/browse?q=&type=&library=&available=&page=&pageSize=
   * Public catalogue listing (frontend token): every filter optional, newest first, paginated.
   */
  async browse(ctx) {
    let query;
    try {
      query = parseBrowseQuery(ctx.query);
    } catch (err) {
      if (err instanceof BrowseQueryError) return ctx.badRequest(err.message);
      throw err;
    }
    const { filters, page, pageSize } = query;
    const documents = strapi.documents('api::book.book');
    const [results, total] = await Promise.all([
      documents.findMany({
        filters,
        populate: BOOK_POPULATE,
        sort: [{ createdAt: 'desc' }, { id: 'desc' }],
        start: (page - 1) * pageSize,
        limit: pageSize,
      }),
      documents.count({ filters }),
    ]);
    const pagination = { page, pageSize, pageCount: Math.ceil(total / pageSize), total };
    return this.transformResponse(await this.sanitizeOutput(results, ctx), { pagination });
  },

  /**
   * POST /api/books/isbn-lookup  { isbn }
   */
  async isbnLookup(ctx) {
    const { isbn } = ctx.request.body || {};
    try {
      const { source, book } = await strapi.service('api::book.isbn-import').lookup(isbn);
      return respondWithBook(this, ctx, source, book);
    } catch (err) {
      return handleImportError(ctx, err);
    }
  },

  /**
   * POST /api/books/local
   * { data: { type: 'Βιβλίο'|'Μπροσούρα'|'Περιοδικό', title, isbn?, magazine?, publisher?, contributors?: [{ person, role }], subjects?: [...] } }
   * Relations are documentIds.
   */
  async createLocal(ctx) {
    const input = ctx.request.body?.data;
    if (!input || typeof input !== 'object') return ctx.badRequest('Λείπει το σώμα { data }.');
    if (!LOCAL_TYPES.includes(input.type)) return ctx.badRequest('Ο τύπος πρέπει να είναι «Βιβλίο», «Μπροσούρα» ή «Περιοδικό».');

    let data;
    try {
      data = pickFields(input, LOCAL_FIELDS.book);
      if (input.type === 'Περιοδικό') {
        if (typeof input.magazine !== 'string' || !input.magazine.trim()) return ctx.badRequest('Απαιτείται περιοδικό.');
        const magazine = await strapi.db.query('api::magazine.magazine').findOne({ where: { documentId: input.magazine }, populate: ['publisher'] });
        if (!magazine) return ctx.badRequest('Δεν βρέθηκε περιοδικό.');
        Object.assign(data, pickFields({
          issueNumber: input.issueNumber === undefined || input.issueNumber === null ? null : String(input.issueNumber),
          publicationMonthYear: input.publicationMonthYear,
        }, LOCAL_FIELDS.issue));
        if (!data.issueNumber && !data.publicationMonthYear) return ctx.badRequest('Συμπληρώστε αριθμό ή περίοδο τεύχους.');
        data.title = magazine.title; // an issue's title is always its magazine's title
        data.magazine = magazine.id;
        if (input.publisher === undefined || input.publisher === null) input.publisher = magazine.publisher?.documentId ?? null;
      }
      if (!data.title) return ctx.badRequest('Απαιτείται τίτλος.');

      const contributors = Array.isArray(input.contributors) ? input.contributors : [];
      for (const c of contributors) {
        if (!c || c.person === undefined || c.person === null || c.role === undefined || c.role === null) {
          return ctx.badRequest('Κάθε συντελεστής χρειάζεται πρόσωπο και ρόλο.');
        }
      }
      const subjects = Array.isArray(input.subjects) ? input.subjects : [];
      const publisher = input.publisher ?? null;

      const personIds = await resolveDocumentIds('api::person.person', contributors.map((c) => c.person), 'πρόσωπο');
      const roleIds = await resolveDocumentIds('api::contributor-role.contributor-role', contributors.map((c) => c.role), 'ρόλος');

      data.type = input.type;
      data.publisher = publisher === null ? null : (await resolveDocumentIds('api::publisher.publisher', [publisher], 'εκδότης'))[0];
      data.subjects = await resolveDocumentIds('api::subject.subject', subjects, 'θέμα');
      data.contributors = contributors.map((c, i) => ({ person: personIds[i], role: roleIds[i] }));
    } catch (err) {
      if (err instanceof LocalInputError) return ctx.badRequest(err.message);
      throw err;
    }

    if (input.type === 'Βιβλίο') {
      const isbn = normalizeIsbn(input.isbn);
      if (!isbn) return ctx.badRequest(`Μη έγκυρο ISBN: ${input.isbn ?? ''}`);

      const importer = strapi.service('api::book.isbn-import');
      const existing = await importer.findByIsbn(isbn);
      if (existing) {
        ctx.status = 409;
        ctx.body = {
          data: null,
          error: { status: 409, name: 'DuplicateRecordError', message: 'Το ISBN υπάρχει ήδη στον κατάλογο.' },
          candidates: [(await this.transformResponse(await this.sanitizeOutput(existing, ctx))).data],
        };
        return;
      }

      try {
        const result = await importer.importFromBiblionet(isbn);
        if (result.source !== 'not-found') return respondWithBook(this, ctx, result.source, result.book);
      } catch (err) {
        return handleImportError(ctx, err);
      }
      data.isbn = isbn;
    }

    return createLocalRecord(ctx, this, 'api::book.book', data, BOOK_POPULATE);
  },
}));
