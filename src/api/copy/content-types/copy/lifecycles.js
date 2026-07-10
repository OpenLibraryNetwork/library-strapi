'use strict';

/**
 * Copy (Αντίτυπα) lifecycle hooks
 *
 * 1. beforeCreate: Force library from authenticated user (tenant isolation)
 * 2. beforeUpdate: Block isAvailable changes via standard REST + prevent library reassignment
 */

module.exports = {
  async beforeCreate(event) {
    // TENANT ISOLATION: Force library from authenticated user
    // Ignores whatever library ID the client sends
    const ctx = strapi.requestContext.get();
    const user = ctx?.state?.user;

    if (user) {
      let libraryId = user.library?.id || user.library;
      if (!libraryId) {
        const fullUser = await strapi.entityService.findOne(
          'plugin::users-permissions.user',
          user.id,
          { populate: ['library'] }
        );
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
      const existingCopy = await strapi.entityService.findOne(
        'api::copy.copy',
        where.id
      );

      if (existingCopy && data.isAvailable !== existingCopy.isAvailable) {
        throw new Error(
          'isAvailable cannot be changed directly. Use POST /api/copies/borrow or POST /api/copies/return'
        );
      }
    }

    // TENANT ISOLATION: Prevent changing library on existing copies
    if (data.library !== undefined) {
      throw new Error('Cannot change library assignment of an existing copy');
    }
  },
};
