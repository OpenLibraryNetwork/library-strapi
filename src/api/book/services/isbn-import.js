'use strict';

const fs = require('fs');
const path = require('path');
const biblionet = require('./biblionet');
const quota = require('./biblionet-quota');
const mapper = require('./biblionet-mapper');
const { normalizeIsbn, toIsbn10 } = require('../../../utils/isbn');
const { isUniqueViolation } = require('../../../utils/db-errors');
const { BOOK_POPULATE } = require('../../../utils/book-populate');
const {
  InvalidIsbnError,
  QuotaExceededError,
  BiblionetUnavailableError,
} = require('../../../utils/catalog-errors');

const BOOK = 'api::book.book';
const PERSON = 'api::person.person';
const PUBLISHER = 'api::publisher.publisher';
const SUBJECT = 'api::subject.subject';
const ROLE = 'api::contributor-role.contributor-role';

module.exports = ({ strapi }) => {
  async function findOrCreate(uid, where, data) {
    const existing = await strapi.db.query(uid).findOne({ where, select: ['id'] });
    if (existing) return existing.id;
    try {
      return (await strapi.documents(uid).create({ data })).id;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const raced = await strapi.db.query(uid).findOne({ where, select: ['id'] });
      if (!raced) throw err;
      return raced.id;
    }
  }

  async function findOrCreateRole(typeId, name) {
    const roles = strapi.db.query(ROLE);
    const byType = await roles.findOne({ where: { biblionetTypeId: typeId } });
    if (byType) return byType.id;
    const byName = await roles.findOne({ where: { name } });
    if (byName) {
      if (!byName.biblionetTypeId) await roles.update({ where: { id: byName.id }, data: { biblionetTypeId: typeId } });
      return byName.id;
    }
    return findOrCreate(ROLE, { biblionetTypeId: typeId }, { name, biblionetTypeId: typeId });
  }

  async function storeCover(titleData) {
    if (!titleData.CoverImage) return null;
    const remoteUrl = titleData.CoverImage.startsWith('http')
      ? titleData.CoverImage
      : `https://biblionet.gr${titleData.CoverImage}`;
    const tmpDir = path.join(process.cwd(), '.tmp');
    const tmpFile = path.join(tmpDir, `cover_${titleData.TitlesID}.jpg`);
    try {
      const buffer = await biblionet.downloadImage(remoteUrl);
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(tmpFile, buffer);
      const [uploaded] = await strapi.plugin('upload').service('upload').upload({
        data: {},
        files: { name: `cover_${titleData.TitlesID}.jpg`, type: 'image/jpeg', size: fs.statSync(tmpFile).size, path: tmpFile },
      });
      return uploaded?.url || remoteUrl;
    } catch (err) {
      strapi.log.warn(`Cover image download/upload failed: ${err.message}`);
      return remoteUrl;
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  }

  /**
   * All Biblionet calls happen here, before anything is written.
   * Returns null when Biblionet has no such title.
   */
  async function fetchAll(isbn, call) {
    let titleData = await call(() => biblionet.searchByIsbn(isbn));
    // Older titles may be registered in Biblionet only under their ISBN-10
    const isbn10 = toIsbn10(isbn);
    if ((!titleData || !titleData.TitlesID) && isbn10) {
      titleData = await call(() => biblionet.searchByIsbn(isbn10));
    }
    if (!titleData || !titleData.TitlesID) return null;

    // Same Biblionet title already catalogued under another of its ISBNs (ISBN_2/ISBN_3)
    const catalogued = await findByBiblionetId(titleData.TitlesID);
    if (catalogued) return { catalogued };

    const contributors = mapper.mapContributors(await call(() => biblionet.getContributors(titleData.TitlesID)));
    const subjects = mapper.mapSubjects(await call(() => biblionet.getSubjects(titleData.TitlesID)));

    const persons = new Map();
    for (const c of contributors) {
      if (persons.has(c.biblionetPersonId)) continue;
      const known = await strapi.db.query(PERSON).findOne({ where: { biblionetPersonId: c.biblionetPersonId }, select: ['id'] });
      let personData = null;
      if (!known) {
        try {
          personData = await call(() => biblionet.getPerson(c.biblionetPersonId));
        } catch (err) {
          strapi.log.warn(`Biblionet person ${c.biblionetPersonId} enrichment failed: ${err.message}`);
        }
      }
      persons.set(c.biblionetPersonId, mapper.mapPerson({ ContributorID: c.biblionetPersonId, ContributorFullName: c.fullName }, personData));
    }

    let company = null;
    if (titleData.PublisherID) {
      const known = await strapi.db.query(PUBLISHER).findOne({ where: { biblionetCompanyId: String(titleData.PublisherID) }, select: ['id'] });
      let companyData = null;
      if (!known) {
        try {
          companyData = await call(() => biblionet.getCompany(titleData.PublisherID));
        } catch (err) {
          strapi.log.warn(`Biblionet company ${titleData.PublisherID} enrichment failed: ${err.message}`);
        }
      }
      company = mapper.mapCompany(titleData, companyData);
    }

    return { titleData, contributors, subjects, persons, company };
  }

  async function findByBiblionetId(titlesId) {
    const [book] = await strapi.documents(BOOK).findMany({
      filters: { biblionetId: String(titlesId) },
      populate: BOOK_POPULATE,
      limit: 1,
    });
    return book || null;
  }

  async function persist(isbn, fetched) {
    const { titleData, contributors, subjects, persons, company } = fetched;

    const roleIds = {};
    for (const c of contributors) {
      if (!roleIds[c.roleTypeId]) roleIds[c.roleTypeId] = await findOrCreateRole(c.roleTypeId, c.roleName);
    }
    const personIds = {};
    for (const [biblionetPersonId, fields] of persons) {
      personIds[biblionetPersonId] = await findOrCreate(PERSON, { biblionetPersonId }, { ...fields, reviewed: true });
    }
    const publisherId = company
      ? await findOrCreate(PUBLISHER, { biblionetCompanyId: company.biblionetCompanyId }, { ...company, reviewed: true })
      : null;
    const subjectIds = [];
    for (const s of subjects) {
      subjectIds.push(await findOrCreate(SUBJECT, { biblionetSubjectId: s.biblionetSubjectId }, s));
    }

    const book = await strapi.documents(BOOK).create({
      data: {
        ...mapper.mapTitle(titleData),
        type: 'Βιβλίο',
        isbn,
        coverImageUrl: await storeCover(titleData),
        // Biblionet does not document how "no results" differs from an error, so an import
        // without contributors or subjects is sent to the cataloguer's review queue.
        reviewed: contributors.length > 0 && subjects.length > 0,
        publisher: publisherId,
        subjects: subjectIds,
        contributors: contributors.map((c) => ({ person: personIds[c.biblionetPersonId], role: roleIds[c.roleTypeId] })),
      },
    });
    return book.id;
  }

  return {
    async findByIsbn(isbn) {
      const [book] = await strapi.documents(BOOK).findMany({ filters: { isbn }, populate: BOOK_POPULATE, limit: 1 });
      return book || null;
    },

    async lookup(rawIsbn) {
      const isbn = normalizeIsbn(rawIsbn);
      if (!isbn) throw new InvalidIsbnError(rawIsbn);
      const existing = await this.findByIsbn(isbn);
      if (existing) return { source: 'catalog', book: existing };
      return this.importFromBiblionet(isbn);
    },

    async importFromBiblionet(isbn) {
      if (!quota.canMakeCall()) throw new QuotaExceededError(quota.getUsage().limit);

      let calls = 0;
      const { limit } = quota.getUsage();
      const call = (fn) => {
        // Checked per call: one import (many contributors) must not run past the daily limit.
        if (quota.getUsage().used + calls >= limit) throw new QuotaExceededError(limit);
        calls += 1;
        return fn();
      };

      let fetched;
      try {
        fetched = await fetchAll(isbn, call);
      } catch (err) {
        if (err instanceof QuotaExceededError) throw err;
        throw new BiblionetUnavailableError(err.message);
      } finally {
        quota.increment(calls);
      }
      if (!fetched) return { source: 'not-found', book: null };
      if (fetched.catalogued) return { source: 'catalog', book: fetched.catalogued };

      try {
        const id = await persist(isbn, fetched);
        return { source: 'biblionet', book: (await strapi.documents(BOOK).findMany({ filters: { id }, populate: BOOK_POPULATE, limit: 1 }))[0] };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Another library imported the same ISBN (or title) at the same moment
        const existing = (await this.findByIsbn(isbn)) || (await findByBiblionetId(fetched.titleData.TitlesID));
        if (!existing) throw err;
        return { source: 'catalog', book: existing };
      }
    },
  };
};
