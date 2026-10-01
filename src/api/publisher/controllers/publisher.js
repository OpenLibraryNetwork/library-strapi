'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { searchAction } = require('../../../utils/catalog-search');
const { libraryListAction, publisherOf } = require('../../../utils/library-catalog');
const { LOCAL_FIELDS, LocalInputError, pickFields, createLocalRecord } = require('../../../utils/local-catalog');

module.exports = createCoreController('api::publisher.publisher', () => ({
  search: searchAction('api::publisher.publisher'),

  /**
   * GET /api/publishers/in-library?q=&page=&pageSize=
   * Publishers of books that have a copy in the user's library.
   */
  inLibrary: libraryListAction(publisherOf),

  /**
   * POST /api/publishers/local  { data: { name, qualifier?, alternativeName?, address?, phone?, email?, website? } }
   */
  async createLocal(ctx) {
    const input = ctx.request.body?.data;
    if (!input || typeof input !== 'object') return ctx.badRequest('Λείπει το σώμα { data }.');
    try {
      const data = pickFields(input, LOCAL_FIELDS.publisher);
      if (!data.name) return ctx.badRequest('Απαιτείται όνομα.');
      return createLocalRecord(ctx, this, 'api::publisher.publisher', data);
    } catch (err) {
      if (err instanceof LocalInputError) return ctx.badRequest(err.message);
      throw err;
    }
  },
}));
