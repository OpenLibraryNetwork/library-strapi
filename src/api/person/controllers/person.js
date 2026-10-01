'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { searchAction } = require('../../../utils/catalog-search');
const { libraryListAction, authorsOf } = require('../../../utils/library-catalog');
const { LOCAL_FIELDS, LocalInputError, pickFields, createLocalRecord } = require('../../../utils/local-catalog');

module.exports = createCoreController('api::person.person', () => ({
  search: searchAction('api::person.person'),

  /**
   * GET /api/persons/authors?q=&page=&pageSize=
   * Persons with the author role in books that have a copy in the user's library.
   */
  authors: libraryListAction(authorsOf),

  /**
   * POST /api/persons/local  { data: { name?, qualifier?, firstname?, middlename?, lastname?, ... } }
   */
  async createLocal(ctx) {
    const input = ctx.request.body?.data;
    if (!input || typeof input !== 'object') return ctx.badRequest('Λείπει το σώμα { data }.');
    try {
      const data = pickFields(input, LOCAL_FIELDS.person);
      if (!data.name) {
        data.name = [data.firstname, data.middlename, data.lastname].filter(Boolean).join(' ');
      }
      if (!data.name) return ctx.badRequest('Απαιτείται όνομα.');
      return createLocalRecord(ctx, this, 'api::person.person', data);
    } catch (err) {
      if (err instanceof LocalInputError) return ctx.badRequest(err.message);
      throw err;
    }
  },
}));
