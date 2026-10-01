'use strict';

/**
 * magazine controller
 * Librarians never write magazines through the generic CRUD actions:
 * - issnLookup: catalog → National Library import
 * - createLocal: local magazine (409 with candidates on a duplicate or a known ISSN)
 * - search: whole network; inLibrary: magazines with an issue that has a copy in the user's library
 */

const { createCoreController } = require('@strapi/strapi').factories;
const { parseIssnCode, normalizeIssn } = require('../../../utils/issn');
const { buildSearchFilters, MAX_RESULTS } = require('../../../utils/catalog-search');
const { libraryListAction, magazineOf, issueCountsInLibrary } = require('../../../utils/library-catalog');
const { getUserLibraryId } = require('../../../utils/library');
const { LOCAL_FIELDS, LocalInputError, pickFields, assertRelationsExist, createLocalRecord } = require('../../../utils/local-catalog');

const UID = 'api::magazine.magazine';
const POPULATE = { publisher: true };

module.exports = createCoreController('api::magazine.magazine', ({ strapi }) => ({
  /**
   * POST /api/magazines/issn-lookup  { code }  (ISSN or serial EAN-13, with or without add-on)
   */
  async issnLookup(ctx) {
    const code = ctx.request.body?.code;
    const issn = parseIssnCode(code);
    if (!issn) return ctx.badRequest(`Μη έγκυρο ISSN ή barcode περιοδικού: ${code ?? ''}`);
    const { source, magazine } = await strapi.service('api::magazine.nlg-import').lookup(issn);
    const data = magazine ? this.transformResponse(await this.sanitizeOutput(magazine, ctx)).data : null;
    ctx.body = { source, issn, data };
  },

  /**
   * POST /api/magazines/local  { data: { title, qualifier?, issn?, publisher?, place?, periodicity? } }
   */
  async createLocal(ctx) {
    const input = ctx.request.body?.data;
    if (!input || typeof input !== 'object') return ctx.badRequest('Λείπει το σώμα { data }.');
    let data;
    try {
      data = pickFields(input, LOCAL_FIELDS.magazine);
      if (!data.title) return ctx.badRequest('Απαιτείται τίτλος.');
      if (data.issn) {
        const issn = normalizeIssn(data.issn);
        if (!issn) return ctx.badRequest(`Μη έγκυρο ISSN: ${data.issn}`);
        data.issn = issn;
        const existing = await strapi.service('api::magazine.nlg-import').findByIssn(issn);
        if (existing) {
          ctx.status = 409;
          ctx.body = {
            data: null,
            error: { status: 409, name: 'DuplicateRecordError', message: 'Το ISSN υπάρχει ήδη στον κατάλογο.' },
            candidates: [this.transformResponse(await this.sanitizeOutput(existing, ctx)).data],
          };
          return;
        }
      }
      const publisher = input.publisher ?? null;
      if (publisher !== null) await assertRelationsExist('api::publisher.publisher', [publisher], 'εκδότης');
      data.publisher = publisher;
    } catch (err) {
      if (err instanceof LocalInputError) return ctx.badRequest(err.message);
      throw err;
    }
    return createLocalRecord(ctx, this, UID, data, POPULATE, {
      findConflict: () => (data.issn ? strapi.service('api::magazine.nlg-import').findByIssn(data.issn) : null),
    });
  },

  /**
   * GET /api/magazines/search?q=  — whole network; issuesInLibrary for a user with a library.
   */
  async search(ctx) {
    const filters = buildSearchFilters(ctx.query.q);
    if (!filters) return ctx.badRequest('Η αναζήτηση χρειάζεται τουλάχιστον 2 χαρακτήρες.');
    const results = await strapi.entityService.findMany(UID, { filters, populate: POPULATE, sort: { id: 'asc' }, limit: MAX_RESULTS });
    const body = this.transformResponse(await this.sanitizeOutput(results, ctx));
    const libraryId = await getUserLibraryId(strapi, ctx.state.user);
    if (libraryId) {
      const counts = await issueCountsInLibrary(strapi, libraryId);
      body.data.forEach((item) => { item.attributes.issuesInLibrary = counts.get(item.id) ?? 0; });
    }
    return body;
  },

  /**
   * GET /api/magazines/in-library?q=&page=&pageSize=  — magazines with an issue that has a copy here.
   */
  inLibrary: libraryListAction(magazineOf, 'issuesInLibrary'),
}));
