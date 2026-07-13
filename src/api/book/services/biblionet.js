'use strict';

const https = require('https');

/**
 * Biblionet API service
 * Documentation: https://biblionet.gr/webservice
 *
 * Response formats:
 * - get_title with ISBN: returns single object {...}
 * - get_title with other params: returns nested array [[{...}]]
 * - get_contributors: returns nested array [[{...}]]
 */

/**
 * Make a POST request to Biblionet API
 */
function postBiblionet(endpoint, body) {
  return new Promise((resolve, reject) => {
    const url = `${process.env.BIBLIONET_API_URL}/${endpoint}`;
    const postData = JSON.stringify(body);

    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (err) {
          reject(new Error(`Biblionet API returned invalid JSON: ${data.substring(0, 200)}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Biblionet API request failed: ${err.message}`));
    });

    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Biblionet API request timed out'));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Extract data from Biblionet response.
 * Handles both formats:
 * - Nested array: [[{...}]] → extracts first element
 * - Single object: {...} → returns as-is
 * - Empty/error: returns null
 */
function extractData(response) {
  if (!response) return null;

  // Handle nested array format [[{...}]]
  if (Array.isArray(response)) {
    const inner = response[0];
    if (Array.isArray(inner)) {
      return inner.length > 0 ? inner[0] : null;
    }
    return inner || null;
  }

  // Handle single object format {...}
  if (typeof response === 'object' && response.TitlesID) {
    return response;
  }

  return null;
}

/**
 * Extract ALL items from Biblionet response (for contributors which may have multiple).
 * Handles: [[{...}, {...}]] → returns array of items
 */
function extractAllData(response) {
  if (!response) return [];

  if (Array.isArray(response)) {
    const inner = response[0];
    if (Array.isArray(inner)) {
      return inner;
    }
    return [inner].filter(Boolean);
  }

  if (typeof response === 'object') {
    return [response];
  }

  return [];
}

/**
 * Filter contributors to get only authors (ContributorTypeID === "1")
 */
function filterAuthors(contributors) {
  return contributors.filter(
    (c) => String(c.ContributorTypeID) === '1'
  );
}

module.exports = {
  /**
   * Search Biblionet by ISBN
   * @param {string} isbn - ISBN (with or without dashes)
   * @returns {object|null} Book data or null
   */
  async searchByIsbn(isbn) {
    const response = await postBiblionet('get_title', {
      username: process.env.BIBLIONET_USER,
      password: process.env.BIBLIONET_PASS,
      isbn: isbn.replace(/-/g, ''),
    });
    return extractData(response);
  },

  /**
   * Get contributors for a title
   * @param {string} titlesId - Biblionet TitlesID
   * @returns {Array} Array of contributor objects
   */
  async getContributors(titlesId) {
    const response = await postBiblionet('get_contributors', {
      username: process.env.BIBLIONET_USER,
      password: process.env.BIBLIONET_PASS,
      title: titlesId,
    });
    return extractAllData(response);
  },

  /**
   * Get subjects for a title (DDC classification)
   * @param {string} titlesId - Biblionet TitlesID
   * @returns {Array} Array of subject objects
   */
  async getSubjects(titlesId) {
    const response = await postBiblionet('get_title_subject', {
      username: process.env.BIBLIONET_USER,
      password: process.env.BIBLIONET_PASS,
      title: titlesId,
    });
    return extractAllData(response);
  },

  /**
   * Get person details (author enrichment)
   * @param {string} personId - Biblionet PersonsID
   * @returns {object|null} Person data or null
   */
  async getPerson(personId) {
    const response = await postBiblionet('get_person', {
      username: process.env.BIBLIONET_USER,
      password: process.env.BIBLIONET_PASS,
      person: personId,
    });
    return extractData(response);
  },

  /**
   * Get company details (publisher enrichment)
   * @param {string} companyId - Biblionet ComID
   * @returns {object|null} Company data or null
   */
  async getCompany(companyId) {
    const response = await postBiblionet('get_company', {
      username: process.env.BIBLIONET_USER,
      password: process.env.BIBLIONET_PASS,
      company: companyId,
    });
    return extractData(response);
  },

  /**
   * Download an image from a URL and return a Buffer
   * @param {string} imageUrl - Full URL of the image
   * @returns {Promise<Buffer>} Image data
   */
  downloadImage(imageUrl) {
    return new Promise((resolve, reject) => {
      https.get(imageUrl, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to download image: Status Code ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve(Buffer.concat(chunks));
        });
      }).on('error', (err) => {
        reject(err);
      });
    });
  },

  extractData,
  extractAllData,
  filterAuthors,
};
