'use strict';

/**
 * Pure mapping from Biblionet API responses to our content types.
 * No Strapi or network access here.
 */

function blank(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function int(value) {
  const s = blank(value);
  if (s === null) return null;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

function float(value) {
  const s = blank(value);
  if (s === null) return null;
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

function mapTitle(t) {
  const yearMatch = blank(t.FirstPublishDate)?.match(/\d{4}/);
  return {
    title: blank(t.Title),
    subtitle: blank(t.Subtitle),
    yearPublished: yearMatch ? parseInt(yearMatch[0], 10) : null,
    pages: int(t.PageNo),
    language: blank(t.Language),
    originalLanguage: blank(t.LanguageOriginal),
    binding: blank(t.Cover),
    edition: blank(t.EditionNo),
    dimensions: blank(t.Dimensions),
    place: blank(t.Place),
    category: blank(t.Category),
    series: blank(t.Series),
    price: float(t.Price),
    weight: int(t.Weight),
    summary: blank(t.Summary),
    biblionetId: blank(t.TitlesID),
    biblionetCategoryId: blank(t.CategoryID),
  };
}

function mapPerson(row, personData) {
  const p = personData || {};
  const composed = [p.Name, p.MiddleName, p.Surname].map(blank).filter(Boolean).join(' ');
  return {
    name: blank(row.ContributorFullName) || blank(composed) || 'Άγνωστο πρόσωπο',
    firstname: blank(p.Name),
    middlename: blank(p.MiddleName),
    lastname: blank(p.Surname),
    bornYear: blank(p.BornYear),
    deathYear: blank(p.DeathYear),
    biography: blank(p.Biography),
    biblionetPersonId: blank(row.ContributorID),
  };
}

function mapCompany(titleData, companyData) {
  const c = companyData || {};
  return {
    name: blank(titleData.Publisher) || blank(c.Title) || 'Άγνωστος Εκδότης',
    alternativeName: blank(c.AlternativeTitle),
    address: blank(c.Address),
    phone: blank(c.TelephoneNumner), // sic: Biblionet's field name
    email: blank(c.Email),
    website: blank(c.Website),
    biblionetCompanyId: blank(titleData.PublisherID),
  };
}

function mapContributors(rows) {
  const seen = new Set();
  return rows
    .filter((r) => blank(r.ContributorID))
    .map((r, index) => ({
      biblionetPersonId: blank(r.ContributorID),
      fullName: blank(r.ContributorFullName),
      roleTypeId: blank(r.ContributorTypeID),
      roleName: blank(r.ContributorType) || `Ρόλος ${blank(r.ContributorTypeID)}`,
      order: int(r.PresentOrder) ?? index + 1,
    }))
    .sort((a, b) => a.order - b.order)
    .filter((c) => {
      const key = `${c.biblionetPersonId}|${c.roleTypeId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function mapSubjects(rows) {
  return rows
    .filter((r) => blank(r.SubjectsID))
    .map((r, index) => ({ row: r, order: int(r.SubjectOrder) ?? index + 1 }))
    .sort((a, b) => a.order - b.order)
    .map(({ row }) => ({
      biblionetSubjectId: blank(row.SubjectsID),
      subjectTitle: blank(row.SubjectTitle) || 'Άγνωστο Θέμα',
      subjectDDC: blank(row.SubjectDDC),
    }));
}

module.exports = { mapTitle, mapPerson, mapCompany, mapContributors, mapSubjects };
