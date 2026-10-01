'use strict';

const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');

beforeAll(async () => { await setupStrapi(); });
afterAll(async () => { await cleanupStrapi(); });

const permissionsOf = async (roleId) =>
  strapi.query('admin::permission').findMany({ where: { role: { id: roleId } } });

test('cataloguer role exists with the right content-manager permissions', async () => {
  const role = await strapi.query('admin::role').findOne({ where: { code: 'catalog-cataloguer' } });
  expect(role.name).toBe('Καταλογογράφος');

  const perms = await permissionsOf(role.id);
  const has = (action, subject) => perms.some((p) => p.action === `plugin::content-manager.explorer.${action}` && p.subject === subject);

  for (const subject of ['api::book.book', 'api::person.person', 'api::publisher.publisher', 'api::subject.subject', 'api::contributor-role.contributor-role', 'api::magazine.magazine']) {
    for (const action of ['create', 'read', 'update', 'delete']) {
      expect([subject, action, has(action, subject)]).toEqual([subject, action, true]);
    }
  }
  for (const subject of ['api::library.library', 'api::copy.copy']) {
    expect(has('read', subject)).toBe(true);
    expect(has('update', subject)).toBe(false);
    expect(has('delete', subject)).toBe(false);
  }
  expect(perms.some((p) => p.subject === 'plugin::users-permissions.user')).toBe(false);
});

test('book read permission includes component fields', async () => {
  const role = await strapi.query('admin::role').findOne({ where: { code: 'catalog-cataloguer' } });
  const read = (await permissionsOf(role.id)).find(
    (p) => p.action === 'plugin::content-manager.explorer.read' && p.subject === 'api::book.book'
  );
  expect(read.properties.fields).toEqual(expect.arrayContaining(['title', 'contributors.person', 'contributors.role', 'mergeInto', 'reviewed']));
});

test('seeding is idempotent', async () => {
  const { seedCataloguerRole } = require('../../src/bootstrap/seed');
  const before = await strapi.query('admin::role').count();
  await seedCataloguerRole(strapi);
  expect(await strapi.query('admin::role').count()).toBe(before);
});

test('an existing cataloguer role (seeded before 2γ) gets the magazine permissions', async () => {
  const role = await strapi.query('admin::role').findOne({ where: { code: 'catalog-cataloguer' } });
  const stale = (await permissionsOf(role.id)).filter((p) => p.subject === 'api::magazine.magazine');
  expect(stale.length).toBeGreaterThan(0);
  await strapi.query('admin::permission').deleteMany({ where: { id: { $in: stale.map((p) => p.id) } } });
  expect((await permissionsOf(role.id)).some((p) => p.subject === 'api::magazine.magazine')).toBe(false);
  // a role from before 2γ has no seeding marker
  await strapi.store({ type: 'core', name: 'library', key: 'cataloguer-seeded-subjects' }).delete();
  const { seedCataloguerRole } = require('../../src/bootstrap/seed');
  await seedCataloguerRole(strapi);
  const perms = await permissionsOf(role.id);
  for (const action of ['create', 'read', 'update', 'delete']) {
    expect(perms.some((p) => p.action === `plugin::content-manager.explorer.${action}` && p.subject === 'api::magazine.magazine')).toBe(true);
  }
});

test('a permission the administrator removed on purpose is not added back (2γ minor M-7)', async () => {
  const { seedCataloguerRole } = require('../../src/bootstrap/seed');
  const role = await strapi.query('admin::role').findOne({ where: { code: 'catalog-cataloguer' } });
  const copyRead = (await permissionsOf(role.id)).filter((p) => p.subject === 'api::copy.copy');
  expect(copyRead.length).toBeGreaterThan(0);
  await strapi.query('admin::permission').deleteMany({ where: { id: { $in: copyRead.map((p) => p.id) } } });
  await seedCataloguerRole(strapi);
  expect((await permissionsOf(role.id)).some((p) => p.subject === 'api::copy.copy')).toBe(false);
});
