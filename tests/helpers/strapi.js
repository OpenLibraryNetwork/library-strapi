'use strict';

const fs = require('fs');
const Strapi = require('@strapi/strapi');

let instance;

async function setupStrapi() {
  if (!instance) {
    process.env.NODE_ENV = 'test';
    await Strapi({ appDir: process.cwd(), distDir: process.cwd() }).load();
    instance = global.strapi;
    await instance.server.mount();
  }
  return instance;
}

// Bootstrap code may leave un-awaited queries running; closing the pool under them aborts the process.
async function waitForIdlePool(timeoutMs = 5000) {
  const pool = instance.db.connection.client.pool;
  const started = Date.now();
  while (pool && (pool.numPendingAcquires() > 0 || pool.numUsed() > 0) && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function cleanupStrapi() {
  if (!instance) return;
  const filename = instance.config.get('database.connection.connection.filename');
  await waitForIdlePool();
  await instance.destroy();
  instance = undefined;
  if (filename && fs.existsSync(filename)) fs.unlinkSync(filename);
}

module.exports = { setupStrapi, cleanupStrapi };
