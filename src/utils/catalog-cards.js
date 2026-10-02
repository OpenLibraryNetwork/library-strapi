'use strict';

const { publicationFilters } = require('./catalog-query');

const BOOK = 'api::book.book';
const AUTHOR_TYPE_ID = '1';

// The fields a publication card shows; nothing else leaves the catalog endpoints.
const CARD_FIELDS = ['title', 'type', 'coverImageUrl', 'issueNumber', 'publicationMonthYear'];
const CARD_POPULATE = {
  contributors: {
    populate: {
      person: { fields: ['documentId', 'name', 'qualifier'] },
      role: { fields: ['documentId', 'name', 'biblionetTypeId'] },
    },
  },
};

const byName = (a, b) => a.name.localeCompare(b.name, 'el');
const emptyAvailability = () => ({ total: 0, available: 0, libraries: [] });

/**
 * Availability of every book of a page, from ONE query over their copies, grouped here.
 * Copies without a library do not count. Libraries are sorted by name.
 */
async function availabilityByBook(strapi, bookIds) {
  const result = new Map();
  if (bookIds.length === 0) return result;
  const copies = await strapi.db.query('api::copy.copy').findMany({
    where: { publication: { id: { $in: bookIds } } },
    select: ['isAvailable'],
    populate: { publication: { select: ['id'] }, library: { select: ['documentId', 'name'] } },
  });

  const perBook = new Map();
  for (const copy of copies) {
    if (!copy.publication || !copy.library) continue;
    const libraries = perBook.get(copy.publication.id) ?? new Map();
    perBook.set(copy.publication.id, libraries);
    const entry = libraries.get(copy.library.documentId)
      ?? { documentId: copy.library.documentId, name: copy.library.name, total: 0, available: 0 };
    libraries.set(copy.library.documentId, entry);
    entry.total += 1;
    if (copy.isAvailable) entry.available += 1;
  }
  for (const [bookId, libraries] of perBook) {
    const list = [...libraries.values()].sort(byName);
    result.set(bookId, {
      total: list.reduce((sum, l) => sum + l.total, 0),
      available: list.reduce((sum, l) => sum + l.available, 0),
      libraries: list,
    });
  }
  return result;
}

function toCard(book, availability) {
  return {
    documentId: book.documentId,
    title: book.title,
    type: book.type,
    coverImageUrl: book.coverImageUrl ?? null,
    issueNumber: book.issueNumber ?? null,
    publicationMonthYear: book.publicationMonthYear ?? null,
    contributors: (book.contributors ?? [])
      .filter((c) => c?.person && c?.role)
      .map((c) => ({
        person: { documentId: c.person.documentId, name: c.person.name, qualifier: c.person.qualifier ?? null },
        role: { documentId: c.role.documentId, name: c.role.name, biblionetTypeId: c.role.biblionetTypeId ?? null },
      })),
    availability: availability ?? emptyAvailability(),
  };
}

/** A person's publications per role, with the other filters applied and the role filter left out. */
async function roleFacets(strapi, parsed) {
  const roles = await strapi.db.query('api::contributor-role.contributor-role').findMany({
    select: ['documentId', 'name', 'biblionetTypeId'],
  });
  const counted = await Promise.all(roles.map(async (role) => ({
    role,
    count: await strapi.documents(BOOK).count({ filters: publicationFilters(parsed, { role: role.documentId }) }),
  })));
  const present = counted.filter((c) => c.count > 0);
  const authors = present.filter((c) => c.role.biblionetTypeId === AUTHOR_TYPE_ID);
  const others = present.filter((c) => c.role.biblionetTypeId !== AUTHOR_TYPE_ID).sort((a, b) => byName(a.role, b.role));
  return [...authors, ...others].map(({ role, count }) => ({ documentId: role.documentId, name: role.name, count }));
}

module.exports = { CARD_FIELDS, CARD_POPULATE, availabilityByBook, toCard, roleFacets };
