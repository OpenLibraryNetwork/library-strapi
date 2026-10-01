'use strict';

const request = require('supertest');
const docs = require('../helpers/docs');
const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');
const { createApiToken } = require('../helpers/api-token');

let key;
let libA;
let libB;

const BOOK = 'api::book.book';
const COPY = 'api::copy.copy';

beforeAll(async () => {
  await setupStrapi();
  // Relations are sanitized by the caller's read permissions: the frontend token has these too.
  key = await createApiToken(strapi, ['api::book.book.browse', 'api::copy.copy.find', 'api::library.library.find']);
  libA = await docs.create('api::library.library', { data: { name: 'Βιβλιοθήκη Α' } });
  libB = await docs.create('api::library.library', { data: { name: 'Βιβλιοθήκη Β' } });

  const book = (title, type, extra = {}) => docs.create(BOOK, { data: { title, type, ...extra } });
  const copy = (publication, library, copyNumber, isAvailable) =>
    docs.create(COPY, { data: { publication: publication.id, library: library.id, copyNumber, isAvailable } });

  // Created in this order: the newest is last.
  const algorithms = await book('Αλγόριθμοι της αντίστασης', 'Βιβλίο', { isbn: '9786185895006' });
  await copy(algorithms, libA, 1, true);
  const anarchism = await book('Αναρχισμός και οικολογία', 'Μπροσούρα');
  await copy(anarchism, libA, 1, false); // borrowed in A …
  await copy(anarchism, libB, 1, true); // … available in B
  await book('Η οικολογία της ελευθερίας', 'Βιβλίο', { isbn: '9780306406157' }); // no copies
  const second = await book('Δεύτερη οικολογία', 'Μπροσούρα');
  await copy(second, libA, 1, true);
  await copy(second, libA, 2, true); // two matching copies in A
});
afterAll(async () => { await cleanupStrapi(); });

const browse = (query = '', token = key) => {
  const req = request(strapi.server.httpServer).get(`/api/books/browse${query}`);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};
const titles = (res) => res.body.data.map((b) => b.title);
const enc = encodeURIComponent;

test('without parameters: every publication, newest first, with pagination meta', async () => {
  const res = await browse();
  expect(res.status).toBe(200);
  expect(titles(res)).toEqual([
    'Δεύτερη οικολογία',
    'Η οικολογία της ελευθερίας',
    'Αναρχισμός και οικολογία',
    'Αλγόριθμοι της αντίστασης',
  ]);
  expect(res.body.meta.pagination).toEqual({ page: 1, pageSize: 24, pageCount: 1, total: 4 });
});

test('q: every word must match, accent- and case-insensitive', async () => {
  expect(titles(await browse(`?q=${enc('ΟΙΚΟΛΟΓΙΑ ελευθεριας')}`))).toEqual(['Η οικολογία της ελευθερίας']);
});

test('q as an ISBN with hyphens finds the book', async () => {
  expect(titles(await browse(`?q=${enc('978-618-5895-00-6')}`))).toEqual(['Αλγόριθμοι της αντίστασης']);
});

test('type', async () => {
  expect(titles(await browse(`?type=${enc('Μπροσούρα')}`))).toEqual(['Δεύτερη οικολογία', 'Αναρχισμός και οικολογία']);
});

test('library: a publication with two copies there appears and counts once (Review Focus 2)', async () => {
  const res = await browse(`?library=${libA.documentId}`);
  expect(titles(res)).toEqual(['Δεύτερη οικολογία', 'Αναρχισμός και οικολογία', 'Αλγόριθμοι της αντίστασης']);
  expect(res.body.meta.pagination.total).toBe(3);
});

test('library + available: the available copy must be in that library (Review Focus 1)', async () => {
  expect(titles(await browse(`?library=${libA.documentId}&available=true`)))
    .toEqual(['Δεύτερη οικολογία', 'Αλγόριθμοι της αντίστασης']);
  expect(titles(await browse(`?library=${libB.documentId}&available=true`))).toEqual(['Αναρχισμός και οικολογία']);
});

test('available alone: at least one available copy anywhere', async () => {
  expect(titles(await browse('?available=true')))
    .toEqual(['Δεύτερη οικολογία', 'Αναρχισμός και οικολογία', 'Αλγόριθμοι της αντίστασης']);
});

test('an unknown library gives no results, not an error', async () => {
  const res = await browse('?library=no-such-library');
  expect(res.status).toBe(200);
  expect(res.body.data).toEqual([]);
});

test('pagination', async () => {
  const res = await browse('?pageSize=2&page=2');
  expect(titles(res)).toEqual(['Αναρχισμός και οικολογία', 'Αλγόριθμοι της αντίστασης']);
  expect(res.body.meta.pagination).toEqual({ page: 2, pageSize: 2, pageCount: 2, total: 4 });
});

test('populated like every book response; private keys never leave', async () => {
  const res = await browse(`?q=${enc('αλγοριθμοι')}`);
  const [book] = res.body.data;
  expect(Array.isArray(book.contributors)).toBe(true);
  expect(book.copies[0].library.documentId).toBe(libA.documentId);
  expect(book).not.toHaveProperty('searchKey');
  expect(book).not.toHaveProperty('matchKey');
});

test.each([
  [`?q=${enc('α')}`],
  [`?type=${enc('Άλλο')}`],
  ['?pageSize=101'],
  ['?page=0'],
  ['?available=yes'],
])('%s → 400', async (query) => {
  expect((await browse(query)).status).toBe(400);
});

test('without a token → 403', async () => {
  expect((await browse('', null)).status).toBe(403);
});
