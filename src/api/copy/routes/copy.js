'use strict';

/**
 * copy router
 *
 * update/delete are restricted to the copy's own library. find/findOne stay
 * unscoped on purpose: cross-library availability is public catalogue data.
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::copy.copy', {
  config: {
    update: { policies: ['global::is-library-owner'] },
    delete: { policies: ['global::is-library-owner'] },
  },
});
