'use strict';

const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');
const { createLibrarian } = require('../helpers/auth');

const LIBRARY = 'api::library.library';
let librarian;

beforeAll(async () => {
  await setupStrapi();
  librarian = await createLibrarian(strapi);
});
afterAll(async () => { await cleanupStrapi(); });

test('a library keeps its optional contact fields', async () => {
  const created = await strapi.documents(LIBRARY).create({
    data: {
      name: 'Βιβλιοθήκη Επαφών',
      address: 'Οδός Παραδείγματος 1\n000 00 Πόλη',
      email: 'info@example.org',
      phone: '+30 210 000 0000',
      website: 'https://example.org',
    },
  });
  const res = await request(strapi.server.httpServer)
    .get(`/api/libraries/${created.documentId}`)
    .set('Authorization', `Bearer ${librarian.jwt}`);
  expect(res.status).toBe(200);
  expect(res.body.data).toMatchObject({
    address: 'Οδός Παραδείγματος 1\n000 00 Πόλη',
    email: 'info@example.org',
    phone: '+30 210 000 0000',
    website: 'https://example.org',
  });
});

test('every contact field is optional', async () => {
  const created = await strapi.documents(LIBRARY).create({ data: { name: 'Χωρίς Επαφές' } });
  expect(created).toMatchObject({ address: null, email: null, phone: null, website: null });
});

test('an invalid email is rejected', async () => {
  await expect(strapi.documents(LIBRARY).create({ data: { name: 'Λάθος Email', email: 'όχι-email' } })).rejects.toThrow();
});
