'use strict';

/**
 * book controller
 * Extends the default Strapi controller with Biblionet search.
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::book.book', ({ strapi }) => ({
  /**
   * GET /api/books/search-biblionet?isbn=978-960-211-652-4
   *
   * 1. Normalize ISBN
   * 2. Search local Strapi DB first
   * 3. If not found, call Biblionet API
   * 4. Create Book + Publisher + Authors in Strapi
   * 5. Return result with source indicator
   */
  async searchBiblionet(ctx) {
    const { isbn } = ctx.query;

    if (!isbn) {
      return ctx.badRequest('ISBN is required. Use ?isbn=978-xxx-xxx');
    }

    // Normalize: remove dashes and spaces
    const normalizedIsbn = isbn.replace(/[-\s]/g, '');

    // 1. Check if book already exists in Strapi
    const existingBooks = await strapi.entityService.findMany('api::book.book', {
      filters: { isbn: normalizedIsbn },
      populate: ['authors', 'publisher', 'copies', 'subjects'],
    });

    if (existingBooks && existingBooks.length > 0) {
      return ctx.send({
        source: 'strapi',
        data: existingBooks[0],
      });
    }

    // 2. Check Biblionet quota
    const quota = require('../services/biblionet-quota');
    if (!quota.canMakeCall()) {
      return ctx.tooManyRequests(
        `Ημερήσιο όριο Biblionet API (${quota.getUsage().limit} calls). Δοκιμάστε αύριο.`
      );
    }

    // 3. Search Biblionet API
    const biblionet = require('../services/biblionet');
    let apiCallsMade = 0;

    let titleData;
    try {
      titleData = await biblionet.searchByIsbn(normalizedIsbn);
      apiCallsMade++;
    } catch (err) {
      strapi.log.error('Biblionet search failed:', err.message);
      return ctx.internalServerError(`Biblionet API error: ${err.message}`);
    }

    if (!titleData || !titleData.TitlesID) {
      quota.increment(apiCallsMade); // Count the calls made so far
      return ctx.notFound(`Δεν βρέθηκε βιβλίο με ISBN: ${isbn}`);
    }

    // 4. Get contributors from Biblionet
    let authorsData = [];
    try {
      const contributors = await biblionet.getContributors(titleData.TitlesID);
      authorsData = biblionet.filterAuthors(contributors);
      apiCallsMade++;
    } catch (err) {
      strapi.log.warn('Biblionet contributors fetch failed:', err.message);
      // Continue without authors — not fatal
    }

    // 5. Get DDC subjects from Biblionet
    let subjectsData = [];
    try {
      subjectsData = await biblionet.getSubjects(titleData.TitlesID);
      apiCallsMade++;
    } catch (err) {
      strapi.log.warn('Biblionet subjects fetch failed:', err.message);
      // Continue without subjects — not fatal
    }

    // 6. Find or create Publisher (with enrichment)
    let publisherId = null;
    if (titleData.PublisherID) {
      const existingPublishers = await strapi.entityService.findMany(
        'api::publisher.publisher',
        { filters: { biblionetCompanyId: String(titleData.PublisherID) } }
      );

      if (existingPublishers && existingPublishers.length > 0) {
        publisherId = existingPublishers[0].id;
      } else {
        // Enrich publisher details
        let companyData = null;
        try {
          companyData = await biblionet.getCompany(titleData.PublisherID);
          apiCallsMade++;
        } catch (err) {
          strapi.log.warn(`Biblionet company fetch failed for ID ${titleData.PublisherID}:`, err.message);
        }

        const newPublisher = await strapi.entityService.create(
          'api::publisher.publisher',
          {
            data: {
              name: titleData.Publisher || 'Άγνωστος Εκδότης',
              biblionetCompanyId: String(titleData.PublisherID),
              address: companyData ? companyData.Address || null : null,
              phone: companyData ? companyData.TelephoneNumner || null : null, // Note: TelephoneNumner is the typo in the API
              email: companyData ? companyData.Email || null : null,
              website: companyData ? companyData.Website || null : null,
            },
          }
        );
        publisherId = newPublisher.id;
      }
    }

    // 7. Find or create Authors (with enrichment)
    const authorIds = [];
    for (const author of authorsData) {
      if (!author.ContributorID) continue;

      const existingAuthors = await strapi.entityService.findMany(
        'api::author.author',
        { filters: { biblionetPersonId: String(author.ContributorID) } }
      );

      if (existingAuthors && existingAuthors.length > 0) {
        authorIds.push(existingAuthors[0].id);
      } else {
        // Enrich author details
        let personData = null;
        try {
          personData = await biblionet.getPerson(author.ContributorID);
          apiCallsMade++;
        } catch (err) {
          strapi.log.warn(`Biblionet person fetch failed for ID ${author.ContributorID}:`, err.message);
        }

        const newAuthor = await strapi.entityService.create(
          'api::author.author',
          {
            data: {
              name: author.ContributorFullName || 'Άγνωστος Συγγραφέας', // BUGFIX: was ContributorName
              firstname: personData ? personData.Name || null : null,
              lastname: personData ? personData.Surname || null : null,
              biography: personData ? personData.Biography || null : null,
              biblionetPersonId: String(author.ContributorID),
            },
          }
        );
        authorIds.push(newAuthor.id);
      }
    }

    // 8. Find or create Subjects (DDC Classification)
    const subjectIds = [];
    for (const subject of subjectsData) {
      if (!subject.SubjectsID) continue;

      const existingSubjects = await strapi.entityService.findMany(
        'api::subject.subject',
        { filters: { biblionetSubjectId: String(subject.SubjectsID) } }
      );

      if (existingSubjects && existingSubjects.length > 0) {
        subjectIds.push(existingSubjects[0].id);
      } else {
        const newSubject = await strapi.entityService.create(
          'api::subject.subject',
          {
            data: {
              subjectTitle: subject.SubjectTitle || 'Άγνωστο Θέμα',
              subjectDDC: subject.SubjectDDC || null,
              biblionetSubjectId: String(subject.SubjectsID),
            },
          }
        );
        subjectIds.push(newSubject.id);
      }
    }

    // 9. Download and Upload Cover Image (Save locally)
    let localCoverUrl = null;
    if (titleData.CoverImage) {
      const fs = require('fs');
      const path = require('path');
      const tmpDir = path.join(process.cwd(), '.tmp');
      const tmpFilePath = path.join(tmpDir, `cover_${titleData.TitlesID}.jpg`);

      try {
        const remoteUrl = titleData.CoverImage.startsWith('http')
          ? titleData.CoverImage
          : `https://biblionet.gr${titleData.CoverImage}`;

        // Download image buffer
        const imageBuffer = await biblionet.downloadImage(remoteUrl);

        // Ensure tmp dir exists
        if (!fs.existsSync(tmpDir)) {
          fs.mkdirSync(tmpDir, { recursive: true });
        }

        // Write to temp file
        fs.writeFileSync(tmpFilePath, imageBuffer);

        const stats = fs.statSync(tmpFilePath);

        // Upload to Strapi Media Library
        const [uploadedFile] = await strapi.plugin('upload').service('upload').upload({
          data: {},
          files: {
            name: `cover_${titleData.TitlesID}.jpg`,
            type: 'image/jpeg',
            size: stats.size,
            path: tmpFilePath,
          },
        });

        if (uploadedFile && uploadedFile.url) {
          localCoverUrl = uploadedFile.url;
        }

        // Clean up temp file
        if (fs.existsSync(tmpFilePath)) {
          fs.unlinkSync(tmpFilePath);
        }
      } catch (err) {
        strapi.log.warn('Cover image download/upload failed:', err.message || err);
        // Clean up temp file if it exists
        try {
          if (fs.existsSync(tmpFilePath)) {
            fs.unlinkSync(tmpFilePath);
          }
        } catch (unlinkErr) {
          // Ignore
        }
        // Fallback: Use remote URL if download/upload fails
        localCoverUrl = titleData.CoverImage.startsWith('http')
          ? titleData.CoverImage
          : `https://biblionet.gr${titleData.CoverImage}`;
      }
    }

    // 10. Extract year from FirstPublishDate (may be "2005" or "2005-01-01" etc.)
    let yearPublished = null;
    if (titleData.FirstPublishDate) {
      const yearMatch = String(titleData.FirstPublishDate).match(/\d{4}/);
      if (yearMatch) {
        yearPublished = parseInt(yearMatch[0], 10);
      }
    }

    const bookData = {
      title: titleData.Title,
      type: 'Βιβλίο',
      isbn: normalizedIsbn,
      subtitle: titleData.Subtitle || null,
      yearPublished,
      pages: titleData.PageNo ? parseInt(titleData.PageNo, 10) : null,
      language: titleData.Language || null,
      originalLanguage: titleData.LanguageOriginal || null,
      coverImageUrl: localCoverUrl,
      binding: titleData.Cover || null,
      edition: titleData.EditionNo || null,
      dimensions: titleData.Dimensions || null,
      place: titleData.Place || null,
      category: titleData.Category || null,
      series: titleData.Series || null,
      price: titleData.Price ? parseFloat(titleData.Price) : null,
      weight: titleData.Weight ? parseInt(titleData.Weight, 10) : null,
      summary: titleData.Summary || null,
      biblionetId: String(titleData.TitlesID),
      biblionetCategoryId: titleData.CategoryID ? String(titleData.CategoryID) : null,
      publisher: publisherId,
      authors: authorIds,
      subjects: subjectIds,
    };

    const newBook = await strapi.entityService.create('api::book.book', {
      data: bookData,
      populate: ['authors', 'publisher', 'subjects'],
    });

    // Dynamic increment based on actual calls made
    quota.increment(apiCallsMade);

    return ctx.send({
      source: 'biblionet',
      data: newBook,
      quota: quota.getUsage(),
    });
  },
}));
