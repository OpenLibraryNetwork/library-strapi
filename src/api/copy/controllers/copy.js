'use strict';

/**
 * copy controller
 * Extends default CRUD with atomic borrow/return endpoints.
 */

const { createCoreController } = require('@strapi/strapi').factories;
const { getUserLibrary } = require('../../../utils/library');

module.exports = createCoreController('api::copy.copy', ({ strapi }) => {
  /**
   * Atomically flips isAvailable (borrow: true → false, return: false → true) on a copy of the user's library.
   * The conditional UPDATE lets only one of two simultaneous requests succeed.
   */
  async function flip(ctx, available) {
    const { documentId } = ctx.request.body || {};
    if (!documentId) return ctx.badRequest('documentId is required');

    const library = await getUserLibrary(strapi, ctx.state.user);
    if (!library) return ctx.forbidden('User has no assigned library');

    const copy = await strapi.db.query('api::copy.copy').findOne({ where: { documentId }, populate: ['library'] });
    if (!copy) return ctx.notFound('Copy not found');
    if (copy.library?.id !== library.id) {
      return ctx.forbidden(available ? 'Cannot borrow from another library' : 'Cannot return to another library');
    }

    const changed = await strapi.db.connection('copies')
      .where({ document_id: documentId, is_available: available })
      .update({ is_available: !available });
    if (changed === 0) return ctx.conflict(available ? 'Copy is already borrowed' : 'Copy is not borrowed');

    const updated = await strapi.db.query('api::copy.copy').findOne({ where: { documentId } });
    return ctx.send({ data: updated, message: available ? 'Copy borrowed successfully' : 'Copy returned successfully' });
  }

  return {
    /** POST /api/copies/borrow  { documentId } */
    async borrowCopy(ctx) {
      return flip(ctx, true);
    },

    /** POST /api/copies/return  { documentId } */
    async returnCopy(ctx) {
      return flip(ctx, false);
    },
  };
});
