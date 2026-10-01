'use strict';

const { tokenize } = require('./text-keys');

const MAX_RESULTS = 20;

function buildSearchFilters(q) {
  const tokens = tokenize(q);
  if (tokens.join('').length < 2) return null;
  return { $and: tokens.map((token) => ({ searchKey: { $contains: token } })) };
}

/**
 * Controller action factory: GET /api/<collection>/search?q=
 * Filters on the private searchKey server-side (REST filters cannot reach private fields).
 */
function searchAction(uid, { populate = {}, allowType = false } = {}) {
  return async function search(ctx) {
    const filters = buildSearchFilters(ctx.query.q);
    if (!filters) return ctx.badRequest('Η αναζήτηση χρειάζεται τουλάχιστον 2 χαρακτήρες.');
    if (allowType && ctx.query.type) filters.type = ctx.query.type;

    const results = await strapi.documents(uid).findMany({
      filters,
      populate,
      sort: { createdAt: 'asc' }, // Strapi 5: id order is not creation order
      limit: MAX_RESULTS,
    });
    return this.transformResponse(await this.sanitizeOutput(results, ctx));
  };
}

module.exports = { MAX_RESULTS, buildSearchFilters, searchAction };
