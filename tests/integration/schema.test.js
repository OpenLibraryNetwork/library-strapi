'use strict';

const docs = require('../helpers/docs');
const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');

beforeAll(async () => { await setupStrapi(); });
afterAll(async () => { await cleanupStrapi(); });

const es = () => docs;

test('default contributor roles are seeded', async () => {
  const roles = await es().findMany('api::contributor-role.contributor-role', { sort: 'biblionetTypeId' });
  expect(roles.map((r) => [r.biblionetTypeId, r.name])).toEqual([['1', 'Συγγραφέας'], ['2', 'Μεταφραστής']]);
});

test('two books can share a contributor and be filtered by person (spec open item 1)', async () => {
  const [author] = await es().findMany('api::contributor-role.contributor-role', { filters: { biblionetTypeId: '1' } });
  const person = await es().create('api::person.person', { data: { name: 'Νίκη Λοϊζίδη' } });
  const other = await es().create('api::person.person', { data: { name: 'Άλλο Πρόσωπο' } });

  const b1 = await es().create('api::book.book', {
    data: { title: 'Α', type: 'Μπροσούρα', contributors: [{ person: person.id, role: author.id }] },
  });
  const b2 = await es().create('api::book.book', {
    data: { title: 'Β', type: 'Μπροσούρα', contributors: [{ person: person.id, role: author.id }, { person: other.id, role: author.id }] },
  });
  await es().create('api::book.book', {
    data: { title: 'Γ', type: 'Μπροσούρα', contributors: [{ person: other.id, role: author.id }] },
  });

  const found = await es().findMany('api::book.book', {
    filters: { contributors: { person: { id: person.id } } },
    sort: 'id',
  });
  expect(found.map((b) => b.id)).toEqual([b1.id, b2.id]);

  const populated = await es().findOne('api::book.book', b2.id, {
    populate: { contributors: { populate: ['person', 'role'] } },
  });
  expect(populated.contributors.map((c) => c.person.name)).toEqual(['Νίκη Λοϊζίδη', 'Άλλο Πρόσωπο']);
  expect(populated.contributors[0].role.name).toBe('Συγγραφέας');
});

test('many records can point to the same library', async () => {
  const library = await es().create('api::library.library', { data: { name: 'Βιβλιοθήκη Α' } });
  const p1 = await es().create('api::person.person', { data: { name: 'Π1', catalogedBy: library.id } });
  const p2 = await es().create('api::person.person', { data: { name: 'Π2', catalogedBy: library.id } });
  const both = await es().findMany('api::person.person', {
    filters: { id: { $in: [p1.id, p2.id] } },
    populate: ['catalogedBy'],
  });
  expect(both.every((p) => p.catalogedBy.id === library.id)).toBe(true);
});
