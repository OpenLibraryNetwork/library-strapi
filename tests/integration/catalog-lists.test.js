'use strict';

const request = require('supertest');
const docs = require('../helpers/docs');
const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');
const { createApiToken } = require('../helpers/api-token');
const { writeFrontendFixture } = require('../helpers/fixtures');

let key;
let alphaPublisher;

beforeAll(async () => {
  await setupStrapi();
  key = await createApiToken(strapi, [
    'api::catalog.catalog.searchCounts',
    'api::catalog.catalog.persons',
    'api::catalog.catalog.publishers',
    'api::catalog.catalog.magazines',
    'api::catalog.catalog.libraries',
  ]);
  for (const name of ['Νίκος Αλφάς', 'Ζωή Αλφάβητου', 'Νίκη Λοϊζίδη']) {
    await docs.create('api::person.person', { data: { name } });
  }
  alphaPublisher = await docs.create('api::publisher.publisher', { data: { name: 'Εκδόσεις Άλφα' } });
  await docs.create('api::publisher.publisher', { data: { name: 'Βήτα Εκδόσεις' } });
  await docs.create('api::magazine.magazine', { data: { title: 'Άλφα Τεύχη', issn: '0000-0019', publisher: alphaPublisher.id } });
  await docs.create('api::magazine.magazine', { data: { title: 'Γάμμα' } });
  await docs.create('api::book.book', { data: { title: 'Άλφα και Ωμέγα', type: 'Μπροσούρα' } });
  await docs.create('api::library.library', { data: { name: 'Γ Βιβλιοθήκη', description: 'Τρίτη' } });
  await docs.create('api::library.library', { data: { name: 'Α Βιβλιοθήκη' } });
  await docs.create('api::library.library', { data: { name: 'Β Βιβλιοθήκη' } });
});
afterAll(async () => { await cleanupStrapi(); });

const get = (path, token = key) => {
  const req = request(strapi.server.httpServer).get(`/api/catalog/${path}`);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};
const enc = encodeURIComponent;
const names = (res) => res.body.data.map((d) => d.name ?? d.title);

describe('persons and publishers', () => {
  test('alphabetical without accents; only the list fields', async () => {
    const res = await get(`persons?q=${enc('αλφ')}`);
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['Ζωή Αλφάβητου', 'Νίκος Αλφάς']);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['documentId', 'name', 'qualifier']);
  });

  test('paginated in Strapi', async () => {
    const res = await get(`persons?q=${enc('αλφ')}&pageSize=1&page=2`);
    expect(names(res)).toEqual(['Νίκος Αλφάς']);
    expect(res.body.meta.pagination).toEqual({ page: 2, pageSize: 1, pageCount: 2, total: 2 });
  });

  test('q is required', async () => {
    expect((await get('persons')).status).toBe(400);
    expect((await get(`persons?q=${enc('α')}`)).status).toBe(400);
    expect((await get('publishers')).status).toBe(400);
  });

  test('publishers', async () => {
    expect(names(await get(`publishers?q=${enc('εκδοσεις')}`))).toEqual(['Βήτα Εκδόσεις', 'Εκδόσεις Άλφα']);
  });
});

describe('magazines', () => {
  test('by q, with the list fields', async () => {
    const res = await get(`magazines?q=${enc('αλφα')}`);
    expect(res.body.data).toEqual([expect.objectContaining({ title: 'Άλφα Τεύχη', issn: '0000-0019' })]);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['documentId', 'issn', 'qualifier', 'title']);
  });

  test('by publisher', async () => {
    expect(names(await get(`magazines?publisher=${alphaPublisher.documentId}`))).toEqual(['Άλφα Τεύχη']);
  });

  test('q or publisher is required', async () => {
    expect((await get('magazines')).status).toBe(400);
  });
});

describe('search counts', () => {
  test('the four tabs (substring match, as the searchKey)', async () => {
    const res = await get(`search-counts?q=${enc('αλφα')}`);
    expect(res.body.data).toEqual({ publications: 1, persons: 2, publishers: 1, magazines: 1 });
  });

  test('publication filters apply to the publications count', async () => {
    expect((await get(`search-counts?q=${enc('αλφα')}&type=${enc('Βιβλίο')}`)).body.data.publications).toBe(0);
  });

  test('q is required', async () => {
    expect((await get('search-counts')).status).toBe(400);
  });
});

describe('libraries', () => {
  test('by name, with description', async () => {
    const res = await get('libraries');
    const order = names(res).filter((n) => /^[ΑΒΓ] Βιβλιοθήκη$/.test(n));
    expect(order).toEqual(['Α Βιβλιοθήκη', 'Β Βιβλιοθήκη', 'Γ Βιβλιοθήκη']);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['description', 'documentId', 'name']);
  });

  test('compact for the dropdown', async () => {
    const res = await get('libraries?compact=true');
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['documentId', 'name']);
  });
});

test('without a token → 403', async () => {
  expect((await get(`persons?q=${enc('αλφ')}`, null)).status).toBe(403);
});

test('contract fixtures for the public site', async () => {
  writeFrontendFixture('catalog-search-counts.json', (await get(`search-counts?q=${enc('αλφα')}`)).body);
  writeFrontendFixture('catalog-persons.json', (await get(`persons?q=${enc('αλφ')}`)).body);
  writeFrontendFixture('catalog-magazines.json', (await get(`magazines?q=${enc('αλφα')}`)).body);
  writeFrontendFixture('catalog-libraries.json', (await get('libraries')).body);
  writeFrontendFixture('catalog-libraries-compact.json', (await get('libraries?compact=true')).body);
});
