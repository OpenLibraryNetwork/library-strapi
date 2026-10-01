'use strict';

const { errors } = require('@strapi/utils');
const { extractRelationId } = require('../../../../utils/relation-id');
const { isMerging } = require('../../../../utils/merge-context');

/**
 * Copy (Αντίτυπα) lifecycle hooks
 *
 * 1. beforeCreate: Force library from the authenticated librarian (tenant isolation); the admin panel keeps its choice
 * 2. beforeUpdate: Block isAvailable changes via standard REST + prevent library reassignment
 */

// A borrowed copy must be returned before it can be deleted.
async function assertNotBorrowed(event) {
  const where = event.params.where || {};
  const borrowed = await strapi.db.query('api::copy.copy').count({ where: { ...where, isAvailable: false } });
  if (borrowed > 0) {
    throw new errors.ApplicationError('Το αντίτυπο είναι δανεισμένο και δεν μπορεί να διαγραφεί πριν επιστραφεί.');
  }
}

module.exports = {
  async beforeCreate(event) {
    // TENANT ISOLATION: Force library from the authenticated librarian
    // Ignores whatever library ID the client sends. Admin panel users are not librarians: their id
    // must not be looked up among users-permissions users, and the library they chose stays.
    const ctx = strapi.requestContext.get();
    const user = ctx?.state?.auth?.strategy?.name === 'users-permissions' ? ctx.state.user : null;

    if (user) {
      let libraryId = user.library?.id || user.library;
      if (!libraryId) {
        const fullUser = await strapi.db.query('plugin::users-permissions.user').findOne({
          where: { id: user.id },
          populate: ['library'],
        });
        libraryId = fullUser?.library?.id;
      }

      if (libraryId) {
        event.params.data.library = libraryId;
      } else {
        throw new Error('Cannot create copy: user has no assigned library');
      }
    }
  },

  async beforeUpdate(event) {
    const { data, where } = event.params;

    // BLOCK isAvailable changes through standard REST API
    // isAvailable can only change via custom borrow/return controllers
    if (data.isAvailable !== undefined) {
      // Fetch current copy to compare
      const existingCopy = await strapi.db.query('api::copy.copy').findOne({ where: { id: where.id } });

      if (existingCopy && data.isAvailable !== existingCopy.isAvailable) {
        throw new Error(
          'isAvailable cannot be changed directly. Use POST /api/copies/borrow or POST /api/copies/return'
        );
      }
    }

    // TENANT ISOLATION: Prevent changing library on existing copies
    // (the admin panel sends { connect: [], disconnect: [] } on every save, which is no change)
    const libraryChange = extractRelationId(data.library);
    if (libraryChange.changed) {
      const current = await strapi.db.query('api::copy.copy').findOne({ where: { id: where.id }, populate: ['library'] });
      if ((current?.library?.id ?? null) !== libraryChange.id) {
        throw new errors.ApplicationError('Ένα αντίτυπο δεν μπορεί να αλλάξει βιβλιοθήκη.');
      }
    }

    // CATALOG INTEGRITY: a copy never changes publication (except inside a cataloguer merge)
    const publicationChange = extractRelationId(data.publication);
    if (publicationChange.changed && !isMerging()) {
      const current = await strapi.db.query('api::copy.copy').findOne({ where: { id: where.id }, populate: ['publication'] });
      if ((current?.publication?.id ?? null) !== publicationChange.id) {
        throw new errors.ApplicationError('Ένα αντίτυπο δεν μπορεί να αλλάξει έντυπο.');
      }
    }
  },

  async beforeDelete(event) {
    await assertNotBorrowed(event);
  },

  async beforeDeleteMany(event) {
    await assertNotBorrowed(event);
  }
};
