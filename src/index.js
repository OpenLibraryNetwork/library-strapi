'use strict';

const { seedContributorRoles, seedCataloguerRole } = require('./bootstrap/seed');
const { registerCatalogMiddleware } = require('./bootstrap/catalog-middleware');
const { syncPermissions, ensureApiTokens } = require('./bootstrap/permissions');
const { closePublicRegistration } = require('./bootstrap/registration');

module.exports = {
  register({ strapi }) {
    registerCatalogMiddleware(strapi);
    const userSchema = strapi.contentType('plugin::users-permissions.user');
    if (userSchema) {
      userSchema.attributes.library = {
        type: 'relation',
        relation: 'manyToOne',
        target: 'api::library.library',
      };
    }
  },

  async bootstrap({ strapi }) {
    await seedContributorRoles(strapi);
    await seedCataloguerRole(strapi);
    await closePublicRegistration(strapi);
    await syncPermissions(strapi);
    await ensureApiTokens(strapi);
  },
};
