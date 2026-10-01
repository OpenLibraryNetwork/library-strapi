'use strict';

/**
 * Writes real Strapi responses to the JavaFX test resources, so the desktop client's
 * DTOConverter is tested against the actual API shape (contract fixtures).
 * Re-run this file whenever the API shape changes, then run the JavaFX tests.
 */

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');
const { createLibrarian } = require('../helpers/auth');

const FIXTURE_DIR = path.join(
  __dirname, '..', '..', '..',
  'LibraryManagementSystemDesktopApp', 'src', 'test', 'resources', 'strapi-fixtures'
);

// Must equal StrapiApiClient.BOOK_POPULATE in the JavaFX client.
const JAVAFX_BOOK_POPULATE =
  'populate[contributors][populate][0]=person&populate[contributors][populate][1]=role' +
  '&populate[publisher]=true&populate[subjects]=true&populate[copies][populate][0]=library';

const VOLATILE = new Set(['createdAt', 'updatedAt', 'publishedAt']);

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
let bookId;
beforeAll(async () => {
  await setupStrapi();
  lib = await createLibrarian(strapi, { libraryName: 'Βιβλιοθήκη Fixtures' });

  const es = strapi.entityService;
  const [author, translator] = await es.findMany('api::contributor-role.contributor-role', { sort: 'biblionetTypeId' });
  const niki = await es.create('api::person.person', {
    data: { name: 'Νίκη Λοϊζίδη', firstname: 'Νίκη', lastname: 'Λοϊζίδη', bornYear: '1950', biblionetPersonId: '15521', reviewed: true },
  });
  const panos = await es.create('api::person.person', {
    data: { name: 'Παναγιώτης Σκόνδρας', qualifier: '1960-', biblionetPersonId: '1232', reviewed: true },
  });
  const group = await es.create('api::person.person', { data: { name: 'Ομάδα Γειτονιάς' } });
  const nefeli = await es.create('api::publisher.publisher', {
    data: { name: 'Νεφέλη', address: 'Ασκληπιού 57, Αθήνα', biblionetCompanyId: '212', reviewed: true },
  });
  const subject = await es.create('api::subject.subject', {
    data: { subjectTitle: 'Νεοελληνική πεζογραφία', subjectDDC: '889.3', biblionetSubjectId: '20' },
  });

  const book = await es.create('api::book.book', {
    data: {
      title: 'Θεραπείας συνέχεια', type: 'Βιβλίο', isbn: '9789602116524', biblionetId: '72584',
      yearPublished: 2002, pages: 119, language: 'Ελληνικά', binding: 'Μαλακό εξώφυλλο', place: 'Αθήνα',
      series: 'Σύγχρονη Ελληνική Πεζογραφία', summary: 'Περίληψη.', reviewed: true,
      publisher: nefeli.id, subjects: [subject.id],
      contributors: [{ person: niki.id, role: author.id }, { person: panos.id, role: translator.id }],
    },
  });
  bookId = book.id;
  const brochure = await es.create('api::book.book', {
    data: { title: 'Αυτοοργάνωση', type: 'Μπροσούρα', yearPublished: 2019,
      contributors: [{ person: group.id, role: author.id }] },
  });

  await es.create('api::copy.copy', { data: { publication: book.id, library: lib.library.id, copyNumber: 1 } });
  await es.create('api::copy.copy', { data: { publication: book.id, library: lib.library.id, copyNumber: 2, isAvailable: false } });
  await es.create('api::copy.copy', { data: { publication: brochure.id, library: lib.library.id, copyNumber: 1 } });
});
afterAll(async () => { await cleanupStrapi(); });

const get = (url) => request(strapi.server.httpServer).get(url).set('Authorization', `Bearer ${lib.jwt}`);

test('writes book-with-contributors.json', async () => {
  const res = await get(`/api/books/${bookId}?${JAVAFX_BOOK_POPULATE}`);
  expect(res.status).toBe(200);
  expect(res.body.data.attributes.contributors).toHaveLength(2);
  writeFixture('book-with-contributors.json', res.body);
});

test('writes books-page.json', async () => {
  const res = await get(
    `/api/books?${JAVAFX_BOOK_POPULATE}&filters[copies][library][id][$eq]=${lib.library.id}` +
      '&pagination[page]=1&pagination[pageSize]=15&sort=title'
  );
  expect(res.status).toBe(200);
  expect(res.body.data).toHaveLength(2);
  writeFixture('books-page.json', res.body);
});

test('writes authors-in-library.json', async () => {
  const res = await get('/api/persons/authors');
  expect(res.status).toBe(200);
  writeFixture('authors-in-library.json', res.body);
});

test('writes publishers-in-library.json', async () => {
  const res = await get('/api/publishers/in-library');
  expect(res.status).toBe(200);
  writeFixture('publishers-in-library.json', res.body);
});

test('all four fixtures exist', () => {
  for (const name of ['book-with-contributors', 'books-page', 'authors-in-library', 'publishers-in-library']) {
    expect(fs.existsSync(path.join(FIXTURE_DIR, `${name}.json`))).toBe(true);
  }
});
