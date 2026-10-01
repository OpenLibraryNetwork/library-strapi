'use strict';

const http = require('http');
const https = require('https');
const mapper = require('./nlg-mapper');
const { NlgUnavailableError } = require('../../../utils/catalog-errors');

const BASE_URL = process.env.NLG_CATALOGUE_URL || 'https://catalogue.nlg.gr';
const TIMEOUT_MS = Number(process.env.NLG_TIMEOUT_MS) || 10000;
const USER_AGENT = 'LibraryManagementSystem/1.0 (library network union catalogue)';

/**
 * GET with a hard deadline: min(TIMEOUT_MS, time left until `deadline`). Every failure (network,
 * timeout, connection cut mid-response) is an NlgUnavailableError; nothing is left pending.
 */
function httpGet(path, accept, deadline) {
  return new Promise((resolve, reject) => {
    const budget = Math.min(TIMEOUT_MS, deadline ? deadline - Date.now() : TIMEOUT_MS);
    if (budget <= 0) {
      reject(new NlgUnavailableError('timeout'));
      return;
    }
    let settled = false;
    let req;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (req) req.destroy();
      reject(err instanceof NlgUnavailableError ? err : new NlgUnavailableError(err.message));
    };
    const timer = setTimeout(() => fail(new NlgUnavailableError('timeout')), budget);
    try {
      const url = new URL(`${BASE_URL}${path}`);
      const client = url.protocol === 'http:' ? http : https;
      req = client.get(url, { headers: { Accept: accept, 'User-Agent': USER_AGENT } }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ status: res.statusCode, body });
        });
        res.on('error', fail);
        res.on('close', () => {
          if (!res.complete) fail(new NlgUnavailableError('η σύνδεση διακόπηκε'));
        });
      });
      req.on('error', fail);
    } catch (err) {
      fail(err);
    }
  });
}

/** Serial records whose ISSN index matches; biblionumbers in the catalogue's order. */
async function searchSerialsByIssn(issn, deadline) {
  const { status, body } = await httpGet(
    `/cgi-bin/koha/opac-search.pl?idx=ns&q=${encodeURIComponent(issn)}&limit=bib-level:s&format=rss`,
    'application/rss+xml',
    deadline
  );
  if (status !== 200) throw new NlgUnavailableError(`HTTP ${status}`);
  const numbers = mapper.biblionumbersFromRss(body);
  if (numbers === null) throw new NlgUnavailableError('η απάντηση δεν είναι RSS'); // Review Focus 2
  return numbers;
}

/** MARC-in-JSON record, or null when it does not exist. */
async function getBiblio(biblionumber, deadline) {
  const { status, body } = await httpGet(`/api/v1/public/biblios/${biblionumber}`, 'application/marc-in-json', deadline);
  if (status === 404) return null;
  if (status !== 200) throw new NlgUnavailableError(`HTTP ${status}`);
  try {
    return JSON.parse(body);
  } catch (err) {
    throw new NlgUnavailableError('η εγγραφή δεν είναι JSON');
  }
}

module.exports = { searchSerialsByIssn, getBiblio };
