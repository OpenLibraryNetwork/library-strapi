'use strict';

let counter = 0;

// A custom content-API token with exactly these actions; returns its plaintext key (Authorization: Bearer).
async function createApiToken(strapi, permissions) {
  counter += 1;
  const token = await strapi.service('admin::api-token').create({
    name: `test-token-${counter}-${Date.now()}`,
    lifespan: null,
    type: 'custom',
    permissions,
  });
  return token.accessKey;
}

// The bootstrap "frontend" token gets a fresh key so a test can call the API with it (test database only).
async function frontendTokenKey(strapi) {
  const service = strapi.service('admin::api-token');
  const token = await service.getByName('frontend');
  return (await service.regenerate(token.id)).accessKey;
}

module.exports = { createApiToken, frontendTokenKey };
