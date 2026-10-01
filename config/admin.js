module.exports = ({ env }) => ({
  auth: {
    secret: env('ADMIN_JWT_SECRET'),
  },
  apiToken: {
    salt: env('API_TOKEN_SALT'),
  },
  transfer: {
    token: {
      salt: env('TRANSFER_TOKEN_SALT'),
    },
  },
  secrets: {
    // Strapi 5: encrypts API tokens so they can be viewed again in the admin (set ENCRYPTION_KEY in .env)
    encryptionKey: env('ENCRYPTION_KEY'),
  },
  flags: {
    nps: false, // disables surveys
    promoteEE: false, // disables promotion of enterprise edition
  },
});
