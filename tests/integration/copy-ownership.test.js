'use strict';

const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');
const { createLibrarian } = require('../helpers/auth');

const COPY = 'api::copy.copy';

let a;
let b;
let bookId;

beforeAll(async () => {
  await setupStrapi();
  a = await createLibrarian(strapi, { libraryName: 'Βιβλιοθήκη Α' });
  b = await createLibrarian(strapi, { libraryName: 'Βιβλιοθήκη Β' });
  bookId = (await strapi.entityService.create('api::book.book', { data: { title: 'Κοινό έντυπο', type: 'Μπροσούρα' } })).id;
});
afterAll(async () => { await cleanupStrapi(); });

const http = () => request(strapi.server.httpServer);
const as = (who, req) => req.set('Authorization', `Bearer ${who.jwt}`);
const createCopy = (library) =>
  strapi.entityService.create(COPY, { data: { copyNumber: 1, publication: bookId, library: library.id } });

test('librarian gets 403 updating a copy of another library', async () => {
  const copy = await createCopy(b.library);
  const res = await as(a, http().put(`/api/copies/${copy.id}`)).send({ data: { condition: 'POOR' } });
  expect(res.status).toBe(403);
  expect((await strapi.entityService.findOne(COPY, copy.id)).condition).toBe('NEW');
});

test('librarian gets 403 deleting a copy of another library', async () => {
  const copy = await createCopy(b.library);
  const res = await as(a, http().delete(`/api/copies/${copy.id}`));
  expect(res.status).toBe(403);
  expect(await strapi.entityService.findOne(COPY, copy.id)).not.toBeNull();
});

test('librarian can update a copy of their own library', async () => {
  const copy = await createCopy(a.library);
  const res = await as(a, http().put(`/api/copies/${copy.id}`)).send({ data: { condition: 'POOR' } });
  expect(res.status).toBe(200);
  expect((await strapi.entityService.findOne(COPY, copy.id)).condition).toBe('POOR');
});

test('librarian can delete a copy of their own library', async () => {
  const copy = await createCopy(a.library);
  const res = await as(a, http().delete(`/api/copies/${copy.id}`));
  expect(res.status).toBe(200);
  expect(await strapi.entityService.findOne(COPY, copy.id)).toBeNull();
});

test('librarian can still read copies of other libraries (cross-library availability)', async () => {
  const copy = await createCopy(b.library);
  expect((await as(a, http().get(`/api/copies/${copy.id}`))).status).toBe(200);
  expect((await as(a, http().get('/api/copies'))).status).toBe(200);
});
