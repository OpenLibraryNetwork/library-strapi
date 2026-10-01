'use strict';

/**
 * Contract fixtures for the JavaFX magazine flows (sub-project 2γ).
 * The National Library is mocked with its real record 633300; fixtures go to the JavaFX test resources.
 */

jest.mock('../../src/api/magazine/services/nlg', () => ({
  searchSerialsByIssn: jest.fn(),
  getBiblio: jest.fn(),
}));

const docs = require('../helpers/docs');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const nlg = require('../../src/api/magazine/services/nlg');
const { NlgUnavailableError } = require('../../src/utils/catalog-errors');
const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');
const { createLibrarian } = require('../helpers/auth');

const FIXTURE_DIR = path.join(__dirname, '..', '..', '..', 'LibraryManagementSystemDesktopApp', 'src', 'test', 'resources', 'strapi-fixtures');
const VOLATILE = new Set(['createdAt', 'updatedAt', 'publishedAt']);
const record633300 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'nlg', 'biblio-633300.json'), 'utf8'));
const BOOK_POPULATE = 'populate[contributors][populate][0]=person&populate[contributors][populate][1]=role'
  + '&populate[publisher]=true&populate[subjects]=true&populate[copies][populate][0]=library';

function stripVolatile(value) {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (VOLATILE.has(k)) continue;
      out[k] = k === 'documentId' && value.id !== undefined ? `doc-${value.id}` : stripVolatile(v);
    }
    return out;
  }
  return value;
}
function writeFixture(name, body) {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  fs.writeFileSync(path.join(FIXTURE_DIR, name), `${JSON.stringify(stripVolatile(body), null, 2)}\n`);
}

let lib;
let magazineId;
beforeAll(async () => {
  await setupStrapi();
  lib = await createLibrarian(strapi, { libraryName: 'Βιβλιοθήκη Fixtures 2γ' });
  nlg.searchSerialsByIssn.mockImplementation(async (issn) => {
    if (issn === '1108-2402') throw new NlgUnavailableError('timeout');
    return issn === '2241-5580' ? ['633300'] : [];
  });
  nlg.getBiblio.mockImplementation(async (n) => (n === '633300' ? record633300 : null));
});
afterAll(async () => { await cleanupStrapi(); });

const http = () => request(strapi.server.httpServer);
const auth = (req) => req.set('Authorization', `Bearer ${lib.jwt}`);
const lookup = (code) => auth(http().post('/api/magazines/issn-lookup')).send({ code });

test('writes the magazine fixtures', async () => {
  const nlgRes = await lookup('2241-5580');
  expect(nlgRes.body.source).toBe('nlg');
  writeFixture('magazine-issn-lookup-nlg.json', nlgRes.body);
  magazineId = nlgRes.body.data.documentId;

  const catalog = await lookup('977224155800805');
  expect(catalog.body.source).toBe('catalog');
  writeFixture('magazine-issn-lookup-catalog.json', catalog.body);

  const notFound = await lookup('0317-8471');
  expect(notFound.body.source).toBe('not-found');
  writeFixture('magazine-issn-lookup-not-found.json', notFound.body);

  const unavailable = await lookup('1108-2402');
  expect(unavailable.body.source).toBe('unavailable');
  writeFixture('magazine-issn-lookup-unavailable.json', unavailable.body);

  const dupMag = await auth(http().post('/api/magazines/local')).send({ data: { title: 'ΚΟΙΝΩΝΙΚΟΣ ΑΝΑΡΧΙΣΜΟΣ' } });
  expect(dupMag.status).toBe(409);
  writeFixture('magazines-local-duplicate-409.json', dupMag.body);

  const issue5 = await auth(http().post('/api/books/local')).send({ data: {
    type: 'Περιοδικό', magazine: magazineId, issueNumber: '5', publicationMonthYear: 'Δεκέμβριος 2016', subtitle: 'Αφιέρωμα',
  } });
  expect(issue5.status).toBe(201);
  await docs.create('api::copy.copy', { data: { publication: issue5.body.data.id, library: lib.library.id, copyNumber: 1 } });
  const issue10 = await auth(http().post('/api/books/local')).send({ data: { type: 'Περιοδικό', magazine: magazineId, issueNumber: '10' } });
  expect(issue10.status).toBe(201);
  const spring = await auth(http().post('/api/books/local')).send({ data: { type: 'Περιοδικό', magazine: magazineId, publicationMonthYear: 'Άνοιξη 2020' } });
  expect(spring.status).toBe(201);

  const dupIssue = await auth(http().post('/api/books/local')).send({ data: { type: 'Περιοδικό', magazine: magazineId, issueNumber: '05' } });
  expect(dupIssue.status).toBe(409);
  writeFixture('issue-local-duplicate-409.json', dupIssue.body);

  const search = await auth(http().get(`/api/magazines/search?q=${encodeURIComponent('αναρχισμος')}`));
  expect(search.body.data[0].issuesInLibrary).toBe(1);
  writeFixture('magazines-search.json', search.body);

  const inLibrary = await auth(http().get('/api/magazines/in-library?page=1&pageSize=15'));
  expect(inLibrary.body.data).toHaveLength(1);
  writeFixture('magazines-in-library.json', inLibrary.body);

  const issues = await auth(http().get(`/api/books?${BOOK_POPULATE}&filters[type][$eq]=${encodeURIComponent('Περιοδικό')}`
    + `&filters[magazine][documentId][$eq]=${magazineId}&pagination[pageSize]=100`));
  expect(issues.body.data).toHaveLength(3);
  writeFixture('issues-of-magazine.json', issues.body);
});
