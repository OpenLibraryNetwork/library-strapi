'use strict';

const request = require('supertest');

let counter = 0;

/** Super-admin session token for Content Manager requests (/content-manager/...). */
async function adminToken(strapi) {
  counter += 1;
  const email = `admin${counter}_${Date.now()}@test.local`;
  const password = 'Admin1234!';
  const superAdmin = await strapi.db.query('admin::role').findOne({ where: { code: 'strapi-super-admin' } });
  await strapi.service('admin::user').create({
    email, firstname: 'Test', lastname: 'Admin', password, isActive: true, roles: [superAdmin.id],
  });
  const res = await request(strapi.server.httpServer).post('/admin/login').send({ email, password });
  if (res.status !== 200) throw new Error(`admin login ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data.token;
}

module.exports = { adminToken };
