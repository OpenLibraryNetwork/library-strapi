'use strict';

const LIBRARIAN_ACTIONS = [
  'api::book.book.find',
  'api::book.book.findOne',
  'api::book.book.search',
  'api::book.book.isbnLookup',
  'api::book.book.createLocal',
  'api::person.person.find',
  'api::person.person.findOne',
  'api::person.person.search',
  'api::person.person.authors',
  'api::person.person.createLocal',
  'api::publisher.publisher.find',
  'api::publisher.publisher.findOne',
  'api::publisher.publisher.search',
  'api::publisher.publisher.inLibrary',
  'api::publisher.publisher.createLocal',
  'api::subject.subject.find',
  'api::subject.subject.findOne',
  'api::contributor-role.contributor-role.find',
  'api::contributor-role.contributor-role.findOne',
  'api::library.library.find',
  'api::library.library.findOne',
  'api::copy.copy.find',
  'api::copy.copy.findOne',
  'api::copy.copy.create',
  'api::copy.copy.update',
  'api::copy.copy.delete',
  'api::copy.copy.borrowCopy',
  'api::copy.copy.returnCopy',
  'api::magazine.magazine.find',
  'api::magazine.magazine.findOne',
  'api::magazine.magazine.search',
  'api::magazine.magazine.issnLookup',
  'api::magazine.magazine.createLocal',
  'api::magazine.magazine.inLibrary',
];

// Plugin actions the Librarian role always needs. Granted if missing, never removed by the sync.
// user.me: the JavaFX client checks a restored session with GET /api/users/me ("Online"/"Offline").
const LIBRARIAN_PLUGIN_ACTIONS = ['plugin::users-permissions.user.me'];

const PUBLIC_ACTIONS = [
  'api::book.book.find',
  'api::book.book.findOne',
  'api::book.book.search',
  'api::person.person.find',
  'api::person.person.findOne',
  'api::person.person.search',
  'api::publisher.publisher.find',
  'api::publisher.publisher.findOne',
  'api::publisher.publisher.search',
  'api::subject.subject.find',
  'api::subject.subject.findOne',
  'api::contributor-role.contributor-role.find',
  'api::contributor-role.contributor-role.findOne',
  'api::library.library.find',
  'api::library.library.findOne',
  'api::copy.copy.find',
  'api::copy.copy.findOne',
  'api::magazine.magazine.find',
  'api::magazine.magazine.findOne',
  'api::magazine.magazine.search',
];

const READ_CATALOG = [
  'api::book.book.find',
  'api::book.book.findOne',
  'api::person.person.find',
  'api::person.person.findOne',
  'api::publisher.publisher.find',
  'api::publisher.publisher.findOne',
  'api::subject.subject.find',
  'api::subject.subject.findOne',
  'api::contributor-role.contributor-role.find',
  'api::contributor-role.contributor-role.findOne',
  'api::library.library.find',
  'api::library.library.findOne',
  'api::copy.copy.find',
  'api::copy.copy.findOne',
  'api::magazine.magazine.find',
  'api::magazine.magazine.findOne',
];

const API_TOKENS = [
  {
    name: 'scraper',
    permissions: [
      ...READ_CATALOG,
      'api::book.book.create',
      'api::book.book.update',
      'api::person.person.create',
      'api::person.person.update',
      'api::publisher.publisher.create',
      'api::publisher.publisher.update',
      'api::copy.copy.create',
      'api::copy.copy.update',
      'api::magazine.magazine.create',
      'api::magazine.magazine.update',
      'api::subject.subject.create',
      'api::subject.subject.update',
    ],
  },
  { name: 'frontend', permissions: READ_CATALOG },
];

function actionExists(strapi, action) {
  const dot = action.lastIndexOf('.');
  const controller = strapi.controller(action.slice(0, dot));
  return Boolean(controller && typeof controller[action.slice(dot + 1)] === 'function');
}

async function findOrCreateRole(strapi, type, name, description) {
  const roles = strapi.db.query('plugin::users-permissions.role');
  const existing = await roles.findOne({ where: { type } });
  if (existing) return existing;
  return roles.create({ data: { type, name, description } });
}

async function syncRole(strapi, roleId, actions) {
  const perms = strapi.db.query('plugin::users-permissions.permission');
  const unknown = actions.filter((a) => !actionExists(strapi, a));
  if (unknown.length) strapi.log.warn(`Permissions skipped, no such controller action: ${unknown.join(', ')}`);
  const wanted = new Set(actions.filter((a) => !unknown.includes(a)));
  const current = await perms.findMany({ where: { role: roleId } });

  for (const p of current) {
    if (p.action.startsWith('api::') && !wanted.has(p.action)) {
      await perms.delete({ where: { id: p.id } });
    }
  }
  const have = new Set(current.map((p) => p.action));
  for (const action of wanted) {
    if (!have.has(action)) await perms.create({ data: { action, role: roleId } });
  }
}

async function ensurePluginActions(strapi, roleId, actions) {
  const perms = strapi.db.query('plugin::users-permissions.permission');
  for (const action of actions) {
    const existing = await perms.findOne({ where: { action, role: roleId } });
    if (!existing) await perms.create({ data: { action, role: roleId } });
  }
}

async function syncPermissions(strapi) {
  const librarian = await findOrCreateRole(strapi, 'librarian', 'Librarian', 'Βιβλιοθηκονόμος (JavaFX)');
  await syncRole(strapi, librarian.id, LIBRARIAN_ACTIONS);
  await ensurePluginActions(strapi, librarian.id, LIBRARIAN_PLUGIN_ACTIONS);

  const publicRole = await strapi.db.query('plugin::users-permissions.role').findOne({ where: { type: 'public' } });
  if (publicRole) await syncRole(strapi, publicRole.id, PUBLIC_ACTIONS);
}

async function ensureApiTokens(strapi) {
  const tokenService = strapi.service('admin::api-token');
  for (const spec of API_TOKENS) {
    if (await tokenService.exists({ name: spec.name })) continue;
    await tokenService.create({ name: spec.name, lifespan: null, type: 'custom', permissions: spec.permissions });
  }
}

module.exports = { LIBRARIAN_ACTIONS, PUBLIC_ACTIONS, syncPermissions, ensureApiTokens };
