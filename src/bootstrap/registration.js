'use strict';

/** Librarians are created by an administrator; the public register endpoint stays closed. */
async function closePublicRegistration(strapi) {
  const store = strapi.store({ type: 'plugin', name: 'users-permissions', key: 'advanced' });
  const advanced = (await store.get()) || {};
  if (advanced.allow_register !== false) await store.set({ value: { ...advanced, allow_register: false } });
}

module.exports = { closePublicRegistration };
