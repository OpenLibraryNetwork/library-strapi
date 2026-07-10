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
      populate: ['authors', 'publisher', 'copies'],
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

    let titleData;
    try {
      titleData = await biblionet.searchByIsbn(normalizedIsbn);
    } catch (err) {
      strapi.log.error('Biblionet search failed:', err.message);
      return ctx.internalServerError(`Biblionet API error: ${err.message}`);
    }

    if (!titleData || !titleData.TitlesID) {
      quota.increment(1); // Count the failed call too
      return ctx.notFound(`Δεν βρέθηκε βιβλίο με ISBN: ${isbn}`);
    }

    // 4. Get contributors from Biblionet
    let authorsData = [];
    try {
      const contributors = await biblionet.getContributors(titleData.TitlesID);
      authorsData = biblionet.filterAuthors(contributors);
    } catch (err) {
      strapi.log.warn('Biblionet contributors fetch failed:', err.message);
      // Continue without authors — not fatal
    }

    quota.increment(2); // get_title + get_contributors

    // 5. Find or create Publisher
    let publisherId = null;
    if (titleData.PublisherID) {
      const existingPublishers = await strapi.entityService.findMany(
        'api::publisher.publisher',
        { filters: { biblionetCompanyId: String(titleData.PublisherID) } }
      );

      if (existingPublishers && existingPublishers.length > 0) {
        publisherId = existingPublishers[0].id;
      } else {
        const newPublisher = await strapi.entityService.create(
          'api::publisher.publisher',
          {
            data: {
              name: titleData.Publisher || 'Άγνωστος Εκδότης',
              biblionetCompanyId: String(titleData.PublisherID),
            },
          }
        );
        publisherId = newPublisher.id;
      }
    }

    // 6. Find or create Authors
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
        const newAuthor = await strapi.entityService.create(
          'api::author.author',
          {
            data: {
              name: author.ContributorName || `${author.FirstName || ''} ${author.LastName || ''}`.trim(),
              firstname: author.FirstName || null,
              lastname: author.LastName || null,
              biblionetPersonId: String(author.ContributorID),
            },
          }
        );
        authorIds.push(newAuthor.id);
      }
    }

    // 7. Create Book (Έντυπο)
    const coverUrl = titleData.CoverImage
      ? (titleData.CoverImage.startsWith('http')
        ? titleData.CoverImage
        : `https://biblionet.gr${titleData.CoverImage}`)
      : null;

    // Extract year from FirstPublishDate (may be "2005" or "2005-01-01" etc.)
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
      coverImageUrl: coverUrl,
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
    };

    const newBook = await strapi.entityService.create('api::book.book', {
      data: bookData,
      populate: ['authors', 'publisher'],
    });

    return ctx.send({
      source: 'biblionet',
      data: newBook,
      quota: quota.getUsage(),
    });
  },
}));
