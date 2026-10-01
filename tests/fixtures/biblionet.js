'use strict';

const title = {
  TitlesID: '72584',
  CoverImage: '/wp-content/uploadsTitleImages/08/b72584.jpg',
  Title: 'Θεραπείας συνέχεια',
  Subtitle: '',
  ISBN: '978-960-211-652-4',
  PublisherID: '212',
  Publisher: 'Νεφέλη',
  FirstPublishDate: '2002-01-01',
  Place: 'Αθήνα',
  TitleType: 'Βιβλίο',
  EditionNo: null,
  Cover: 'Μαλακό εξώφυλλο',
  Dimensions: '17x12',
  PageNo: '119',
  Price: '5.8300',
  Weight: '128',
  Summary: 'Η de profundis συνομιλία με το πατρικό αρχέτυπο...',
  Language: '',
  LanguageOriginal: '',
  Series: 'Σύγχρονη Ελληνική Πεζογραφία',
  CategoryID: '39',
  Category: 'Ελληνική λογοτεχνία',
};

// get_contributors returns [[...]]
const contributors = [[
  { TitlesID: '89', Title: 'Μπλε πάγος', ContributorID: '958', ContributorFullName: 'Pino Corrias', ContributorTypeID: '1', ContributorType: 'Συγγραφέας', PresentOrder: '1' },
  { TitlesID: '89', Title: 'Μπλε πάγος', ContributorID: '1232', ContributorFullName: 'Παναγιώτης Σκόνδρας', ContributorTypeID: '2', ContributorType: 'Μεταφραστής', PresentOrder: '2' },
]];

const subjects = [[
  { TitlesID: '72584', Titles: 'Θεραπείας συνέχεια', SubjectsID: '20', SubjectTitle: 'Νεοελληνική πεζογραφία - Προσωπικές αφηγήσεις', SubjectDDC: '889.3', SubjectOrder: '1' },
]];

const person = { PersonsID: '1232', Photo: '', Name: 'Παναγιώτης', MiddleName: '', Surname: 'Σκόνδρας', BornYear: '', DeathYear: '', Biography: 'Μεταφραστής.', LastUpdate: '2020-10-02' };

const company = { ComID: '212', Title: 'Νεφέλη', AlternativeTitle: '', Address: 'Ασκληπιού 57\r\n106 80 Αθήνα\r\n', TelephoneNumner: '210 3607744', Email: 'info@nefeli.gr', Website: 'www.nefeli.gr', LastUpdate: null };

const error = { error: { error: 'Δεν βρέθηκαν αποτελέσματα' } };

module.exports = { title, contributors, subjects, person, company, error };
