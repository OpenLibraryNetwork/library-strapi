'use strict';

module.exports = (plugin) => {
  // The auth controller is a factory ({ strapi }) => ({ callback, ... }); wrap the controller it builds
  // so the login response carries the role type and the library documentId the client needs.
  const authFactory = plugin.controllers.auth;

  plugin.controllers.auth = ({ strapi }) => {
    const controller = authFactory({ strapi });
    const originalCallback = controller.callback;

    controller.callback = async (ctx) => {
      await originalCallback(ctx);

      if (ctx.body && ctx.body.user) {
        const full = await strapi.db.query('plugin::users-permissions.user').findOne({
          where: { id: ctx.body.user.id },
          populate: ['library', 'role'],
        });
        if (full?.library) ctx.body.user.library = { id: full.library.id, documentId: full.library.documentId, name: full.library.name };
        if (full?.role) ctx.body.user.role = { type: full.role.type };
      }
    };

    return controller;
  };

  return plugin;
};
