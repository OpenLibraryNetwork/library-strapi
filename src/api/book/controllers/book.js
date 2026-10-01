'use strict';

/**
 * book controller
 * Librarians never write books through the generic CRUD actions:
 * - isbnLookup: catalog → Biblionet import
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
const { normalizeIsbn } = require('../../../utils/isbn');
const {
  LOCAL_FIELDS,
  LocalInputError,
  pickFields,
  assertRelationsExist,
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
  const data = book ? controller.transformResponse(await controller.sanitizeOutput(book, ctx)).data : null;
  ctx.status = status;
  ctx.body = { source, data, quota: quota.getUsage() };
}

module.exports = createCoreController('api::book.book', ({ strapi }) => ({
  /**
   * GET /api/books/search?q=&type=
   */
  search: searchAction('api::book.book', { populate: BOOK_POPULATE, allowType: true }),

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
   * { data: { type: 'Βιβλίο'|'Μπροσούρα', title, isbn?, publisher?, contributors?: [{ person, role }], subjects?: [id], ... } }
   */
  async createLocal(ctx) {
    const input = ctx.request.body?.data;
    if (!input || typeof input !== 'object') return ctx.badRequest('Λείπει το σώμα { data }.');
    if (!LOCAL_TYPES.includes(input.type)) return ctx.badRequest('Ο τύπος πρέπει να είναι «Βιβλίο», «Μπροσούρα» ή «Περιοδικό».');

    let data;
    try {
      data = pickFields(input, LOCAL_FIELDS.book);
      if (input.type === 'Περιοδικό') {
        if (!Number.isInteger(input.magazine)) return ctx.badRequest('Απαιτείται περιοδικό.');
        const magazine = await strapi.entityService.findOne('api::magazine.magazine', input.magazine, { populate: ['publisher'] });
        if (!magazine) return ctx.badRequest('Δεν βρέθηκε περιοδικό.');
        Object.assign(data, pickFields({
          issueNumber: input.issueNumber === undefined || input.issueNumber === null ? null : String(input.issueNumber),
          publicationMonthYear: input.publicationMonthYear,
        }, LOCAL_FIELDS.issue));
        if (!data.issueNumber && !data.publicationMonthYear) return ctx.badRequest('Συμπληρώστε αριθμό ή περίοδο τεύχους.');
        data.title = magazine.title; // an issue's title is always its magazine's title
        data.magazine = magazine.id;
        if (input.publisher === undefined || input.publisher === null) input.publisher = magazine.publisher?.id ?? null;
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

      await assertRelationsExist('api::person.person', contributors.map((c) => c.person), 'πρόσωπο');
      await assertRelationsExist('api::contributor-role.contributor-role', contributors.map((c) => c.role), 'ρόλος');
      await assertRelationsExist('api::subject.subject', subjects, 'θέμα');
      if (publisher !== null) await assertRelationsExist('api::publisher.publisher', [publisher], 'εκδότης');

      data.type = input.type;
      data.publisher = publisher;
      data.subjects = subjects;
      data.contributors = contributors.map((c) => ({ person: c.person, role: c.role }));
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
          candidates: [this.transformResponse(await this.sanitizeOutput(existing, ctx)).data],
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
