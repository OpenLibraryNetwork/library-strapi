'use strict';

/**
 * Global policy: is-library-owner
 *
 * The authenticated user's library must own the requested Copy.
 * Applied to PUT/DELETE /api/copies/:id (in Strapi 5 the :id is the documentId) and to the custom
 * borrow/return routes, which check ownership themselves (no :id param).
 * Create requests have no :id either — the Copy beforeCreate lifecycle forces the user's library.
 */

const { getUserLibrary } = require('../utils/library');

module.exports = async (policyContext, config, { strapi }) => {
  const library = await getUserLibrary(strapi, policyContext.state.user);
  if (!library) return false;
  const documentId = policyContext.params?.id;
  if (!documentId) return true;
  const copy = await strapi.db.query('api::copy.copy').findOne({ where: { documentId }, populate: ['library'] });
  return Boolean(copy) && copy.library?.id === library.id;
};
