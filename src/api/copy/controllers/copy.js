'use strict';

/**
 * copy controller
 * Extends default CRUD with atomic borrow/return endpoints.
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::copy.copy', ({ strapi }) => ({
  /**
   * POST /api/copies/borrow
   * Body: { copyId: number }
   *
   * Atomically marks a copy as unavailable.
   * Uses raw SQL to prevent double-borrow race conditions.
   */
  async borrowCopy(ctx) {
    const { copyId } = ctx.request.body;

    if (!copyId) {
      return ctx.badRequest('copyId is required');
    }

    // 1. Get authenticated user's library
    const user = ctx.state.user;
    if (!user) {
      return ctx.forbidden('User not authenticated');
    }
    let libraryId = user.library?.id || user.library;
    if (!libraryId) {
      const fullUser = await strapi.entityService.findOne(
        'plugin::users-permissions.user',
        user.id,
        { populate: ['library'] }
      );
      libraryId = fullUser?.library?.id;
    }
    if (!libraryId) {
      return ctx.forbidden('User has no assigned library');
    }

    // 2. Verify copy exists and belongs to user's library (tenant isolation)
    const copy = await strapi.entityService.findOne('api::copy.copy', copyId, {
      populate: ['library'],
    });

    if (!copy) {
      return ctx.notFound('Copy not found');
    }

    const copyLibraryId = copy.library?.id || copy.library;
    if (copyLibraryId !== libraryId) {
      return ctx.forbidden('Cannot borrow from another library');
    }

    // 3. Atomic SQL update (prevents double-borrow)
    // Uses UPDATE ... WHERE is_available = true to ensure atomicity
    const knex = strapi.db.connection;
    const result = await knex('copies')
      .where({ id: copyId, is_available: true })
      .update({ is_available: false })
      .returning('*');

    if (!result || result.length === 0) {
      return ctx.conflict('Copy is already borrowed or does not exist');
    }

    return ctx.send({
      data: result[0],
      message: 'Copy borrowed successfully',
    });
  },

  /**
   * POST /api/copies/return
   * Body: { copyId: number }
   *
   * Atomically marks a copy as available.
   */
  async returnCopy(ctx) {
    const { copyId } = ctx.request.body;

    if (!copyId) {
      return ctx.badRequest('copyId is required');
    }

    // 1. Get authenticated user's library
    const user = ctx.state.user;
    if (!user) {
      return ctx.forbidden('User not authenticated');
    }
    let libraryId = user.library?.id || user.library;
    if (!libraryId) {
      const fullUser = await strapi.entityService.findOne(
        'plugin::users-permissions.user',
        user.id,
        { populate: ['library'] }
      );
      libraryId = fullUser?.library?.id;
    }
    if (!libraryId) {
      return ctx.forbidden('User has no assigned library');
    }

    // 2. Verify copy exists and belongs to user's library (tenant isolation)
    const copy = await strapi.entityService.findOne('api::copy.copy', copyId, {
      populate: ['library'],
    });

    if (!copy) {
      return ctx.notFound('Copy not found');
    }

    const copyLibraryId = copy.library?.id || copy.library;
    if (copyLibraryId !== libraryId) {
      return ctx.forbidden('Cannot return to another library');
    }

    // 3. Atomic SQL update
    const knex = strapi.db.connection;
    const result = await knex('copies')
      .where({ id: copyId, is_available: false })
      .update({ is_available: true })
      .returning('*');

    if (!result || result.length === 0) {
      return ctx.conflict('Copy is already available or does not exist');
    }

    return ctx.send({
      data: result[0],
      message: 'Copy returned successfully',
    });
  },
}));
