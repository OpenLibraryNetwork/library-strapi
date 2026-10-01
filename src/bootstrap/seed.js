'use strict';

const DEFAULT_ROLES = [
  { name: 'Συγγραφέας', biblionetTypeId: '1' },
  { name: 'Μεταφραστής', biblionetTypeId: '2' },
];

async function seedContributorRoles(strapi) {
  const query = strapi.db.query('api::contributor-role.contributor-role');
  for (const role of DEFAULT_ROLES) {
    const existing = await query.findOne({ where: { biblionetTypeId: role.biblionetTypeId } });
    if (!existing) await query.create({ data: role });
  }
}

const CATALOGUER_ROLE = {
  name: 'Καταλογογράφος',
  code: 'catalog-cataloguer',
  description: 'Διορθώνει, συγχωνεύει και διαγράφει εγγραφές του συλλογικού καταλόγου.',
};

const CATALOG_SUBJECTS = [
  'api::book.book',
  'api::person.person',
  'api::publisher.publisher',
  'api::subject.subject',
  'api::contributor-role.contributor-role',
  'api::magazine.magazine',
];
const READ_ONLY_SUBJECTS = ['api::library.library', 'api::copy.copy'];

function cataloguerPermissions(strapi, subjectsFilter = () => true) {
  const { actionProvider } = strapi.admin.services.permission;
  const contentTypeService = strapi.admin.services['content-type'];
  const grants = [
    ...['create', 'read', 'update', 'delete'].map((a) => [`plugin::content-manager.explorer.${a}`, CATALOG_SUBJECTS.filter(subjectsFilter)]),
    ['plugin::content-manager.explorer.read', READ_ONLY_SUBJECTS.filter(subjectsFilter)],
  ];
  const permissions = [];
  for (const [actionId, subjects] of grants) {
    if (!subjects.length) continue;
    const action = actionProvider.get(actionId);
    permissions.push(...contentTypeService.getPermissionsWithNestedFields([{ ...action, subjects }]));
  }
  return permissions;
}

async function seedCataloguerRole(strapi) {
  const roleService = strapi.admin.services.role;
  // Subjects already seeded are remembered, so a permission the administrator removes on purpose stays removed;
  // only content types added later (e.g. magazines in 2γ) are granted to an existing role.
  const marker = strapi.store({ type: 'core', name: 'library', key: 'cataloguer-seeded-subjects' });
  const allSubjects = [...CATALOG_SUBJECTS, ...READ_ONLY_SUBJECTS];
  const existing = await strapi.query('admin::role').findOne({ where: { code: CATALOGUER_ROLE.code } });
  if (existing) {
    let seeded = await marker.get();
    if (!Array.isArray(seeded)) {
      // Role from before the marker: whatever it has now counts as seeded.
      const have = await strapi.query('admin::permission').findMany({ where: { role: { id: existing.id } } });
      seeded = [...new Set(have.map((p) => p.subject))];
    }
    const missing = cataloguerPermissions(strapi, (subject) => !seeded.includes(subject));
    if (missing.length) await roleService.addPermissions(existing.id, missing);
    await marker.set({ value: allSubjects });
    return existing;
  }
  const role = await roleService.create(CATALOGUER_ROLE);
  await roleService.assignPermissions(role.id, cataloguerPermissions(strapi));
  await marker.set({ value: allSubjects });
  return role;
}

module.exports = { seedContributorRoles, seedCataloguerRole };
