'use strict';

async function createTokenIfNotExist(strapi, tokenSpec) {
  const tokenService = strapi.service('admin::api-token');
  if (tokenService && tokenService.create) {
    const tokenAlreadyExists = await tokenService.exists({
      name: tokenSpec.name,
    });
    if (tokenAlreadyExists) {
      console.info(`API token '${tokenSpec.name}' already exists, skipping...`);
    } else {
      const token = await tokenService.create(tokenSpec);
      if (token.accessKey) {
        console.info(`API token '${tokenSpec.name}' was created successfully`);
      }
    }
  }
}

/**
 * Grant permissions for custom routes to the Librarian role.
 * This ensures that logged-in librarian users (with JWT) can access
 * all necessary endpoints: catalog browsing, Biblionet search, borrow/return.
 */
async function grantAuthenticatedPermissions(strapi) {
  // All actions that librarian users need
  const librarianActions = [
    // Custom actions
    'api::book.book.searchBiblionet',
    'api::copy.copy.borrowCopy',
    'api::copy.copy.returnCopy',
    // Standard CRUD
    'api::book.book.find',
    'api::book.book.findOne',
    'api::book.book.create',
    'api::author.author.find',
    'api::author.author.findOne',
    'api::author.author.create',
    'api::publisher.publisher.find',
    'api::publisher.publisher.findOne',
    'api::publisher.publisher.create',
    'api::copy.copy.find',
    'api::copy.copy.findOne',
    'api::copy.copy.create',
    'api::copy.copy.update',
    'api::copy.copy.delete',
    'api::magazine.magazine.find',
    'api::magazine.magazine.findOne',
    'api::magazine.magazine.create',
    'api::library.library.find',
    'api::library.library.findOne',
    'api::subject.subject.find',
    'api::subject.subject.findOne',
    'api::subject.subject.create',
  ];

  try {
    // Find the Librarian role (custom role)
    const librarianRole = await strapi
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: 'librarian' } });

    if (!librarianRole) {
      // Fallback: try by name
      const roleByName = await strapi
        .query('plugin::users-permissions.role')
        .findOne({ where: { name: 'Librarian' } });

      if (!roleByName) {
        console.warn('Librarian role not found — skipping permission setup. Create it in admin panel.');
        return;
      }
      await applyPermissions(strapi, roleByName.id, librarianActions);
      return;
    }

    await applyPermissions(strapi, librarianRole.id, librarianActions);
  } catch (error) {
    console.error('Failed to set up permissions:', error.message);
  }
}

async function applyPermissions(strapi, roleId, actions) {
  for (const action of actions) {
    const existingPermission = await strapi
      .query('plugin::users-permissions.permission')
      .findOne({
        where: {
          action: action,
          role: roleId,
        },
      });

    if (!existingPermission) {
      await strapi.query('plugin::users-permissions.permission').create({
        data: {
          action: action,
          role: roleId,
        },
      });
      console.info(`Permission '${action}' granted to Librarian role`);
    }
  }
}

async function grantPublicPermissions(strapi) {
  const publicActions = [
    'api::author.author.find',
    'api::author.author.findOne',
    'api::book.book.find',
    'api::book.book.findOne',
    'api::library.library.find',
    'api::library.library.findOne',
    'api::publisher.publisher.find',
    'api::publisher.publisher.findOne',
    'api::copy.copy.find',
    'api::copy.copy.findOne',
    'api::magazine.magazine.find',
    'api::magazine.magazine.findOne',
    'api::subject.subject.find',
    'api::subject.subject.findOne',
  ];

  try {
    const publicRole = await strapi
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: 'public' } });

    if (!publicRole) {
      console.warn('Public role not found — skipping public permission setup.');
      return;
    }

    // Reuse applyPermissions to grant access
    for (const action of publicActions) {
      const existingPermission = await strapi
        .query('plugin::users-permissions.permission')
        .findOne({
          where: {
            action: action,
            role: publicRole.id,
          },
        });

      if (!existingPermission) {
        await strapi.query('plugin::users-permissions.permission').create({
          data: {
            action: action,
            role: publicRole.id,
          },
        });
        console.info(`Permission '${action}' granted to Public role`);
      }
    }
  } catch (error) {
    console.error('Failed to set up public permissions:', error.message);
  }
}

module.exports = {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   */
  register({ strapi }) {
    const userSchema = strapi.contentType('plugin::users-permissions.user');
    if (userSchema) {
      userSchema.attributes.library = {
        type: 'relation',
        relation: 'manyToOne',
        target: 'api::library.library',
      };
    }
  },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   */
  async bootstrap({ strapi }) {
    // Grant permissions for custom routes to Authenticated role
    await grantAuthenticatedPermissions(strapi);

    // Grant read permissions to Public role
    await grantPublicPermissions(strapi);

    // Token for Biblionet scraper / admin operations
    createTokenIfNotExist(strapi, {
      name: 'scraper',
      lifespan: null,
      type: 'custom',
      permissions: [
        'api::book.book.find',
        'api::book.book.findOne',
        'api::book.book.create',
        'api::book.book.update',
        'api::author.author.find',
        'api::author.author.findOne',
        'api::author.author.create',
        'api::author.author.update',
        'api::publisher.publisher.find',
        'api::publisher.publisher.findOne',
        'api::publisher.publisher.create',
        'api::publisher.publisher.update',
        'api::copy.copy.find',
        'api::copy.copy.findOne',
        'api::copy.copy.create',
        'api::copy.copy.update',
        'api::magazine.magazine.find',
        'api::magazine.magazine.findOne',
        'api::magazine.magazine.create',
        'api::magazine.magazine.update',
        'api::subject.subject.find',
        'api::subject.subject.findOne',
        'api::subject.subject.create',
        'api::subject.subject.update',
      ],
    });

    // Token for JavaFX desktop client (read-only catalog + copy management)
    createTokenIfNotExist(strapi, {
      name: 'frontend',
      lifespan: null,
      type: 'custom',
      permissions: [
        'api::author.author.find',
        'api::author.author.findOne',
        'api::book.book.find',
        'api::book.book.findOne',
        'api::library.library.find',
        'api::library.library.findOne',
        'api::publisher.publisher.find',
        'api::publisher.publisher.findOne',
        'api::copy.copy.find',
        'api::copy.copy.findOne',
        'api::magazine.magazine.find',
        'api::magazine.magazine.findOne',
        'api::subject.subject.find',
        'api::subject.subject.findOne',
      ],
    });
  },
};

