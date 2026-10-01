'use strict';

const { assertContributorsComplete } = require('../utils/catalog-lifecycle');

/**
 * Document Service middleware for the catalog. The database lifecycles hold the rules; this one check needs the raw
 * payload: components are created before the lifecycles run, which then only see component ids.
 */
function registerCatalogMiddleware(strapi) {
  strapi.documents.use(async (context, next) => {
    if (context.uid === 'api::book.book' && (context.action === 'create' || context.action === 'update')) {
      assertContributorsComplete(context.params?.data?.contributors);
    }
    return next();
  });
}

module.exports = { registerCatalogMiddleware };
