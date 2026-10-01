'use strict';

const nlg = require('./nlg');
const mapper = require('./nlg-mapper');
const { buildMatchKey } = require('../../../utils/text-keys');
const { isUniqueViolation } = require('../../../utils/db-errors');
const { NlgUnavailableError } = require('../../../utils/catalog-errors');
const { DuplicateRecordError } = require('../../../utils/catalog-lifecycle');

const MAGAZINE = 'api::magazine.magazine';
const PUBLISHER = 'api::publisher.publisher';
const MAX_RECORDS = 3;
// Whole lookup (search + records) must answer before the JavaFX client's 30 s timeout.
const TOTAL_TIMEOUT_MS = Number(process.env.NLG_TOTAL_TIMEOUT_MS) || 20000;
const POPULATE = { publisher: true };

module.exports = ({ strapi }) => {
  async function findOne(filters) {
    const [magazine] = await strapi.entityService.findMany(MAGAZINE, { filters, populate: POPULATE, limit: 1 });
    return magazine || null;
  }

  /** First record that really is a serial with this ISSN; null when there is none. */
  async function fetchRecord(issn) {
    const deadline = Date.now() + TOTAL_TIMEOUT_MS;
    const numbers = await nlg.searchSerialsByIssn(issn, deadline);
    for (const n of numbers.slice(0, MAX_RECORDS)) {
      const raw = await nlg.getBiblio(n, deadline);
      if (!raw) continue;
      const mapped = mapper.mapBiblio(raw, n);
      if (mapped.isSerial && mapped.issns.includes(issn) && mapped.title) return { ...mapped, issn };
    }
    return null;
  }

  /** The National Library gives only a name: reuse a publisher with that name, else create one for review. */
  async function publisherIdFor(name) {
    const matchKey = buildMatchKey('publisher', { name, qualifier: null });
    const found = () => strapi.db.query(PUBLISHER).findOne({ where: { matchKey }, select: ['id'] });
    const existing = await found();
    if (existing) return existing.id;
    try {
      return (await strapi.entityService.create(PUBLISHER, { data: { name, reviewed: false } })).id;
    } catch (err) {
      if (!(err instanceof DuplicateRecordError)) throw err;
      return (await found()).id; // created by a parallel import
    }
  }

  async function persist(record) {
    const byNumber = await findOne({ nlgBiblionumber: record.nlgBiblionumber });
    if (byNumber) return byNumber;
    const data = {
      title: record.title,
      issn: record.issn,
      place: record.place,
      periodicity: record.periodicity,
      nlgBiblionumber: record.nlgBiblionumber,
      publisher: record.publisherName ? await publisherIdFor(record.publisherName) : null,
      reviewed: true,
    };
    try {
      return await strapi.entityService.create(MAGAZINE, { data, populate: POPULATE });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const raced = await findOne({ issn: record.issn });
      if (!raced) throw err;
      return raced;
    }
  }

  return {
    findByIssn(issn) {
      return findOne({ issn });
    },

    /** issn: already normalized (parseIssnCode). */
    async lookup(issn) {
      const existing = await this.findByIssn(issn);
      if (existing) return { source: 'catalog', magazine: existing };
      let record;
      try {
        record = await fetchRecord(issn);
      } catch (err) {
        if (!(err instanceof NlgUnavailableError)) throw err;
        strapi.log.warn(`National Library lookup for ${issn} failed: ${err.message}`);
        return { source: 'unavailable', magazine: null };
      }
      if (!record) return { source: 'not-found', magazine: null };
      return { source: 'nlg', magazine: await persist(record) };
    },
  };
};
