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

// The public site reads the catalogue with the "frontend" API token (server-side). Anonymous
// visitors get no api:: action; plugin actions (login) are not managed here and stay.
const PUBLIC_ACTIONS = [];

// Anonymous auth endpoints this system does not use: an administrator creates the librarians and resets
// their passwords, there is no email provider and no social login. Removed at every start, so enabling one
// in the admin panel does not last. Login (auth.callback) and auth.refresh stay.
const PUBLIC_CLOSED_PLUGIN_ACTIONS = [
  'plugin::users-permissions.auth.connect',
  'plugin::users-permissions.auth.register',
  'plugin::users-permissions.auth.forgotPassword',
  'plugin::users-permissions.auth.resetPassword',
  'plugin::users-permissions.auth.emailConfirmation',
  'plugin::users-permissions.auth.sendEmailConfirmation',
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

// The public site: single records (with their populate) and the paginated /api/catalog lists.
// The /search endpoints belong to the JavaFX librarians.
const FRONTEND_ACTIONS = [
  ...READ_CATALOG,
  'api::catalog.catalog.publications',
  'api::catalog.catalog.searchCounts',
  'api::catalog.catalog.persons',
  'api::catalog.catalog.publishers',
  'api::catalog.catalog.magazines',
  'api::catalog.catalog.libraries',
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
  { name: 'frontend', permissions: FRONTEND_ACTIONS },
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

async function removePluginActions(strapi, roleId, actions) {
  const perms = strapi.db.query('plugin::users-permissions.permission');
  for (const p of await perms.findMany({ where: { role: roleId, action: { $in: actions } } })) {
    await perms.delete({ where: { id: p.id } });
  }
}

async function syncPermissions(strapi) {
  const librarian = await findOrCreateRole(strapi, 'librarian', 'Librarian', 'Βιβλιοθηκονόμος (JavaFX)');
  await syncRole(strapi, librarian.id, LIBRARIAN_ACTIONS);
  await ensurePluginActions(strapi, librarian.id, LIBRARIAN_PLUGIN_ACTIONS);

  const publicRole = await strapi.db.query('plugin::users-permissions.role').findOne({ where: { type: 'public' } });
  if (publicRole) {
    await syncRole(strapi, publicRole.id, PUBLIC_ACTIONS);
    await removePluginActions(strapi, publicRole.id, PUBLIC_CLOSED_PLUGIN_ACTIONS);
  }
}

// Creates the API tokens defined here, or brings an existing one back to custom type with exactly
// these permissions. Its key does not change. Tokens not listed in API_TOKENS are never touched.
async function ensureApiTokens(strapi) {
  const tokenService = strapi.service('admin::api-token');
  for (const spec of API_TOKENS) {
    const unknown = spec.permissions.filter((a) => !actionExists(strapi, a));
    if (unknown.length) strapi.log.warn(`API token "${spec.name}": no such controller action: ${unknown.join(', ')}`);
    const permissions = spec.permissions.filter((a) => !unknown.includes(a));

    const existing = await tokenService.getByName(spec.name);
    if (!existing) {
      await tokenService.create({ name: spec.name, lifespan: null, type: 'custom', permissions });
      continue;
    }
    const have = [...(existing.permissions || [])].sort();
    const want = [...permissions].sort();
    if (existing.type !== 'custom' || JSON.stringify(have) !== JSON.stringify(want)) {
      await tokenService.update(existing.id, { type: 'custom', permissions });
    }
  }
}

module.exports = { LIBRARIAN_ACTIONS, PUBLIC_ACTIONS, FRONTEND_ACTIONS, syncPermissions, ensureApiTokens };
