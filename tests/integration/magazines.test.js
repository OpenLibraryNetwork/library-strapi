'use strict';

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

const record633300 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'nlg', 'biblio-633300.json'), 'utf8'));

let lib;
beforeAll(async () => {
  await setupStrapi();
  lib = await createLibrarian(strapi, { libraryName: 'Βιβλιοθήκη Περιοδικών' });
});
afterAll(async () => { await cleanupStrapi(); });

beforeEach(() => {
  jest.clearAllMocks();
  nlg.searchSerialsByIssn.mockImplementation(async (issn) => (issn === '2241-5580' ? ['633300'] : []));
  nlg.getBiblio.mockImplementation(async (n) => (n === '633300' ? record633300 : null));
});

const http = () => request(strapi.server.httpServer);
const lookup = (code, jwt = lib.jwt) =>
  http().post('/api/magazines/issn-lookup').set('Authorization', `Bearer ${jwt}`).send({ code });
const MAG = 'api::magazine.magazine';

describe('POST /api/magazines/issn-lookup', () => {
  test('invalid code → 400 without calling the National Library', async () => {
    const res = await lookup('2241-5581');
    expect(res.status).toBe(400);
    expect(nlg.searchSerialsByIssn).not.toHaveBeenCalled();
  });

  test('not in the catalog → imported from the National Library with its publisher', async () => {
    const res = await lookup('22415580');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: 'nlg', issn: '2241-5580' });
    const a = res.body.data;
    expect(a).toMatchObject({ title: 'Κοινωνικός Αναρχισμός', issn: '2241-5580', place: 'Θεσσαλονίκη', nlgBiblionumber: '633300', reviewed: true });
    expect(a.publisher).toMatchObject({ name: 'Ελευθεριακές Εκδόσεις Κουρσάλ', reviewed: false });
    expect(a.searchKey).toBeUndefined();
    // one overall deadline is shared by the search and the record calls (final review M-1)
    const [[, deadline]] = nlg.searchSerialsByIssn.mock.calls;
    expect(deadline).toBeGreaterThan(Date.now());
    expect(nlg.getBiblio).toHaveBeenCalledWith('633300', deadline);
  });

  test('second lookup (barcode with add-on) → catalog, no National Library call', async () => {
    const res = await lookup('977224155800805');
    expect(res.body.source).toBe('catalog');
    expect(res.body.data.title).toBe('Κοινωνικός Αναρχισμός');
    expect(nlg.searchSerialsByIssn).not.toHaveBeenCalled();
    expect(await strapi.db.query(MAG).count({ where: { issn: '2241-5580' } })).toBe(1);
  });

  test('unknown ISSN → not-found', async () => {
    const res = await lookup('0317-8471');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: 'not-found', issn: '0317-8471', data: null });
  });

  test('National Library down or answering HTML → unavailable, nothing stored (Review Focus 2)', async () => {
    nlg.searchSerialsByIssn.mockRejectedValue(new NlgUnavailableError('η απάντηση δεν είναι RSS'));
    const res = await lookup('1234-5679');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: 'unavailable', issn: '1234-5679', data: null });
    expect(await strapi.db.query(MAG).count({ where: { issn: '1234-5679' } })).toBe(0);
  });

  test('record that is not a serial, or has another ISSN → not-found', async () => {
    nlg.searchSerialsByIssn.mockResolvedValue(['1', '2']);
    nlg.getBiblio.mockImplementation(async (n) => (n === '1'
      ? { ...record633300, leader: '00571nam a22001937a 4500' }
      : record633300)); // record 2 has ISSN 2241-5580, not the one asked
    const res = await lookup('1108-2402');
    expect(res.body.source).toBe('not-found');
  });

  test('an existing publisher with the same name is reused', async () => {
    const existing = await docs.create('api::publisher.publisher', { data: { name: 'Άννα Λαμπράκη' } });
    const record = JSON.parse(JSON.stringify(record633300));
    record.fields = record.fields.map((f) => (f['022'] ? { '022': { subfields: [{ a: '1108-2402' }] } } : f))
      .map((f) => (f['260'] ? { '260': { subfields: [{ a: 'Αθήνα :' }, { b: 'Άννα Λαμπράκη,' }] } } : f));
    nlg.searchSerialsByIssn.mockResolvedValue(['623636']);
    nlg.getBiblio.mockResolvedValue(record);
    const res = await lookup('1108-2402');
    expect(res.body.source).toBe('nlg');
    expect(res.body.data.publisher.id).toBe(existing.id);
  });

  test('two libraries importing the same ISSN at once get one record', async () => {
    const other = await createLibrarian(strapi, { libraryName: 'Δεύτερη Βιβλιοθήκη' });
    const record = JSON.parse(JSON.stringify(record633300));
    record.fields = record.fields.map((f) => (f['022'] ? { '022': { subfields: [{ a: '0000-006X' }] } } : f));
    nlg.searchSerialsByIssn.mockResolvedValue(['700000']);
    nlg.getBiblio.mockResolvedValue(record);
    const [a, b] = await Promise.all([lookup('0000-006X'), lookup('0000-006X', other.jwt)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.data.id).toBe(b.body.data.id);
    expect(await strapi.db.query(MAG).count({ where: { issn: '0000-006X' } })).toBe(1);
  });

  test('public cannot use it', async () => {
    expect((await http().post('/api/magazines/issn-lookup').send({ code: '2241-5580' })).status).toBe(403);
  });
});
const post = (p, data, jwt = lib.jwt) => http().post(p).set('Authorization', `Bearer ${jwt}`).send({ data });
const get = (p, jwt = lib.jwt) => {
  const req = http().get(p);
  return jwt ? req.set('Authorization', `Bearer ${jwt}`) : req;
};

describe('POST /api/magazines/local', () => {
  test('201 with server-controlled fields; ISSN normalized', async () => {
    const res = await post('/api/magazines/local', { title: 'Τοπικό Φυλλάδιο', issn: '12345679', nlgBiblionumber: '1', reviewed: true });
    expect(res.status).toBe(201);
    expect(res.body.source).toBe('local');
    const row = await strapi.db.query(MAG).findOne({ where: { id: res.body.data.id }, populate: ['catalogedBy'] });
    expect(row).toMatchObject({ issn: '1234-5679', nlgBiblionumber: null, reviewed: false });
    expect(row.catalogedBy.id).toBe(lib.library.id);
  });

  test('same title → 409 with candidates; a qualifier makes it a different magazine', async () => {
    const dup = await post('/api/magazines/local', { title: 'ΤΟΠΙΚΟ ΦΥΛΛΑΔΙΟ' });
    expect(dup.status).toBe(409);
    expect(dup.body.candidates[0].title).toBe('Τοπικό Φυλλάδιο');
    expect((await post('/api/magazines/local', { title: 'Τοπικό Φυλλάδιο', qualifier: 'Πάτρα' })).status).toBe(201);
  });

  test('ISSN already in the catalog → 409 with that magazine', async () => {
    const res = await post('/api/magazines/local', { title: 'Άλλος τίτλος', issn: '2241-5580' });
    expect(res.status).toBe(409);
    expect(res.body.candidates[0].issn).toBe('2241-5580');
  });

  test.each([
    ['missing title', { issn: '0317-8471' }],
    ['invalid ISSN', { title: 'Κ', issn: '0317-8472' }],
    ['unknown publisher', { title: 'Κ2', publisher: 999999 }],
  ])('400: %s', async (_label, data) => {
    expect((await post('/api/magazines/local', data)).status).toBe(400);
  });
});

describe('issues through POST /api/books/local', () => {
  let magazineDocumentId;
  beforeAll(async () => {
    magazineDocumentId = (await strapi.db.query(MAG).findOne({ where: { issn: '2241-5580' }, select: ['documentId'] })).documentId;
  });

  test('201: title and publisher come from the magazine', async () => {
    const res = await post('/api/books/local', {
      type: 'Περιοδικό', magazine: magazineDocumentId, issueNumber: '5', publicationMonthYear: 'Δεκέμβριος 2016',
      title: 'αγνοείται', subtitle: 'Αφιέρωμα στην αυτοδιαχείριση',
    });
    expect(res.status).toBe(201);
    const a = res.body.data;
    expect(a).toMatchObject({ type: 'Περιοδικό', title: 'Κοινωνικός Αναρχισμός', issueNumber: '5', subtitle: 'Αφιέρωμα στην αυτοδιαχείριση', reviewed: false });
    expect(a.publisher.name).toBe('Ελευθεριακές Εκδόσεις Κουρσάλ');
    await docs.create('api::copy.copy', { data: { publication: res.body.data.id, library: lib.library.id, copyNumber: 1 } });
  });

  test('duplicate ("05") → 409 with the existing issue', async () => {
    const res = await post('/api/books/local', { type: 'Περιοδικό', magazine: magazineDocumentId, issueNumber: '05' });
    expect(res.status).toBe(409);
    expect(res.body.candidates[0].issueNumber).toBe('5');
  });

  test.each([
    ['no magazine', { type: 'Περιοδικό', issueNumber: '1' }],
    ['unknown magazine', { type: 'Περιοδικό', magazine: 999999, issueNumber: '1' }],
    ['neither number nor period', { type: 'Περιοδικό', magazine: 1 }],
  ])('400: %s', async (_label, data) => {
    expect((await post('/api/books/local', data)).status).toBe(400);
  });
});

describe('GET /api/magazines/search and /in-library', () => {
  test('search: whole network, with my library\'s issue count', async () => {
    const res = await get(`/api/magazines/search?q=${encodeURIComponent('αναρχισμος')}`);
    expect(res.status).toBe(200);
    const hit = res.body.data.find((d) => d.issn === '2241-5580');
    expect(hit.issuesInLibrary).toBe(1);
    const local = (await get(`/api/magazines/search?q=${encodeURIComponent('φυλλαδιο')}`)).body.data;
    expect(local.every((d) => d.issuesInLibrary === 0)).toBe(true); // Review Focus 5
  });

  test('search: the frontend token gets no counts; public gets 403; short query → 400', async () => {
    const { frontendTokenKey } = require('../helpers/api-token');
    const path = `/api/magazines/search?q=${encodeURIComponent('αναρχισμος')}`;
    const key = await frontendTokenKey(strapi);
    const res = await http().get(path).set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(200);
    expect(res.body.data[0].issuesInLibrary).toBeUndefined();
    expect((await get(path, null)).status).toBe(403);
    expect((await get(`/api/magazines/search?q=${encodeURIComponent('α')}`)).status).toBe(400);
  });

  test('in-library: only magazines with a copy here (Review Focus 5)', async () => {
    const res = await get('/api/magazines/in-library');
    expect(res.status).toBe(200);
    expect(res.body.data.map((d) => [d.title, d.issuesInLibrary])).toEqual([['Κοινωνικός Αναρχισμός', 1]]);
    expect(res.body.meta.pagination).toMatchObject({ page: 1, total: 1 });
    const other = await createLibrarian(strapi, { libraryName: 'Χωρίς Περιοδικά' });
    expect((await get('/api/magazines/in-library', other.jwt)).body.data).toEqual([]);
  });
});

describe('2γ minors', () => {
  test('the scanned ISSN may be the second ISSN of the record (M-8)', async () => {
    const record = JSON.parse(JSON.stringify(record633300));
    record.fields = record.fields
      .map((f) => (f['022'] ? { '022': { subfields: [{ a: '1108-2402' }] } } : f))
      .map((f) => (f['245'] ? { '245': { subfields: [{ a: 'Δύο ISSN' }] } } : f));
    record.fields.push({ '022': { subfields: [{ a: '0000-0000' }] } });
    nlg.searchSerialsByIssn.mockResolvedValue(['800001']);
    nlg.getBiblio.mockResolvedValue(record);
    const res = await lookup('0000-0000');
    expect(res.body.source).toBe('nlg');
    expect(res.body.data).toMatchObject({ title: 'Δύο ISSN', issn: '0000-0000' });
  });

  test('two libraries creating the same local ISSN at once: the second gets 409 with the first (M-9)', async () => {
    const service = strapi.service('api::magazine.nlg-import');
    const first = await post('/api/magazines/local', { title: 'Ταυτόχρονο Περιοδικό', issn: '0000-0019' });
    expect(first.status).toBe(201);
    // the second request passed the ISSN pre-check before the first one was stored
    jest.spyOn(service, 'findByIssn').mockResolvedValueOnce(null);
    const second = await post('/api/magazines/local', { title: 'Άλλος Τίτλος Ίδιο ISSN', issn: '0000-0019' });
    expect(second.status).toBe(409);
    expect(second.body.candidates[0].id).toBe(first.body.data.id);
  });
});

test('magazines created in the same millisecond come back in id order (stable cut-off)', async () => {
  const a = await docs.create('api::magazine.magazine', { data: { title: 'Ισοπαλία Περιοδικό Α' } });
  const b = await docs.create('api::magazine.magazine', { data: { title: 'Ισοπαλία Περιοδικό Β' } });
  const same = new Date('2026-01-01T00:00:00.000Z');
  await strapi.db.query('api::magazine.magazine').updateMany({ where: { id: { $in: [a.id, b.id] } }, data: { createdAt: same } });
  const res = await get(`/api/magazines/search?q=${encodeURIComponent('ισοπαλια περιοδικο')}`);
  expect(res.status).toBe(200);
  expect(res.body.data.map((x) => x.id)).toEqual([a.id, b.id]);
});
