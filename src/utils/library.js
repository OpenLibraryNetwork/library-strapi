'use strict';

async function getUserLibrary(strapi, user) {
  if (!user) return null;
  const full = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { id: user.id }, populate: ['library'] });
  return full?.library ? { id: full.library.id, documentId: full.library.documentId } : null;
}

async function getUserLibraryId(strapi, user) {
  return (await getUserLibrary(strapi, user))?.id ?? null;
}

module.exports = { getUserLibrary, getUserLibraryId };
