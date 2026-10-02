'use strict';

const request = require('supertest');
const docs = require('../helpers/docs');
const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');
const { createApiToken } = require('../helpers/api-token');
const { writeFrontendFixture } = require('../helpers/fixtures');

const BOOK = 'api::book.book';
const COPY = 'api::copy.copy';

let key;
let libA;
let libB;
let alpha;
let beta;
let pub;
let mag;
let author;
let translator;

beforeAll(async () => {
  await setupStrapi();
  key = await createApiToken(strapi, ['api::catalog.catalog.publications']);

  const roles = strapi.db.query('api::contributor-role.contributor-role');
  author = await roles.findOne({ where: { biblionetTypeId: '1' } });
  translator = await roles.findOne({ where: { biblionetTypeId: '2' } });

  libA = await docs.create('api::library.library', { data: { name: 'Βιβλιοθήκη Α' } });
  libB = await docs.create('api::library.library', { data: { name: 'Βιβλιοθήκη Β' } });
  alpha = await docs.create('api::person.person', { data: { name: 'Άλφα Πρόσωπο' } });
  beta = await docs.create('api::person.person', { data: { name: 'Βήτα Πρόσωπο' } });
  pub = await docs.create('api::publisher.publisher', { data: { name: 'Εκδόσεις Δοκιμών' } });
  mag = await docs.create('api::magazine.magazine', { data: { title: 'Περιοδικό Δοκιμών' } });

  const book = (title, type, extra = {}) => docs.create(BOOK, { data: { title, type, ...extra } });
  const as = (person, role) => ({ person: person.id, role: role.id });
  const copy = (publication, library, copyNumber, isAvailable) =>
    docs.create(COPY, { data: { publication: publication.id, library: library.id, copyNumber, isAvailable } });

  // Created in this order: the newest is last.
  const b1 = await book('Αλγόριθμοι της αντίστασης', 'Βιβλίο', { isbn: '9786185895006', contributors: [as(alpha, author)] });
  await copy(b1, libA, 1, true);
  const b2 = await book('Αναρχισμός και οικολογία', 'Μπροσούρα', { contributors: [as(beta, author), as(alpha, translator)] });
  await copy(b2, libA, 1, false);
  await copy(b2, libB, 1, true);
  await book('Η οικολογία της ελευθερίας', 'Βιβλίο', {
    isbn: '9780306406157', publisher: pub.id, contributors: [as(alpha, author), as(alpha, translator)],
  });
  const b4 = await book('Δεύτερη οικολογία', 'Μπροσούρα', { publisher: pub.id });
  await copy(b4, libA, 1, true);
  await copy(b4, libA, 2, true);

  const issue = (data) => book('Περιοδικό Δοκιμών', 'Περιοδικό', { magazine: mag.id, ...data });
  await issue({ issueNumber: '2' });
  await issue({ issueNumber: 'τχ. 10' });
  await issue({ issueNumber: null, publicationMonthYear: 'Ειδικό τεύχος' });
  await issue({ issueNumber: '1' });
});
afterAll(async () => { await cleanupStrapi(); });

const get = (query = '', token = key) => {
  const req = request(strapi.server.httpServer).get(`/api/catalog/publications${query}`);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};
const titles = (res) => res.body.data.map((c) => c.title);
const enc = encodeURIComponent;

test('without parameters: every publication, newest first, with pagination meta', async () => {
  const res = await get();
  expect(res.status).toBe(200);
  expect(res.body.meta.pagination.total).toBe(8);
  expect(res.body.data[0].issueNumber).toBe('1');
  expect(titles(res).at(-1)).toBe('Αλγόριθμοι της αντίστασης');
  expect(res.body.meta.roles).toBeUndefined();
});

test('person: every publication once, with the counts per role (Review Focus 1)', async () => {
  const res = await get(`?person=${alpha.documentId}`);
  expect(titles(res)).toEqual(['Η οικολογία της ελευθερίας', 'Αναρχισμός και οικολογία', 'Αλγόριθμοι της αντίστασης']);
  expect(res.body.meta.pagination.total).toBe(3);
  expect(res.body.meta.roles).toEqual([
    { documentId: author.documentId, name: 'Συγγραφέας', count: 2 },
    { documentId: translator.documentId, name: 'Μεταφραστής', count: 2 },
  ]);
});

test('person + role use the same contributor row (Review Focus 2)', async () => {
  expect(titles(await get(`?person=${alpha.documentId}&role=${author.documentId}`)))
    .toEqual(['Η οικολογία της ελευθερίας', 'Αλγόριθμοι της αντίστασης']);
  const res = await get(`?person=${beta.documentId}&role=${translator.documentId}`);
  expect(res.body.data).toEqual([]);
  expect(res.body.meta.roles).toEqual([{ documentId: author.documentId, name: 'Συγγραφέας', count: 1 }]);
});

test('role without person → 400', async () => {
  expect((await get(`?role=${author.documentId}`)).status).toBe(400);
});

test('publisher', async () => {
  expect(titles(await get(`?publisher=${pub.documentId}`))).toEqual(['Δεύτερη οικολογία', 'Η οικολογία της ελευθερίας']);
});

test('magazine: issues by issue number, unnumbered last (Review Focus 3)', async () => {
  const res = await get(`?magazine=${mag.documentId}`);
  expect(res.body.data.map((c) => c.issueNumber)).toEqual(['τχ. 10', '2', '1', null]);
});

test('library: a publication with two copies there appears and counts once', async () => {
  const res = await get(`?library=${libA.documentId}`);
  expect(titles(res)).toEqual(['Δεύτερη οικολογία', 'Αναρχισμός και οικολογία', 'Αλγόριθμοι της αντίστασης']);
  expect(res.body.meta.pagination.total).toBe(3);
});

test('library + available: the available copy must be in that library', async () => {
  expect(titles(await get(`?library=${libA.documentId}&available=true`)))
    .toEqual(['Δεύτερη οικολογία', 'Αλγόριθμοι της αντίστασης']);
});

test('availability is computed per library', async () => {
  const [b2] = (await get(`?q=${enc('αναρχισμος')}`)).body.data;
  expect(b2.availability).toEqual({
    total: 2,
    available: 1,
    libraries: [
      { documentId: libA.documentId, name: 'Βιβλιοθήκη Α', total: 1, available: 0 },
      { documentId: libB.documentId, name: 'Βιβλιοθήκη Β', total: 1, available: 1 },
    ],
  });
  const [b3] = (await get(`?q=${enc('ελευθεριας')}`)).body.data;
  expect(b3.availability).toEqual({ total: 0, available: 0, libraries: [] });
});

test('q as ISBN, and type', async () => {
  expect(titles(await get(`?q=${enc('978-618-5895-00-6')}`))).toEqual(['Αλγόριθμοι της αντίστασης']);
  expect(titles(await get(`?type=${enc('Μπροσούρα')}`))).toEqual(['Δεύτερη οικολογία', 'Αναρχισμός και οικολογία']);
});

test('only the fields of a card', async () => {
  const [card] = (await get(`?q=${enc('αναρχισμος')}`)).body.data;
  expect(Object.keys(card).sort()).toEqual(
    ['availability', 'contributors', 'coverImageUrl', 'documentId', 'issueNumber', 'publicationMonthYear', 'title', 'type'],
  );
  expect(Object.keys(card.contributors[0].person).sort()).toEqual(['documentId', 'name', 'qualifier']);
  expect(Object.keys(card.contributors[0].role).sort()).toEqual(['biblionetTypeId', 'documentId', 'name']);
  expect(card.contributors.map((c) => [c.person.name, c.role.name])).toEqual([
    ['Βήτα Πρόσωπο', 'Συγγραφέας'],
    ['Άλφα Πρόσωπο', 'Μεταφραστής'],
  ]);
});

test('pagination', async () => {
  const res = await get('?pageSize=3&page=3');
  expect(res.body.data).toHaveLength(2);
  expect(res.body.meta.pagination).toEqual({ page: 3, pageSize: 3, pageCount: 3, total: 8 });
});

test.each([
  [`?q=${enc('α')}`],
  [`?type=${enc('Άλλο')}`],
  ['?pageSize=101'],
  ['?page=0'],
  ['?available=yes'],
])('%s → 400', async (query) => {
  expect((await get(query)).status).toBe(400);
});

test('without a token → 403', async () => {
  expect((await get('', null)).status).toBe(403);
});

test('contract fixtures for the public site', async () => {
  writeFrontendFixture('catalog-publications.json', (await get('?pageSize=4')).body);
  writeFrontendFixture('catalog-publications-person.json', (await get(`?person=${alpha.documentId}`)).body);
  writeFrontendFixture('catalog-publications-magazine.json', (await get(`?magazine=${mag.documentId}`)).body);
});
