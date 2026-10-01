'use strict';

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

const request = require('supertest');
const biblionet = require('../../src/api/book/services/biblionet');
const quota = require('../../src/api/book/services/biblionet-quota');
const fx = require('../fixtures/biblionet');
const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');
const { createLibrarian } = require('../helpers/auth');

let jwt;
beforeAll(async () => {
  await setupStrapi();
  ({ jwt } = await createLibrarian(strapi));
});
afterAll(async () => { await cleanupStrapi(); });

beforeEach(() => {
  jest.clearAllMocks();
  quota.reset();
  biblionet.searchByIsbn.mockResolvedValue(fx.title);
  biblionet.getContributors.mockResolvedValue(fx.contributors[0]);
  biblionet.getSubjects.mockResolvedValue(fx.subjects[0]);
  biblionet.getPerson.mockImplementation(async (id) => (id === '1232' ? fx.person : null));
  biblionet.getCompany.mockResolvedValue(fx.company);
  biblionet.downloadImage.mockRejectedValue(new Error('no network in tests'));
});

const lookup = (isbn) =>
  request(strapi.server.httpServer).post('/api/books/isbn-lookup').set('Authorization', `Bearer ${jwt}`).send({ isbn });
const count = (uid, filters = {}) => strapi.db.query(uid).count({ where: filters });

test('invalid ISBN → 400 without calling Biblionet', async () => {
  const res = await lookup('978-960-211-652-5');
  expect(res.status).toBe(400);
  expect(biblionet.searchByIsbn).not.toHaveBeenCalled();
});

test('Biblionet error object → not-found (Review Focus 2)', async () => {
  const actual = jest.requireActual('../../src/api/book/services/biblionet');
  biblionet.searchByIsbn.mockImplementation(async () => actual.extractData(fx.error));
  const res = await lookup('9780804429573');
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ source: 'not-found', data: null });
});

test('get_contributors failure → 502 and nothing is stored', async () => {
  biblionet.getContributors.mockRejectedValue(new Error('timeout'));
  const res = await lookup('978-960-211-652-4');
  expect(res.status).toBe(502);
  expect(await count('api::book.book')).toBe(0);
  expect(await count('api::person.person')).toBe(0);
});

test('quota exhausted → 429', async () => {
  jest.spyOn(quota, 'canMakeCall').mockReturnValueOnce(false);
  const res = await lookup('978-960-211-652-4');
  expect(res.status).toBe(429);
});

test('imports from Biblionet with all contributors, roles and enrichment', async () => {
  const res = await lookup('978-960-211-652-4');
  expect(res.status).toBe(200);
  expect(res.body.source).toBe('biblionet');

  const a = res.body.data.attributes;
  expect(a.isbn).toBe('9789602116524');
  expect(a.type).toBe('Βιβλίο');
  expect(a.reviewed).toBe(true);
  expect(a.coverImageUrl).toBe('https://biblionet.gr/wp-content/uploadsTitleImages/08/b72584.jpg');
  expect(a.searchKey).toBeUndefined();
  expect(a.contributors.map((c) => [c.person.data.attributes.name, c.role.data.attributes.name])).toEqual([
    ['Pino Corrias', 'Συγγραφέας'],
    ['Παναγιώτης Σκόνδρας', 'Μεταφραστής'],
  ]);
  expect(a.publisher.data.attributes).toMatchObject({ name: 'Νεφέλη', phone: '210 3607744', reviewed: true });
  expect(a.subjects.data.map((s) => s.attributes.subjectDDC)).toEqual(['889.3']);

  const translator = await strapi.db.query('api::person.person').findOne({ where: { biblionetPersonId: '1232' } });
  expect(translator).toMatchObject({ firstname: 'Παναγιώτης', lastname: 'Σκόνδρας', reviewed: true });

  // title + contributors + subjects + 2 persons + company
  expect(quota.getUsage().used).toBe(6);
});

test('second lookup comes from the catalog without Biblionet calls', async () => {
  const res = await lookup('9789602116524');
  expect(res.body.source).toBe('catalog');
  expect(biblionet.searchByIsbn).not.toHaveBeenCalled();
});

test('ISBN-10 finds the book stored as ISBN-13 (Review Focus 4)', async () => {
  const res = await lookup('960-211-652-8');
  expect(res.body.source).toBe('catalog');
  expect(res.body.data.attributes.isbn).toBe('9789602116524');
});

test('person enrichment failure is not fatal; unknown role type is created; known persons are reused', async () => {
  biblionet.searchByIsbn.mockResolvedValue({ ...fx.title, TitlesID: '555', PublisherID: '212' });
  biblionet.getContributors.mockResolvedValue([
    { ContributorID: '958', ContributorFullName: 'Pino Corrias', ContributorTypeID: '1', ContributorType: 'Συγγραφέας', PresentOrder: '1' },
    { ContributorID: '4040', ContributorFullName: 'Νέος Εικονογράφος', ContributorTypeID: '7', ContributorType: 'Εικονογράφος', PresentOrder: '2' },
  ]);
  biblionet.getPerson.mockRejectedValue(new Error('down'));

  const res = await lookup('0-8044-2957-X');
  expect(res.status).toBe(200);
  const roles = res.body.data.attributes.contributors.map((c) => c.role.data.attributes.name);
  expect(roles).toEqual(['Συγγραφέας', 'Εικονογράφος']);
  expect(await count('api::person.person', { biblionetPersonId: '958' })).toBe(1);
  expect(await count('api::publisher.publisher', { biblionetCompanyId: '212' })).toBe(1);
  // known person 958 and known publisher 212: no enrichment calls for them
  expect(biblionet.getPerson).toHaveBeenCalledTimes(1);
  expect(biblionet.getCompany).not.toHaveBeenCalled();
});

test('existing role with the same name but no Biblionet id is reused', async () => {
  await strapi.db.query('api::contributor-role.contributor-role').create({ data: { name: 'Επιμελητής' } });
  biblionet.searchByIsbn.mockResolvedValue({ ...fx.title, TitlesID: '556' });
  biblionet.getContributors.mockResolvedValue([
    { ContributorID: '958', ContributorFullName: 'Pino Corrias', ContributorTypeID: '9', ContributorType: 'Επιμελητής', PresentOrder: '1' },
  ]);
  const res = await lookup('978-0-306-40615-7');
  expect(res.status).toBe(200);
  const role = await strapi.db.query('api::contributor-role.contributor-role').findOne({ where: { name: 'Επιμελητής' } });
  expect(role.biblionetTypeId).toBe('9');
});

test('a second ISBN of a title already in the catalog returns the catalog record (review #3)', async () => {
  // fx.title (TitlesID 72584) was imported earlier in this file under 9789602116524
  biblionet.searchByIsbn.mockResolvedValue({ ...fx.title, ISBN_2: '978-1-4028-9462-6' });
  const before = await count('api::book.book');
  const res = await lookup('978-1-4028-9462-6');
  expect(res.status).toBe(200);
  expect(res.body.source).toBe('catalog');
  expect(res.body.data.attributes.biblionetId).toBe('72584');
  expect(await count('api::book.book')).toBe(before);
  expect(biblionet.getContributors).not.toHaveBeenCalled();
  expect(quota.getUsage().used).toBe(1);
});

test('not found as ISBN-13 → retried once as ISBN-10 (review #6)', async () => {
  biblionet.searchByIsbn.mockImplementation(async (isbn) => (isbn === '0132350882' ? { ...fx.title, TitlesID: '888' } : null));
  const res = await lookup('978-0-13-235088-4');
  expect(res.status).toBe(200);
  expect(res.body.source).toBe('biblionet');
  expect(res.body.data.attributes.isbn).toBe('9780132350884');
  expect(biblionet.searchByIsbn.mock.calls.map((c) => c[0])).toEqual(['9780132350884', '0132350882']);
});

test('979 ISBNs are not retried', async () => {
  biblionet.searchByIsbn.mockResolvedValue(null);
  const res = await lookup('9791032305690');
  expect(res.body.source).toBe('not-found');
  expect(biblionet.searchByIsbn).toHaveBeenCalledTimes(1);
});

test('import with no contributors goes to the review queue', async () => {
  biblionet.searchByIsbn.mockResolvedValue({ ...fx.title, TitlesID: '901' });
  biblionet.getContributors.mockResolvedValue([]);
  const res = await lookup('978-1-56619-909-4');
  expect(res.status).toBe(200);
  expect(res.body.source).toBe('biblionet');
  expect(res.body.data.attributes.reviewed).toBe(false);
});

test('import with no subjects goes to the review queue', async () => {
  biblionet.searchByIsbn.mockResolvedValue({ ...fx.title, TitlesID: '902' });
  biblionet.getSubjects.mockResolvedValue([]);
  const res = await lookup('978-0-596-52068-7');
  expect(res.status).toBe(200);
  expect(res.body.data.attributes.reviewed).toBe(false);
});

describe('quota is enforced during an import (deferred minor #6)', () => {
  const newContributors = [
    { ContributorID: '7001', ContributorFullName: 'Νέο Πρόσωπο Α', ContributorTypeID: '1', ContributorType: 'Συγγραφέας', PresentOrder: '1' },
  ];

  test('quota running out on a core call → 429, nothing stored, limit not exceeded', async () => {
    const { limit } = quota.getUsage();
    quota.increment(limit - 2);
    biblionet.searchByIsbn.mockResolvedValue({ ...fx.title, TitlesID: '903' });
    biblionet.getContributors.mockResolvedValue(newContributors);
    const res = await lookup('978-0-14-044913-6');
    expect(res.status).toBe(429);
    expect(biblionet.getSubjects).not.toHaveBeenCalled();
    expect(await count('api::book.book', { biblionetId: '903' })).toBe(0);
    expect(quota.getUsage().used).toBe(limit);
  });

  test('quota running out on enrichment → import succeeds with names only', async () => {
    const { limit } = quota.getUsage();
    quota.increment(limit - 3);
    biblionet.searchByIsbn.mockResolvedValue({ ...fx.title, TitlesID: '904' });
    biblionet.getContributors.mockResolvedValue(newContributors);
    const res = await lookup('978-0-451-52493-5');
    expect(res.status).toBe(200);
    expect(biblionet.getPerson).not.toHaveBeenCalled();
    expect(res.body.data.attributes.contributors[0].person.data.attributes.name).toBe('Νέο Πρόσωπο Α');
    expect(quota.getUsage().used).toBe(limit);
  });
});
