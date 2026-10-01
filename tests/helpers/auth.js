'use strict';

let counter = 0;

async function createLibrarian(strapi, { libraryName = 'Βιβλιοθήκη Δοκιμών' } = {}) {
  counter += 1;
  const library = await strapi.entityService.create('api::library.library', {
    data: { name: `${libraryName} ${counter}` },
  });
  const role = await strapi.db.query('plugin::users-permissions.role').findOne({ where: { type: 'librarian' } });
  const username = `librarian${counter}_${Date.now()}`;
  const user = await strapi.plugin('users-permissions').service('user').add({
    username,
    email: `${username}@test.local`,
    password: 'Test1234!',
    provider: 'local',
    confirmed: true,
    blocked: false,
    role: role.id,
    library: library.id,
  });
  const jwt = strapi.plugin('users-permissions').service('jwt').issue({ id: user.id });
  return { library, user, jwt };
}

module.exports = { createLibrarian };
