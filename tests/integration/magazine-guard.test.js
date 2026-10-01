'use strict';

const docs = require('../helpers/docs');
const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');
const { createLibrarian } = require('../helpers/auth');

let jwt;
beforeAll(async () => {
  await setupStrapi();
  ({ jwt } = await createLibrarian(strapi));
});
afterAll(async () => { await cleanupStrapi(); });

test('librarian cannot use the generic magazine create (2γ: only /magazines/local)', async () => {
  const res = await request(strapi.server.httpServer)
    .post('/api/magazines')
    .set('Authorization', `Bearer ${jwt}`)
    .send({ data: { title: 'Περιοδικό Κατάληψης' } });
  expect(res.status).toBe(403);
});

test('issues are never attached from the magazine side, even by the admin', async () => {
  const book = await docs.create('api::book.book', { data: { title: 'Ξένο βιβλίο', type: 'Βιβλίο', isbn: '9780306406157' } });
  await expect(
    docs.create('api::magazine.magazine', { data: { title: 'Περιοδικό Φρουρός', issues: [book.id] } })
  ).rejects.toThrow('τεύχους');
  const after = await docs.findOne('api::book.book', book.id, { populate: ['magazine'] });
  expect(after.magazine).toBeNull();
});
