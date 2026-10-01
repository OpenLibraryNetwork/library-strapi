'use strict';

/**
 * The tests' former entityService calls (numeric ids), implemented with the Strapi 5 Document Service.
 * Writes go through strapi.documents(), so db lifecycles and document middlewares run as in production.
 */

async function documentIdOf(uid, id) {
  const row = await strapi.db.query(uid).findOne({ where: { id }, select: ['documentId'] });
  return row ? row.documentId : null;
}

module.exports = {
  create: (uid, { data, populate } = {}) => strapi.documents(uid).create({ data, populate }),

  async findOne(uid, id, { populate } = {}) {
    const documentId = await documentIdOf(uid, id);
    return documentId ? strapi.documents(uid).findOne({ documentId, populate }) : null;
  },

  findMany: (uid, opts = {}) => strapi.documents(uid).findMany(opts),

  async update(uid, id, { data, populate } = {}) {
    const documentId = await documentIdOf(uid, id);
    if (!documentId) throw new Error(`${uid} ${id} not found`);
    return strapi.documents(uid).update({ documentId, data, populate });
  },

  async delete(uid, id) {
    const documentId = await documentIdOf(uid, id);
    if (!documentId) throw new Error(`${uid} ${id} not found`);
    return strapi.documents(uid).delete({ documentId });
  },

  count: (uid, { filters } = {}) => strapi.documents(uid).count({ filters }),
};
