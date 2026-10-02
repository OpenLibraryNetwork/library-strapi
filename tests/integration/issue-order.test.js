'use strict';

const request = require('supertest');
const docs = require('../helpers/docs');
const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');
const { createLibrarian } = require('../helpers/auth');

const BOOK = 'api::book.book';
let magazine;

beforeAll(async () => {
  await setupStrapi();
  magazine = await docs.create('api::magazine.magazine', { data: { title: 'Περιοδικό Σειράς' } });
});
afterAll(async () => { await cleanupStrapi(); });

const orderOf = async (documentId) =>
  (await strapi.db.query(BOOK).findOne({ where: { documentId }, select: ['issueOrder'] })).issueOrder;
const issue = (data) => docs.create(BOOK, { data: { title: 'Περιοδικό Σειράς', type: 'Περιοδικό', magazine: magazine.id, ...data } });

test('computed on create and update; a value sent by a client is ignored', async () => {
  const a = await issue({ issueNumber: 'τχ. 05', issueOrder: 999 });
  expect(await orderOf(a.documentId)).toBe(5);
  await strapi.documents(BOOK).update({ documentId: a.documentId, data: { issueNumber: '12-13' } });
  expect(await orderOf(a.documentId)).toBe(12);
  const b = await issue({ issueNumber: null, publicationMonthYear: 'Ειδικό τεύχος 2025' });
  expect(await orderOf(b.documentId)).toBe(0);
});

test('books and brochures have no issueOrder', async () => {
  const brochure = await docs.create(BOOK, { data: { title: 'Μπροσούρα Σειράς', type: 'Μπροσούρα' } });
  expect(await orderOf(brochure.documentId)).toBeNull();
});

test('never part of a response', async () => {
  const a = await issue({ issueNumber: '3' });
  const { jwt } = await createLibrarian(strapi);
  const res = await request(strapi.server.httpServer).get(`/api/books/${a.documentId}`).set('Authorization', `Bearer ${jwt}`);
  expect(res.status).toBe(200);
  expect(res.body.data).not.toHaveProperty('issueOrder');
});

test('backfill fills missing values once and is idempotent', async () => {
  const { backfillIssueOrder } = require('../../src/bootstrap/issue-order');
  const a = await issue({ issueNumber: '42' });
  const meta = strapi.db.metadata.get(BOOK);
  await strapi.db.connection(meta.tableName).where({ id: a.id }).update({ [meta.attributes.issueOrder.columnName]: null });
  const before = await strapi.db.query(BOOK).findOne({ where: { id: a.id } });

  expect(await backfillIssueOrder(strapi)).toBe(1);
  const after = await strapi.db.query(BOOK).findOne({ where: { id: a.id } });
  expect(after.issueOrder).toBe(42);
  expect({ ...after, issueOrder: null, updatedAt: null }).toEqual({ ...before, issueOrder: null, updatedAt: null });
  expect(await backfillIssueOrder(strapi)).toBe(0);
});
