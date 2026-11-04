/*
 * Builds a realistic sample bank export, relative to today, so the demo is
 * always fresh. Charges are negative; the paycheck is positive, which also
 * exercises the sign filtering.
 */
(function (root) {
  'use strict';

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function monthOffset(baseYear, baseMonth, offset, day) {
    var total = baseMonth - 1 + offset;
    var year = baseYear + Math.floor(total / 12);
    var month = ((total % 12) + 12) % 12 + 1;
    return year + '-' + pad(month) + '-' + pad(day);
  }

  function buildSampleCSV() {
    var now = new Date();
    var year = now.getUTCFullYear();
    var month = now.getUTCMonth() + 1;
    var rows = [['Date', 'Description', 'Amount']];

    var subscriptions = [
      { day: 1, desc: 'POS DEBIT PLANET FITNESS #2214', amount: -24.99 },
      { day: 3, desc: 'COMCAST XFINITY AUTOPAY', amount: -79.99 },
      { day: 5, desc: 'NETFLIX.COM', amount: -15.49 },
      { day: 12, desc: 'SPOTIFY USA', amount: -11.99 },
      { day: 18, desc: 'DISNEY PLUS', amount: -13.99 },
      { day: 20, desc: 'NYTIMES DIGITAL', amount: -17.0 },
      { day: 22, desc: 'APPLE.COM/BILL', amount: -2.99 }
    ];

    var months = 8;
    subscriptions.forEach(function (sub) {
      for (var back = months - 1; back >= 0; back--) {
        rows.push([
          monthOffset(year, month, -back, sub.day),
          sub.desc,
          sub.amount.toFixed(2)
        ]);
      }
    });

    // An annual charge, twelve months apart.
    rows.push([monthOffset(year, month, -13, 15), 'AMAZON PRIME*ANNUAL', '-139.00']);
    rows.push([monthOffset(year, month, -1, 15), 'AMAZON PRIME*ANNUAL', '-139.00']);

    // Paycheck: positive, and should never appear in results.
    for (var p = months - 1; p >= 0; p--) {
      rows.push([monthOffset(year, month, -p, 15), 'ACME CORP DIRECT DEP', '2450.00']);
    }

    // Frequent, variable spending: must be ignored.
    for (var g = months - 1; g >= 0; g--) {
      [2, 9, 16, 23].forEach(function (day, index) {
        var amount = 38 + ((g * 7 + index * 13) % 60) + 0.42;
        rows.push([
          monthOffset(year, month, -g, day),
          'WHOLE FOODS MKT #102',
          '-' + amount.toFixed(2)
        ]);
      });
    }

    // A weekly habit with a stable amount: still not a subscription.
    for (var c = 0; c < 8; c++) {
      rows.push([
        monthOffset(year, month, -Math.floor(c / 4), 6 + (c % 4) * 7),
        'SQ *BLUE BOTTLE COFFEE',
        '-6.75'
      ]);
    }

    // A couple of one-offs.
    rows.push([monthOffset(year, month, -3, 8), 'BEST BUY #441', '-249.99']);
    rows.push([monthOffset(year, month, -2, 27), 'UBER TRIP', '-18.40']);

    var header = rows.shift();
    rows.sort(function (a, b) {
      return String(a[0]).localeCompare(String(b[0]));
    });
    rows.unshift(header);

    return rows
      .map(function (row) {
        return row
          .map(function (cell) {
            var text = String(cell);
            return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
          })
          .join(',');
      })
      .join('\n');
  }

  root.buildSampleCSV = buildSampleCSV;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildSampleCSV: buildSampleCSV };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
