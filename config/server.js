module.exports = ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  url: env('PUBLIC_URL', ''),
  // Production runs behind one reverse proxy: trust the address it adds to X-Forwarded-For, so the login
  // rate limit counts per visitor, not per proxy. Keep TRUST_PROXY off when Strapi is reachable directly.
  proxy: { koa: env.bool('TRUST_PROXY', false), maxIpsCount: 1 },
  app: {
    keys: env.array('APP_KEYS'),
  },
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },
});
