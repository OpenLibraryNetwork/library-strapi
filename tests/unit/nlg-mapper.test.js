'use strict';

const fs = require('fs');
const path = require('path');
const mapper = require('../../src/api/magazine/services/nlg-mapper');

const FX = path.join(__dirname, '..', 'fixtures', 'nlg');
const read = (name) => fs.readFileSync(path.join(FX, name), 'utf8');
const json = (name) => JSON.parse(read(name));

describe('biblionumbersFromRss', () => {
  test('real search result', () => {
    expect(mapper.biblionumbersFromRss(read('rss-2241-5580.xml'))).toEqual(['633300']);
  });
  test('unique numbers in order', () => {
    const xml = '<rss version="2.0"><channel><item><link>x?biblionumber=5</link></item>'
      + '<item><link>x?biblionumber=7</link><guid>x?biblionumber=5</guid></item></channel></rss>';
    expect(mapper.biblionumbersFromRss(xml)).toEqual(['5', '7']);
  });
  test('empty result', () => {
    expect(mapper.biblionumbersFromRss('<rss version="2.0"><channel></channel></rss>')).toEqual([]);
  });
  test('an HTML page is not a result (Review Focus 2)', () => {
    expect(mapper.biblionumbersFromRss('<html><body>Συντήρηση biblionumber=1</body></html>')).toBeNull();
  });
});

describe('mapBiblio', () => {
  test('Κοινωνικός Αναρχισμός (633300)', () => {
    expect(mapper.mapBiblio(json('biblio-633300.json'), '633300')).toEqual({
      isSerial: true,
      issn: '2241-5580',
      issns: ['2241-5580'],
      title: 'Κοινωνικός Αναρχισμός',
      place: 'Θεσσαλονίκη',
      publisherName: 'Ελευθεριακές Εκδόσεις Κουρσάλ',
      periodicity: null,
      nlgBiblionumber: '633300',
    });
  });

  test('Αρχαιολογία & τέχνες (623636) has periodicity', () => {
    expect(mapper.mapBiblio(json('biblio-623636.json'), '623636')).toMatchObject({
      isSerial: true,
      issn: '1108-2402',
      title: 'Αρχαιολογία & τέχνες',
      place: 'Αθήνα',
      publisherName: 'Άννα Λαμπράκη',
      periodicity: 'Τετραμηνιαία',
    });
  });

  test('a book record is not a serial', () => {
    const record = json('biblio-633300.json');
    record.leader = `${record.leader.slice(0, 7)}m${record.leader.slice(8)}`;
    expect(mapper.mapBiblio(record, '633300').isSerial).toBe(false);
  });

  test('245 $b is appended as subtitle; 264 is used when 260 is missing', () => {
    const record = {
      leader: '00000nas a2200000 a 4500',
      fields: [
        { '022': { subfields: [{ a: '1108-2402' }] } },
        { '245': { subfields: [{ a: 'Τίτλος :' }, { b: 'υπότιτλος /' }] } },
        { '264': { subfields: [{ a: 'Πάτρα :' }, { b: 'Εκδότης,' }] } },
      ],
    };
    expect(mapper.mapBiblio(record, '9')).toMatchObject({
      title: 'Τίτλος : υπότιτλος', place: 'Πάτρα', publisherName: 'Εκδότης', periodicity: null,
    });
  });

  test('missing fields give nulls, not errors', () => {
    expect(mapper.mapBiblio({ leader: '00000nas', fields: [] }, '1')).toEqual({
      isSerial: true, issn: null, issns: [], title: null, place: null, publisherName: null, periodicity: null, nlgBiblionumber: '1',
    });
  });
});

describe('records with more than one ISSN (2γ minor M-8)', () => {
  test('all 022 $a values are listed', () => {
    const record = {
      leader: '00000nas a2200000 a 4500',
      fields: [
        { '022': { subfields: [{ a: '1108-2402' }] } },
        { '022': { subfields: [{ a: '0317-8471' }] } },
        { '245': { subfields: [{ a: 'Διπλό ISSN' }] } },
      ],
    };
    expect(mapper.mapBiblio(record, '5')).toMatchObject({ issn: '1108-2402', issns: ['1108-2402', '0317-8471'] });
  });
});
