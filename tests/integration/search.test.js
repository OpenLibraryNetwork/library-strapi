'use strict';

const docs = require('../helpers/docs');
const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');
const { createLibrarian } = require('../helpers/auth');

let jwt;
beforeAll(async () => {
  await setupStrapi();
  ({ jwt } = await createLibrarian(strapi));
  const es = docs;
  await es.create('api::person.person', { data: { name: 'Νίκος Λοϊζίδης' } });
  await es.create('api::person.person', { data: { name: 'Μαρία Παππά' } });
  for (let i = 1; i <= 25; i += 1) {
    await es.create('api::person.person', { data: { name: `Μαζικό Όνομα ${i}` } });
  }
  await es.create('api::publisher.publisher', { data: { name: 'Εκδόσεις Άνεμος' } });
  await es.create('api::book.book', { data: { title: 'Θεραπεία λόγου', type: 'Μπροσούρα' } });
  await es.create('api::book.book', { data: { title: 'Θεραπεία σώματος', type: 'Βιβλίο', isbn: '9780306406157' } });
});
afterAll(async () => { await cleanupStrapi(); });

const get = (path) => request(strapi.server.httpServer).get(path).set('Authorization', `Bearer ${jwt}`);
const names = (res) => res.body.data.map((d) => d.name || d.title);

test('uppercase accented query finds lowercase name (Review Focus 3)', async () => {
  const res = await get(`/api/persons/search?q=${encodeURIComponent('ΛΟΪΖΊΔΗΣ')}`);
  expect(res.status).toBe(200);
  expect(names(res)).toEqual(['Νίκος Λοϊζίδης']);
});

test('reversed word order and partial words match', async () => {
  expect(names(await get(`/api/persons/search?q=${encodeURIComponent('λοιζ νικ')}`))).toEqual(['Νίκος Λοϊζίδης']);
});

test('every word must match', async () => {
  expect(names(await get(`/api/persons/search?q=${encodeURIComponent('Λοϊζίδης Μαρία')}`))).toEqual([]);
});

test('too short query → 400', async () => {
  expect((await get(`/api/persons/search?q=${encodeURIComponent('α')}`)).status).toBe(400);
});

test('at most 20 results', async () => {
  expect((await get(`/api/persons/search?q=${encodeURIComponent('μαζικο')}`)).body.data).toHaveLength(20);
});

test('search keys are not exposed', async () => {
  const res = await get(`/api/persons/search?q=${encodeURIComponent('παππα')}`);
  expect(res.body.data[0].searchKey).toBeUndefined();
  expect(res.body.data[0].matchKey).toBeUndefined();
});

test('publisher search', async () => {
  expect(names(await get(`/api/publishers/search?q=${encodeURIComponent('ανεμοσ')}`))).toEqual(['Εκδόσεις Άνεμος']);
});

test('book search with and without type filter', async () => {
  expect(names(await get(`/api/books/search?q=${encodeURIComponent('θεραπεια')}`))).toEqual(['Θεραπεία λόγου', 'Θεραπεία σώματος']);
  expect(names(await get(`/api/books/search?q=${encodeURIComponent('θεραπεια')}&type=${encodeURIComponent('Μπροσούρα')}`)))
    .toEqual(['Θεραπεία λόγου']);
});

test('public can search', async () => {
  const res = await request(strapi.server.httpServer).get(`/api/persons/search?q=${encodeURIComponent('παππα')}`);
  expect(res.status).toBe(200);
});

test('records created in the same millisecond come back in id order (stable cut-off)', async () => {
  const a = await docs.create('api::book.book', { data: { title: 'Ισοπαλία Χρόνου Α', type: 'Μπροσούρα' } });
  const b = await docs.create('api::book.book', { data: { title: 'Ισοπαλία Χρόνου Β', type: 'Μπροσούρα' } });
  const same = new Date('2026-01-01T00:00:00.000Z');
  await strapi.db.query('api::book.book').updateMany({ where: { id: { $in: [a.id, b.id] } }, data: { createdAt: same } });
  const res = await get(`/api/books/search?type=${encodeURIComponent('Μπροσούρα')}&q=${encodeURIComponent('ισοπαλια χρονου')}`);
  expect(res.status).toBe(200);
  expect(res.body.data.map((x) => x.id)).toEqual([a.id, b.id]);
});
