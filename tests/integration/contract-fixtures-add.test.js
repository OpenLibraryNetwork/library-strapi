'use strict';

/**
 * Contract fixtures for the JavaFX "add publication" flows (sub-project 2β).
 * Biblionet is mocked; fixtures are written into the JavaFX test resources.
 */

jest.mock('../../src/api/book/services/biblionet', () => {
  const actual = jest.requireActual('../../src/api/book/services/biblionet');
  return {
    searchByIsbn: jest.fn(),
    getContributors: jest.fn(),
    getSubjects: jest.fn(),
    getPerson: jest.fn(),
    getCompany: jest.fn(),
    downloadImage: jest.fn(),
    extractData: actual.extractData,
    extractAllData: actual.extractAllData,
  };
});

const docs = require('../helpers/docs');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const biblionet = require('../../src/api/book/services/biblionet');
const quota = require('../../src/api/book/services/biblionet-quota');
const fx = require('../fixtures/biblionet');
const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');
const { createLibrarian } = require('../helpers/auth');

const FIXTURE_DIR = path.join(
  __dirname, '..', '..', '..',
  'LibraryManagementSystemDesktopApp', 'src', 'test', 'resources', 'strapi-fixtures'
);
const VOLATILE = new Set(['createdAt', 'updatedAt', 'publishedAt', 'quota']);

function stripVolatile(value) {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).filter(([k]) => !VOLATILE.has(k)).map(([k, v]) => [k, stripVolatile(v)])
    );
  }
  return value;
}

function writeFixture(name, body) {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  fs.writeFileSync(path.join(FIXTURE_DIR, name), `${JSON.stringify(stripVolatile(body), null, 2)}\n`);
}

let lib;
let groupId;
let authorRoleId;
beforeAll(async () => {
  await setupStrapi();
  quota.reset();
  biblionet.searchByIsbn.mockImplementation(async (isbn) => (isbn === '9789602116524' ? fx.title : null));
  biblionet.getContributors.mockResolvedValue(fx.contributors[0]);
  biblionet.getSubjects.mockResolvedValue(fx.subjects[0]);
  biblionet.getPerson.mockImplementation(async (id) => (id === '1232' ? fx.person : null));
  biblionet.getCompany.mockResolvedValue(fx.company);
  biblionet.downloadImage.mockRejectedValue(new Error('no network in tests'));

  lib = await createLibrarian(strapi, { libraryName: 'Βιβλιοθήκη Fixtures 2β' });
  const es = docs;
  const [author] = await es.findMany('api::contributor-role.contributor-role', { filters: { biblionetTypeId: '1' } });
  authorRoleId = author.id;
  const group = await es.create('api::person.person', { data: { name: 'Ομάδα Γειτονιάς' } });
  groupId = group.id;
  const brochure = await es.create('api::book.book', {
    data: { title: 'Μανιφέστο', type: 'Μπροσούρα', yearPublished: 2019,
      contributors: [{ person: group.id, role: author.id }] },
  });
  await es.create('api::copy.copy', { data: { publication: brochure.id, library: lib.library.id, copyNumber: 1 } });
});
afterAll(async () => { await cleanupStrapi(); });

const http = () => request(strapi.server.httpServer);
const get = (url) => http().get(url).set('Authorization', `Bearer ${lib.jwt}`);
const post = (url, body) => http().post(url).set('Authorization', `Bearer ${lib.jwt}`).send(body);

test('writes isbn-lookup-found.json', async () => {
  const res = await post('/api/books/isbn-lookup', { isbn: '978-960-211-652-4' });
  expect(res.status).toBe(200);
  expect(res.body.source).toBe('biblionet');
  writeFixture('isbn-lookup-found.json', res.body);
});

test('writes isbn-lookup-not-found.json', async () => {
  const res = await post('/api/books/isbn-lookup', { isbn: '9791032305690' });
  expect(res.status).toBe(200);
  expect(res.body.source).toBe('not-found');
  writeFixture('isbn-lookup-not-found.json', res.body);
});

test('writes books-local-duplicate-409.json', async () => {
  const res = await post('/api/books/local', { data: { type: 'Μπροσούρα', title: 'ΜΑΝΙΦΕΣΤΟ', yearPublished: 2019 } });
  expect(res.status).toBe(409);
  expect(res.body.candidates).toHaveLength(1);
  writeFixture('books-local-duplicate-409.json', res.body);
});

test('writes persons-local-duplicate-409.json', async () => {
  const res = await post('/api/persons/local', { data: { name: 'ομαδα γειτονιας' } });
  expect(res.status).toBe(409);
  expect(res.body.candidates[0].id).toBe(groupId);
  writeFixture('persons-local-duplicate-409.json', res.body);
});

test('writes brochures-search.json', async () => {
  const res = await get(`/api/books/search?type=${encodeURIComponent('Μπροσούρα')}&q=${encodeURIComponent('μανιφεστο')}`);
  expect(res.status).toBe(200);
  expect(res.body.data).toHaveLength(1);
  writeFixture('brochures-search.json', res.body);
});

test('writes persons-search.json', async () => {
  const res = await get(`/api/persons/search?q=${encodeURIComponent('γειτονια')}`);
  expect(res.status).toBe(200);
  writeFixture('persons-search.json', res.body);
});

test('writes contributor-roles.json', async () => {
  const res = await get('/api/contributor-roles?sort=biblionetTypeId');
  expect(res.status).toBe(200);
  expect(res.body.data.map((r) => r.attributes.biblionetTypeId)).toEqual(['1', '2']);
  expect(authorRoleId).toBe(res.body.data[0].id);
  writeFixture('contributor-roles.json', res.body);
});
