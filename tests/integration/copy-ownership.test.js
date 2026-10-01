'use strict';

const docs = require('../helpers/docs');
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
  bookId = (await docs.create('api::book.book', { data: { title: 'Κοινό έντυπο', type: 'Μπροσούρα' } })).id;
});
afterAll(async () => { await cleanupStrapi(); });

const http = () => request(strapi.server.httpServer);
const as = (who, req) => req.set('Authorization', `Bearer ${who.jwt}`);
const createCopy = (library) =>
  docs.create(COPY, { data: { copyNumber: 1, publication: bookId, library: library.id } });

test('librarian gets 403 updating a copy of another library', async () => {
  const copy = await createCopy(b.library);
  const res = await as(a, http().put(`/api/copies/${copy.documentId}`)).send({ data: { condition: 'POOR' } });
  expect(res.status).toBe(403);
  expect((await docs.findOne(COPY, copy.id)).condition).toBe('NEW');
});

test('librarian gets 403 deleting a copy of another library', async () => {
  const copy = await createCopy(b.library);
  const res = await as(a, http().delete(`/api/copies/${copy.documentId}`));
  expect(res.status).toBe(403);
  expect(await docs.findOne(COPY, copy.id)).not.toBeNull();
});

test('librarian can update a copy of their own library', async () => {
  const copy = await createCopy(a.library);
  const res = await as(a, http().put(`/api/copies/${copy.documentId}`)).send({ data: { condition: 'POOR' } });
  expect(res.status).toBe(200);
  expect((await docs.findOne(COPY, copy.id)).condition).toBe('POOR');
});

test('librarian can delete a copy of their own library', async () => {
  const copy = await createCopy(a.library);
  const res = await as(a, http().delete(`/api/copies/${copy.documentId}`));
  expect(res.status).toBe(204); // Strapi 5: delete answers 204 No Content
  expect(await docs.findOne(COPY, copy.id)).toBeNull();
});

test('librarian can still read copies of other libraries (cross-library availability)', async () => {
  const copy = await createCopy(b.library);
  expect((await as(a, http().get(`/api/copies/${copy.documentId}`))).status).toBe(200);
  expect((await as(a, http().get('/api/copies'))).status).toBe(200);
});

const borrow = (who, copy) => as(who, http().post('/api/copies/borrow')).send({ documentId: copy.documentId });
const giveBack = (who, copy) => as(who, http().post('/api/copies/return')).send({ documentId: copy.documentId });

test('borrow and return by documentId', async () => {
  const copy = await createCopy(a.library);
  const lent = await borrow(a, copy);
  expect(lent.status).toBe(200);
  expect(lent.body.data.isAvailable).toBe(false);
  expect((await borrow(a, copy)).status).toBe(409);
  const back = await giveBack(a, copy);
  expect(back.status).toBe(200);
  expect(back.body.data.isAvailable).toBe(true);
  expect((await giveBack(a, copy)).status).toBe(409);
});

test('cannot borrow a copy of another library', async () => {
  const copy = await createCopy(b.library);
  expect((await borrow(a, copy)).status).toBe(403);
  expect((await docs.findOne(COPY, copy.id)).isAvailable).toBe(true);
});

test('two simultaneous borrows of the same copy: one wins, one gets 409 (Review Focus 4)', async () => {
  const copy = await createCopy(a.library);
  const statuses = (await Promise.all([borrow(a, copy), borrow(a, copy)])).map((r) => r.status).sort();
  expect(statuses).toEqual([200, 409]);
});

