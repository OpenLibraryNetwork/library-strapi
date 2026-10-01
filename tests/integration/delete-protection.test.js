'use strict';

const docs = require('../helpers/docs');
const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');

beforeAll(async () => { await setupStrapi(); });
afterAll(async () => { await cleanupStrapi(); });

const es = () => docs;
const PERSON = 'api::person.person';
const PUBLISHER = 'api::publisher.publisher';
const BOOK = 'api::book.book';
const ROLE = 'api::contributor-role.contributor-role';
const SUBJECT = 'api::subject.subject';
const COPY = 'api::copy.copy';

let role;
beforeAll(async () => {
  [role] = await es().findMany(ROLE, { filters: { biblionetTypeId: '1' } });
});

test('person used as contributor cannot be deleted; unused can', async () => {
  const used = await es().create(PERSON, { data: { name: 'Χρησιμοποιούμενο' } });
  const unused = await es().create(PERSON, { data: { name: 'Αχρησιμοποίητο' } });
  await es().create(BOOK, { data: { title: 'Β1', type: 'Μπροσούρα', contributors: [{ person: used.id, role: role.id }] } });

  await expect(es().delete(PERSON, used.id)).rejects.toThrow('συγχώνευση');
  await es().delete(PERSON, unused.id);
  expect(await es().findOne(PERSON, unused.id)).toBeNull();
});

test('deleteMany is protected too', async () => {
  const used = await es().create(PERSON, { data: { name: 'Χρήση Πολλαπλή' } });
  const free = await es().create(PERSON, { data: { name: 'Ελεύθερο Πολλαπλό' } });
  await es().create(BOOK, { data: { title: 'Β2', type: 'Μπροσούρα', contributors: [{ person: used.id, role: role.id }] } });
  await expect(
    strapi.db.query(PERSON).deleteMany({ where: { id: { $in: [used.id, free.id] } } })
  ).rejects.toThrow('συγχώνευση');
});

test('publisher used by a book or only by a magazine cannot be deleted', async () => {
  const p1 = await es().create(PUBLISHER, { data: { name: 'Εκδότης Βιβλίου' } });
  const p2 = await es().create(PUBLISHER, { data: { name: 'Εκδότης Περιοδικού' } });
  await es().create(BOOK, { data: { title: 'Β3', type: 'Μπροσούρα', publisher: p1.id } });
  await es().create('api::magazine.magazine', { data: { title: 'Περιοδικό Α', publisher: p2.id } });
  await expect(es().delete(PUBLISHER, p1.id)).rejects.toThrow('συγχώνευση');
  await expect(es().delete(PUBLISHER, p2.id)).rejects.toThrow('συγχώνευση');
});

test('role and subject in use cannot be deleted', async () => {
  const subject = await es().create(SUBJECT, { data: { subjectTitle: 'Θέμα σε χρήση' } });
  await es().create(BOOK, { data: { title: 'Β4', type: 'Μπροσούρα', subjects: [subject.id] } });
  await expect(es().delete(ROLE, role.id)).rejects.toThrow('συγχώνευση');
  await expect(es().delete(SUBJECT, subject.id)).rejects.toThrow('συγχώνευση');
});

test('book with copies cannot be deleted; without copies can', async () => {
  const withCopies = await es().create(BOOK, { data: { title: 'Β5', type: 'Μπροσούρα' } });
  const empty = await es().create(BOOK, { data: { title: 'Β6', type: 'Μπροσούρα' } });
  await es().create(COPY, { data: { copyNumber: 1, publication: withCopies.id } });
  await expect(es().delete(BOOK, withCopies.id)).rejects.toThrow('αντίτυπα');
  await es().delete(BOOK, empty.id);
});

test('copy cannot move to another publication, except during a merge', async () => {
  const { runAsMerge } = require('../../src/utils/merge-context');
  const a = await es().create(BOOK, { data: { title: 'Β7', type: 'Μπροσούρα' } });
  const b = await es().create(BOOK, { data: { title: 'Β8', type: 'Μπροσούρα' } });
  const copy = await es().create(COPY, { data: { copyNumber: 1, publication: a.id } });

  await expect(es().update(COPY, copy.id, { data: { publication: b.id } })).rejects.toThrow('έντυπο');
  await es().update(COPY, copy.id, { data: { condition: 'GOOD', publication: a.id } });
  await runAsMerge(() => es().update(COPY, copy.id, { data: { publication: b.id } }));
  const moved = await es().findOne(COPY, copy.id, { populate: ['publication'] });
  expect(moved.publication.id).toBe(b.id);
});

test('a borrowed copy cannot be deleted (Review Focus 4)', async () => {
  const book = await es().create(BOOK, { data: { title: 'Β9', type: 'Μπροσούρα' } });
  const borrowed = await es().create(COPY, { data: { copyNumber: 1, publication: book.id, isAvailable: false } });
  await expect(es().delete(COPY, borrowed.id)).rejects.toThrow('δανεισμένο');
  await expect(
    strapi.db.query(COPY).deleteMany({ where: { id: { $in: [borrowed.id] } } })
  ).rejects.toThrow('δανεισμένο');
  const available = await es().create(COPY, { data: { copyNumber: 2, publication: book.id } });
  await es().delete(COPY, available.id);
  expect(await es().findOne(COPY, available.id)).toBeNull();
});
