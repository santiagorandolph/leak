'use strict';

const assert = require('node:assert');
const detector = require('./detector.js');
const { buildSampleCSV } = require('./sample-data.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (err) {
    failed++;
    console.error('  FAIL ' + name);
    console.error('       ' + err.message);
  }
}

function near(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    label + ': expected about ' + expected + ', got ' + actual
  );
}

console.log('\nparsing values');

test('parses US currency', () => {
  assert.strictEqual(detector.parseAmount('$1,234.56'), 1234.56);
  assert.strictEqual(detector.parseAmount('-24.99'), -24.99);
});

test('parses accounting negatives and European decimals', () => {
  assert.strictEqual(detector.parseAmount('(12.00)'), -12);
  assert.strictEqual(detector.parseAmount('1.234,56'), 1234.56);
  assert.strictEqual(detector.parseAmount('12,5 €'), 12.5);
});

test('parses dates without timezone drift', () => {
  assert.strictEqual(detector.parseDate('2025-03-09'), Date.UTC(2025, 2, 9));
  assert.strictEqual(detector.parseDate('25/03/2025'), Date.UTC(2025, 2, 25));
  // Ambiguous numeric dates default to month-first (US).
  assert.strictEqual(detector.parseDate('09/03/2025'), Date.UTC(2025, 8, 3));
  assert.strictEqual(detector.parseDate('05 Jan 2025'), Date.UTC(2025, 0, 5));
  assert.strictEqual(detector.parseDate('Jan 5, 2025'), Date.UTC(2025, 0, 5));
});

test('handles quoted CSV fields', () => {
  const rows = detector.parseCSV('"Date","Description","Amount"\n"2025-01-05","ACME, INC","-9.99"');
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[1][1], 'ACME, INC');
});

console.log('\ndetecting recurring charges');

const sample = detector.analyze(buildSampleCSV());

test('sample file analyzes without error', () => {
  assert.ok(!sample.error, sample.error);
});

test('finds all eight recurring charges', () => {
  const names = sample.results.map((r) => r.name).sort();
  assert.deepStrictEqual(names, [
    'Amazon Prime',
    'Apple',
    'Comcast',
    'Disney+',
    'Netflix',
    'Planet Fitness',
    'Spotify',
    'The New York Times'
  ]);
});

test('annualizes a monthly charge', () => {
  const netflix = sample.results.find((r) => r.name === 'Netflix');
  assert.ok(netflix, 'Netflix missing');
  near(netflix.annual, 186, 8, 'Netflix annual');
  assert.strictEqual(netflix.cadence, 'monthly');
  assert.strictEqual(netflix.confidence, 'confident');
});

test('detects a yearly charge', () => {
  const prime = sample.results.find((r) => r.name === 'Amazon Prime');
  assert.ok(prime, 'Amazon Prime missing');
  assert.strictEqual(prime.cadence, 'yearly');
  near(prime.annual, 139, 1, 'Prime annual');
});

test('ignores groceries, coffee, one-offs, and income', () => {
  const names = sample.results.map((r) => r.name.toLowerCase()).join(' | ');
  assert.ok(!/whole foods/.test(names), 'groceries flagged');
  assert.ok(!/blue bottle/.test(names), 'coffee flagged');
  assert.ok(!/acme/.test(names), 'paycheck flagged');
  assert.ok(!/best buy/.test(names), 'one-off flagged');
});

test('flags multiple streaming services', () => {
  const streaming = sample.duplicates.find((d) => d.key === 'streaming');
  assert.ok(streaming, 'no streaming duplicate warning');
  assert.strictEqual(streaming.names.length, 3);
  assert.ok(streaming.annual > 450, 'streaming total too low: ' + streaming.annual);
});

test('summarizes monthly and yearly totals', () => {
  assert.strictEqual(sample.summary.count, 8);
  near(sample.summary.annual, 2130, 40, 'annual total');
  near(sample.summary.monthly, sample.summary.annual / 12, 0.05, 'monthly total');
});

test('detects positive debit-column exports', () => {
  const csv = [
    'Date,Description,Debit',
    '2025-01-05,NETFLIX.COM,15.49',
    '2025-02-05,NETFLIX.COM,15.49',
    '2025-03-05,NETFLIX.COM,15.49',
    '2025-04-05,NETFLIX.COM,15.49'
  ].join('\n');
  const result = detector.analyze(csv);
  assert.ok(!result.error, result.error);
  assert.strictEqual(result.results.length, 1);
  assert.strictEqual(result.results[0].name, 'Netflix');
  near(result.results[0].annual, 188, 6, 'Netflix annual');
});

test('detects semicolon-delimited files', () => {
  const csv = [
    'Datum;Beschreibung;Betrag',
    '2025-01-05;SPOTIFY USA;-11,99',
    '2025-02-05;SPOTIFY USA;-11,99',
    '2025-03-05;SPOTIFY USA;-11,99'
  ].join('\n');
  const result = detector.analyze(csv);
  assert.ok(!result.error, result.error);
  assert.strictEqual(result.results.length, 1);
  assert.strictEqual(result.results[0].name, 'Spotify');
});

test('detects headerless files', () => {
  const csv = [
    '2025-01-05,NETFLIX.COM,-15.49',
    '2025-02-05,NETFLIX.COM,-15.49',
    '2025-03-05,NETFLIX.COM,-15.49',
    '2025-04-05,NETFLIX.COM,-15.49'
  ].join('\n');
  const result = detector.analyze(csv);
  assert.ok(!result.error, result.error);
  assert.strictEqual(result.results.length, 1);
});

test('does not treat a weekly habit as a subscription', () => {
  const csv = [
    'Date,Description,Amount',
    '2025-01-06,SQ BLUE BOTTLE,-6.75',
    '2025-01-13,SQ BLUE BOTTLE,-6.75',
    '2025-01-20,SQ BLUE BOTTLE,-6.75',
    '2025-01-27,SQ BLUE BOTTLE,-6.75'
  ].join('\n');
  const result = detector.analyze(csv);
  assert.ok(!result.error, result.error);
  assert.strictEqual(result.results.length, 0);
});

test('reports a helpful error for non-transaction files', () => {
  const result = detector.analyze('hello,world\n1,2');
  assert.ok(result.error, 'expected an error message');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
if (failed) process.exitCode = 1;
