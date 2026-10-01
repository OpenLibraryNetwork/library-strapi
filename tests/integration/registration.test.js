'use strict';

const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');
const { createLibrarian } = require('../helpers/auth');

beforeAll(async () => { await setupStrapi(); });
afterAll(async () => { await cleanupStrapi(); });

const http = () => request(strapi.server.httpServer);

test('public registration is closed (a stranger cannot attach himself to a library)', async () => {
  const lib = await strapi.documents('api::library.library').create({ data: { name: 'Στόχος Εγγραφής' } });
  const res = await http().post('/api/auth/local/register')
    .send({ username: 'stranger', email: 'stranger@test.local', password: 'Stranger123!', library: lib.id });
  expect(res.status).toBe(400);
  expect(await strapi.db.query('plugin::users-permissions.user').count({ where: { username: 'stranger' } })).toBe(0);
});

test('public registration is closed even without extra fields', async () => {
  const res = await http().post('/api/auth/local/register')
    .send({ username: 'stranger2', email: 'stranger2@test.local', password: 'Stranger123!' });
  expect(res.status).toBe(400);
  expect(await strapi.db.query('plugin::users-permissions.user').count({ where: { username: 'stranger2' } })).toBe(0);
});

test('login returns the role type and the library documentId (Review Focus 3)', async () => {
  const { user, library } = await createLibrarian(strapi);
  const res = await http().post('/api/auth/local').send({ identifier: user.email, password: 'Test1234!' });
  expect(res.status).toBe(200);
  expect(res.body.user.role.type).toBe('librarian');
  expect(res.body.user.library.documentId).toBe(library.documentId);
});
