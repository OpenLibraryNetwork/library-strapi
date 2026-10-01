'use strict';

/**
 * The JavaFX client restores a saved session at startup by calling GET /api/users/me
 * (AuthService.testConnection) and shows "Offline" unless it gets 200.
 * Runs on a fresh database, where the bootstrap creates the Librarian role itself.
 */

const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');
const { createLibrarian } = require('../helpers/auth');

let jwt;
beforeAll(async () => {
  await setupStrapi();
  ({ jwt } = await createLibrarian(strapi));
});
afterAll(async () => { await cleanupStrapi(); });

test('librarian can read its own user on a fresh database', async () => {
  const res = await request(strapi.server.httpServer).get('/api/users/me').set('Authorization', `Bearer ${jwt}`);
  expect(res.status).toBe(200);
});
