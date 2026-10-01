'use strict';

const { assertContributorsComplete, CATALOG_UIDS } = require('../utils/catalog-lifecycle');

const TRANSACTIONAL_UIDS = new Set(Object.values(CATALOG_UIDS));

/**
 * entityService creates/updates components BEFORE the db lifecycles run, and does not use a
 * transaction. For catalog records we therefore:
 * - validate the raw contributors payload here (lifecycles only see component ids), and
 * - run create/update in a transaction, so a lifecycle rejection (e.g. duplicate) rolls back
 *   the component changes too.
 */
function decorateEntityService(strapi) {
  strapi.entityService.decorate((original) => ({
    async create(uid, opts = {}) {
      if (!TRANSACTIONAL_UIDS.has(uid)) return original.create.call(this, uid, opts);
      if (uid === CATALOG_UIDS.book) assertContributorsComplete(opts.data?.contributors);
      return strapi.db.transaction(() => original.create.call(this, uid, opts));
    },

    async update(uid, id, opts = {}) {
      if (!TRANSACTIONAL_UIDS.has(uid)) return original.update.call(this, uid, id, opts);
      if (uid === CATALOG_UIDS.book) assertContributorsComplete(opts.data?.contributors);
      return strapi.db.transaction(() => original.update.call(this, uid, id, opts));
    },
  }));
}

module.exports = { decorateEntityService };
