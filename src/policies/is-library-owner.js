'use strict';

/**
 * Global policy: is-library-owner
 *
 * Verifies that the authenticated user's library matches the
 * library of the requested Copy resource.
 *
 * Applied to:
 * - Standard REST: PUT /api/copies/:id, DELETE /api/copies/:id
 * - Custom: POST /api/copies/borrow, POST /api/copies/return
 *
 * For CREATE requests (no :id param), returns true — tenant isolation
 * is enforced by the Copy beforeCreate lifecycle hook instead.
 */

module.exports = async (policyContext, config, { strapi }) => {
  const user = policyContext.state.user;

  // Must be authenticated
  if (!user) return false;

  // Fetch user's library if not populated
  let userLibraryId = user.library?.id || user.library;
  if (!userLibraryId) {
    const fullUser = await strapi.entityService.findOne(
      'plugin::users-permissions.user',
      user.id,
      { populate: ['library'] }
    );
    userLibraryId = fullUser?.library?.id;
  }

  if (!userLibraryId) return false;

  const { id } = policyContext.params;

  // Create requests (no id) — lifecycle hook handles tenant isolation
  if (!id) return true;

  // For update/delete, verify ownership
  const copy = await strapi.entityService.findOne('api::copy.copy', id, {
    populate: ['library'],
  });

  if (!copy) return false;

  const copyLibraryId = copy.library?.id || copy.library;

  return copyLibraryId === userLibraryId;
};
