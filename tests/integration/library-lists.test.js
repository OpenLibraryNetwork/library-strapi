'use strict';

const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');
const { createLibrarian } = require('../helpers/auth');

let libA;
let libB;
beforeAll(async () => {
  await setupStrapi();
  libA = await createLibrarian(strapi, { libraryName: 'Βιβλιοθήκη Α' });
  libB = await createLibrarian(strapi, { libraryName: 'Βιβλιοθήκη Β' });

  const es = strapi.entityService;
  const roles = await es.findMany('api::contributor-role.contributor-role', { sort: 'biblionetTypeId' });
  const [author, translator] = roles;
  const niki = await es.create('api::person.person', { data: { name: 'Νίκη Λοϊζίδη' } });
  const panos = await es.create('api::person.person', { data: { name: 'Παναγιώτης Σκόνδρας' } });
  const allos = await es.create('api::person.person', { data: { name: 'Άλλος Συγγραφέας' } });
  const p1 = await es.create('api::publisher.publisher', { data: { name: 'Εκδόσεις Ένα' } });
  const p2 = await es.create('api::publisher.publisher', { data: { name: 'Εκδόσεις Δύο' } });

  const b1 = await es.create('api::book.book', { data: { title: 'Βιβλίο Ένα', type: 'Μπροσούρα', publisher: p1.id,
    contributors: [{ person: niki.id, role: author.id }, { person: panos.id, role: translator.id }] } });
  const b2 = await es.create('api::book.book', { data: { title: 'Βιβλίο Δύο', type: 'Μπροσούρα', publisher: p1.id,
    contributors: [{ person: niki.id, role: author.id }] } });
  const b3 = await es.create('api::book.book', { data: { title: 'Βιβλίο Τρία', type: 'Μπροσούρα', publisher: p2.id,
    contributors: [{ person: allos.id, role: author.id }, { person: panos.id, role: author.id }] } });

  const copy = (publication, library, copyNumber) =>
    es.create('api::copy.copy', { data: { publication, library, copyNumber } });
  await copy(b1.id, libA.library.id, 1);
  await copy(b1.id, libA.library.id, 2);
  await copy(b2.id, libA.library.id, 1);
  await copy(b3.id, libB.library.id, 1);
});
afterAll(async () => { await cleanupStrapi(); });

const get = (path, jwt) => {
  const req = request(strapi.server.httpServer).get(path);
  return jwt ? req.set('Authorization', `Bearer ${jwt}`) : req;
};
const rows = (res) => res.body.data.map((d) => [d.attributes.name, d.attributes.bookCount]);

describe('GET /api/persons/authors', () => {
  test('only authors with copies in my library; translators excluded (Review Focus 1)', async () => {
    const res = await get('/api/persons/authors', libA.jwt);
    expect(res.status).toBe(200);
    expect(rows(res)).toEqual([['Νίκη Λοϊζίδη', 2]]);
  });

  test('other library sees its own authors, sorted', async () => {
    expect(rows(await get('/api/persons/authors', libB.jwt))).toEqual([
      ['Άλλος Συγγραφέας', 1],
      ['Παναγιώτης Σκόνδρας', 1],
    ]);
  });

  test('accent- and case-insensitive search, any word order (Review Focus 2)', async () => {
    expect(rows(await get(`/api/persons/authors?q=${encodeURIComponent('ΛΟΪΖΊΔΗ')}`, libA.jwt))).toEqual([['Νίκη Λοϊζίδη', 2]]);
    expect(rows(await get(`/api/persons/authors?q=${encodeURIComponent('λοιζ νικ')}`, libA.jwt))).toEqual([['Νίκη Λοϊζίδη', 2]]);
  });

  test('pagination and meta', async () => {
    const res = await get('/api/persons/authors?page=2&pageSize=1', libB.jwt);
    expect(rows(res)).toEqual([['Παναγιώτης Σκόνδρας', 1]]);
    expect(res.body.meta.pagination).toEqual({ page: 2, pageSize: 1, pageCount: 2, total: 2 });
  });

  test('search keys are not exposed', async () => {
    const res = await get('/api/persons/authors', libA.jwt);
    expect(res.body.data[0].attributes.searchKey).toBeUndefined();
    expect(res.body.data[0].attributes.matchKey).toBeUndefined();
  });

  test('too short query → 400', async () => {
    expect((await get(`/api/persons/authors?q=${encodeURIComponent('α')}`, libA.jwt)).status).toBe(400);
  });

  test('public → 403 (Review Focus 5)', async () => {
    expect((await get('/api/persons/authors')).status).toBe(403);
  });

  test('user without library → 403 (Review Focus 5)', async () => {
    const role = await strapi.db.query('plugin::users-permissions.role').findOne({ where: { type: 'librarian' } });
    const user = await strapi.plugin('users-permissions').service('user').add({
      username: 'nolibrary', email: 'nolibrary@test.local', password: 'Test1234!',
      provider: 'local', confirmed: true, blocked: false, role: role.id,
    });
    const jwt = strapi.plugin('users-permissions').service('jwt').issue({ id: user.id });
    expect((await get('/api/persons/authors', jwt)).status).toBe(403);
  });
});

describe('GET /api/publishers/in-library', () => {
  test('publishers of my library with distinct book counts', async () => {
    expect(rows(await get('/api/publishers/in-library', libA.jwt))).toEqual([['Εκδόσεις Ένα', 2]]);
    expect(rows(await get('/api/publishers/in-library', libB.jwt))).toEqual([['Εκδόσεις Δύο', 1]]);
  });

  test('search', async () => {
    expect(rows(await get(`/api/publishers/in-library?q=${encodeURIComponent('ενα')}`, libA.jwt))).toEqual([['Εκδόσεις Ένα', 2]]);
    expect(rows(await get(`/api/publishers/in-library?q=${encodeURIComponent('δυο')}`, libA.jwt))).toEqual([]);
  });
});
