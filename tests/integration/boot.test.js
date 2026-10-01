'use strict';

const { setupStrapi, cleanupStrapi } = require('../helpers/strapi');

beforeAll(async () => { await setupStrapi(); });
afterAll(async () => { await cleanupStrapi(); });

test('strapi boots with the test database', () => {
  expect(strapi).toBeDefined();
  expect(strapi.config.get('database.connection.client')).toBe('sqlite');
});
