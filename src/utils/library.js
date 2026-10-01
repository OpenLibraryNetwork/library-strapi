'use strict';

async function getUserLibraryId(strapi, user) {
  if (!user) return null;
  const direct = user.library?.id ?? user.library;
  if (direct) return direct;
  const full = await strapi.entityService.findOne('plugin::users-permissions.user', user.id, { populate: ['library'] });
  return full?.library?.id ?? null;
}

module.exports = { getUserLibraryId };
