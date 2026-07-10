'use strict';

module.exports = (plugin) => {
  // Extend the auth callback to populate library relation in response
  const originalCallback = plugin.controllers.auth.callback;

  plugin.controllers.auth.callback = async (ctx) => {
    await originalCallback(ctx);

    // After successful login, enrich user data with library
    if (ctx.body && ctx.body.user) {
      const fullUser = await strapi.entityService.findOne(
        'plugin::users-permissions.user',
        ctx.body.user.id,
        { populate: ['library'] }
      );
      if (fullUser && fullUser.library) {
        ctx.body.user.library = fullUser.library;
      }
    }
  };

  return plugin;
};
