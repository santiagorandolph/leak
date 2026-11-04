/*
 * Leak — recurring-charge detector.
 *
 * Pure functions: no DOM, no network. Runs in the browser and in Node for
 * tests. Given a bank CSV, it finds charges that repeat on a monthly-or-longer
 * cadence and estimates their yearly cost.
 */
(function (root) {
  'use strict';

  var DAY = 86400000;

  var DATE_RE = /(date|datum|fecha|posted|posting|booked|booking)/i;
  var DESC_RE = /(description|merchant|payee|detail|narrative|memo|name|reference|label|text|concept|libell)/i;
  var AMOUNT_RE = /(amount|value|sum|total|betrag|montant|importe)/i;
  var DEBIT_RE = /(debit|withdrawal|withdraw|money out|outflow|charge|paid out|abgang|soll|cargo)/i;
  var CREDIT_RE = /(credit|deposit|money in|inflow|haben|abono)/i;
  var BALANCE_RE = /(balance|saldo|solde|kontostand)/i;
  var INCOME_RE = /(payroll|salary|direct dep|deposit|interest|refund|reversal|transfer|xfer|cashback|rewards)/i;

  var CATEGORIES = [
    {
      key: 'streaming',
      label: 'Streaming & audio',
      re: /(netflix|hulu|disney|hbo|max\b|paramount|peacock|spotify|tidal|audible|apple music|youtube|prime video|crunchyroll|deezer|soundcloud|scribd|storytel|kindle unlimited)/
    },
    {
      key: 'software',
      label: 'Software & cloud',
      re: /(icloud|apple bill|google one|dropbox|microsoft|office 365|adobe|notion|openai|chatgpt|github|canva|slack|zoom|1password|nordvpn|expressvpn|grammarly|figma|linear|vercel|netlify|setapp|evernote|lastpass)/
    },
    {
      key: 'fitness',
      label: 'Fitness',
      re: /(gym|fitness|peloton|strava|classpass|equinox|orangetheory|barry|yoga|crossfit|pilates|climbing)/
    },
    {
      key: 'news',
      label: 'News & reading',
      re: /(nytimes|new york times|wsj|wall street|economist|washington post|guardian|substack|medium|bloomberg|financial times|atlantic|wired|the information|newspaper|times digital)/
    },
    {
      key: 'gaming',
      label: 'Gaming',
      re: /(playstation|psn|xbox|nintendo|steam|ea play|ubisoft|riot|blizzard|world of warcraft|game pass)/
    },
    {
      key: 'telecom',
      label: 'Phone & internet',
      re: /(comcast|xfinity|at&t|att\b|verizon|t-mobile|tmobile|vodafone|orange|sky\b|spectrum|cox\b|centurylink|internet|broadband|mobile)/
    },
    {
      key: 'shopping',
      label: 'Memberships',
      re: /(amazon prime|costco|walmart|sam s club|membership|warehouse club)/
    },
    {
      key: 'insurance',
      label: 'Insurance',
      re: /(insurance|geico|state farm|progressive|allstate|aviva|axa)/
    },
    {
      key: 'utilities',
      label: 'Utilities',
      re: /(electric|energy|water|gas bill|utility|pg&e|con ed|duke energy)/
    },
    {
      key: 'food',
      label: 'Food & delivery',
      re: /(doordash|uber eats|grubhub|instacart|hellofresh|blue apron|factor|seamless|deliveroo|just eat|meal kit)/
    }
  ];

  var FLAGGED = { streaming: 1, software: 1, fitness: 1, news: 1, gaming: 1 };

  var BRANDS = {
    netflix: 'Netflix',
    spotify: 'Spotify',
    hulu: 'Hulu',
    disney: 'Disney+',
    'disney plus': 'Disney+',
    icloud: 'iCloud',
    'apple bill': 'Apple',
    comcast: 'Comcast',
    'comcast xfinity': 'Comcast',
    xfinity: 'Xfinity',
    'planet fitness': 'Planet Fitness',
    nytimes: 'The New York Times',
    'nytimes digital': 'The New York Times',
    'new york times': 'The New York Times',
    'amazon prime': 'Amazon Prime',
    'amazon prime annual': 'Amazon Prime',
    'adobe creative': 'Adobe Creative Cloud',
    'google one': 'Google One',
    'microsoft 365': 'Microsoft 365'
  };

  /* ------------------------------------------------------------------ CSV */

  function pickDelimiter(line) {
    var best = ',';
    var bestCount = -1;
    [',', ';', '\t', '|'].forEach(function (delim) {
      var count = line.split(delim).length - 1;
      if (count > bestCount) {
        bestCount = count;
        best = delim;
      }
    });
    return best;
  }

  function parseCSV(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    var firstLine = '';
    var lines = text.split(/\r?\n/);
    for (var l = 0; l < lines.length; l++) {
      if (lines[l].trim()) {
        firstLine = lines[l];
        break;
      }
    }
    var delim = pickDelimiter(firstLine);

    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;

    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === delim) {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (c !== '\r') {
        field += c;
      }
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }

    return rows.filter(function (r) {
      return r.some(function (v) {
        return String(v).trim() !== '';
      });
    });
  }

  /* --------------------------------------------------------------- values */

  function parseAmount(raw) {
    if (raw == null) return null;
    if (typeof raw === 'number') return isFinite(raw) ? raw : null;

    var s = String(raw).trim();
    if (!s) return null;

    var negative = /^\(.*\)$/.test(s) || /^-/.test(s) || /-\s*$/.test(s);
    s = s.replace(/\u2212/g, '-').replace(/[^0-9.,-]/g, '');
    s = s.replace(/-/g, '');
    if (!s.trim()) return null;

    if (s.indexOf(',') !== -1 && s.indexOf('.') !== -1) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
        s = s.replace(/\./g, '').replace(',', '.');
      } else {
        s = s.replace(/,/g, '');
      }
    } else if (s.indexOf(',') !== -1) {
      var parts = s.split(',');
      if (parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2) {
        s = parts[0] + '.' + parts[1];
      } else {
        s = s.replace(/,/g, '');
      }
    }

    var n = parseFloat(s);
    if (!isFinite(n)) return null;
    return negative ? -n : n;
  }

  var MONTHS = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
    september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
  };

  function makeUTC(y, m, d) {
    if (!(y >= 1900 && y <= 2200) || m < 1 || m > 12 || d < 1 || d > 31) {
      return null;
    }
    var t = Date.UTC(y, m - 1, d);
    var check = new Date(t);
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
      return null;
    }
    return t;
  }

  function parseDate(raw) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (!s) return null;

    // 2025-01-05, 2025/01/05, 2025.01.05
    var m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return makeUTC(+m[1], +m[2], +m[3]);

    // 05/01/2025 — assume month-first unless that is impossible.
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (m) {
      var a = +m[1];
      var b = +m[2];
      var y = +m[3];
      if (y < 100) y += 2000;
      if (a > 12 && b <= 12) return makeUTC(y, b, a);
      if (b > 12 && a <= 12) return makeUTC(y, a, b);
      return makeUTC(y, a, b);
    }

    // 05 Jan 2025
    m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s,-]+(\d{4})/);
    if (m) {
      var mm = MONTHS[m[2].toLowerCase()];
      if (mm) return makeUTC(+m[3], mm, +m[1]);
    }

    // Jan 5, 2025
    m = s.match(/^([A-Za-z]{3,9})[\s-]+(\d{1,2}),?[\s-]+(\d{4})/);
    if (m) {
      var mm2 = MONTHS[m[1].toLowerCase()];
      if (mm2) return makeUTC(+m[3], mm2, +m[2]);
    }

    return null;
  }

  /* --------------------------------------------------------------- columns */

  function headerIndex(headers, re) {
    for (var i = 0; i < headers.length; i++) {
      if (re.test(headers[i])) return i;
    }
    return -1;
  }

  function inferColumn(rows, test, skip) {
    var width = rows[0].length;
    var best = -1;
    var bestRatio = 0;

    for (var c = 0; c < width; c++) {
      if (skip && skip.indexOf(c) !== -1) continue;
      var ok = 0;
      var total = 0;
      var n = Math.min(rows.length, 40);
      for (var r = 0; r < n; r++) {
        var v = rows[r][c];
        if (v == null || String(v).trim() === '') continue;
        total++;
        if (test(v)) ok++;
      }
      if (total > 0 && ok / total > bestRatio) {
        bestRatio = ok / total;
        best = c;
      }
    }
    return bestRatio >= 0.6 ? best : -1;
  }

  function detectColumns(rows) {
    var headers = rows[0].map(function (h) {
      return String(h).trim().toLowerCase();
    });

    var looksLikeHeader = headers.some(function (h) {
      return DATE_RE.test(h) || AMOUNT_RE.test(h) || DESC_RE.test(h) || DEBIT_RE.test(h) || BALANCE_RE.test(h);
    });
    var dataRows = looksLikeHeader ? rows.slice(1) : rows;
    if (!dataRows.length) return null;

    var dateIdx = headerIndex(headers, DATE_RE);
    var descIdx = -1;
    var amountIdx = headerIndex(headers, AMOUNT_RE);
    if (amountIdx < 0) amountIdx = headerIndex(headers, DEBIT_RE);

    var amountHeader = headers[amountIdx] || '';
    if (BALANCE_RE.test(amountHeader)) amountIdx = -1;
    if (amountIdx === headerIndex(headers, CREDIT_RE) && headerIndex(headers, DEBIT_RE) >= 0) {
      amountIdx = headerIndex(headers, DEBIT_RE);
    }

    var claimed = {};
    [dateIdx, amountIdx, headerIndex(headers, CREDIT_RE), headerIndex(headers, BALANCE_RE)].forEach(function (i) {
      if (i >= 0) claimed[i] = true;
    });

    for (var i = 0; i < headers.length; i++) {
      if (claimed[i]) continue;
      if (DESC_RE.test(headers[i])) {
        descIdx = i;
        break;
      }
    }

    if (!looksLikeHeader) {
      dateIdx = amountIdx = descIdx = -1;
    }

    if (dateIdx < 0) dateIdx = inferColumn(dataRows, function (v) { return parseDate(v) != null; });
    if (amountIdx < 0) {
      amountIdx = inferColumn(dataRows, function (v) {
        return /\d/.test(String(v)) && parseAmount(v) != null;
      }, [dateIdx]);
    }

    if (descIdx < 0) {
      var used = {};
      used[dateIdx] = true;
      used[amountIdx] = true;
      var bestLen = 0;
      var width = dataRows[0].length;
      for (var c = 0; c < width; c++) {
        if (used[c]) continue;
        var sum = 0;
        var count = 0;
        for (var r = 0; r < Math.min(dataRows.length, 40); r++) {
          var val = dataRows[r][c];
          if (val == null) continue;
          var text = String(val).trim();
          if (!text) continue;
          if (parseDate(text) != null && parseAmount(text) != null) continue;
          sum += text.length;
          count++;
        }
        var avg = count ? sum / count : 0;
        if (avg > bestLen) {
          bestLen = avg;
          descIdx = c;
        }
      }
    }

    if (dateIdx < 0 || amountIdx < 0 || descIdx < 0) return null;
    if (descIdx === dateIdx || descIdx === amountIdx || dateIdx === amountIdx) return null;

    return {
      date: dateIdx,
      desc: descIdx,
      amount: amountIdx,
      hasHeader: looksLikeHeader
    };
  }

  /* ------------------------------------------------------------- merchants */

  function merchantKey(desc) {
    var s = String(desc).toLowerCase();
    s = s.replace(/&/g, ' and ');
    s = s.replace(/https?:\/\/\S+/g, ' ');
    s = s.replace(/\bwww\./g, ' ');
    s = s.replace(/[#*]/g, ' ');
    s = s.replace(/\b(x{2,}\d*|\d{3,})\b/g, ' ');
    s = s.replace(/\d+/g, ' ');
    s = s.replace(/[^a-z\s]/g, ' ');
    s = s.replace(
      /\b(pos|debit|credit|card|purchase|payment|pmt|ach|web|online|recur|rec|autopay|auto|pay|annual|monthly|subscr|subscription|renewal|inc|llc|ltd|corp|co|com|usa|us|the)\b/g,
      ' '
    );
    s = s.replace(/\s+/g, ' ').trim();
    return s.split(' ').slice(0, 3).join(' ');
  }

  function titleCase(s) {
    return s.replace(/\b[a-z]/g, function (c) {
      return c.toUpperCase();
    });
  }

  function displayName(key) {
    if (BRANDS[key]) return BRANDS[key];
    return titleCase(key);
  }

  function categoryFor(key) {
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].re.test(key)) return CATEGORIES[i];
    }
    return { key: 'other', label: 'Other' };
  }

  /* -------------------------------------------------------------- analysis */

  function median(values) {
    if (!values.length) return 0;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function allowedInterval(gap) {
    var ranges = [[25, 35], [55, 72], [80, 100], [170, 200], [350, 380]];
    return ranges.some(function (r) {
      return gap >= r[0] && gap <= r[1];
    });
  }

  function cadenceLabel(gap) {
    if (gap <= 35) return 'monthly';
    if (gap <= 72) return 'every 2 months';
    if (gap <= 100) return 'quarterly';
    if (gap <= 200) return 'twice a year';
    return 'yearly';
  }

  function analyzeGroup(items) {
    var sorted = items.slice().sort(function (a, b) { return a.date - b.date; });
    if (sorted.length < 2) return null;

    var amounts = sorted.map(function (t) { return t.amount; });
    var medAmt = median(amounts);
    if (medAmt < 1) return null;

    var gaps = [];
    for (var i = 1; i < sorted.length; i++) {
      gaps.push(Math.round((sorted[i].date - sorted[i - 1].date) / DAY));
    }
    var medGap = median(gaps);
    if (!allowedInterval(medGap)) return null;

    var tol = medGap <= 40 ? 6 : medGap <= 110 ? 12 : 30;
    var badGaps = gaps.filter(function (g) {
      return Math.abs(g - medGap) > tol;
    }).length;
    var maxBad = gaps.length >= 4 ? 1 : 0;
    if (badGaps > maxBad) return null;

    var amtTol = Math.max(2.5, medAmt * 0.18);
    var amtOk = amounts.filter(function (a) {
      return Math.abs(a - medAmt) <= amtTol;
    }).length;
    if (sorted.length >= 3 && amtOk < Math.ceil(sorted.length * 0.7)) return null;
    if (sorted.length === 2) {
      var diff = Math.abs(amounts[0] - amounts[1]);
      if (diff > Math.max(1.5, Math.max(amounts[0], amounts[1]) * 0.12)) return null;
    }

    var gapConsistency = 1 - badGaps / gaps.length;
    var amtConsistency = amtOk / amounts.length;
    var score = 0.42;
    if (sorted.length >= 3) score += 0.12;
    if (sorted.length >= 6) score += 0.1;
    score += 0.18 * amtConsistency + 0.18 * gapConsistency;
    score = Math.min(0.98, score);

    var confidence = score >= 0.8 ? 'confident' : score >= 0.6 ? 'likely' : 'possible';

    var lastDate = sorted[sorted.length - 1].date;

    return {
      amount: Math.round(medAmt * 100) / 100,
      annual: Math.round(medAmt * (365.25 / medGap) * 100) / 100,
      interval: medGap,
      cadence: cadenceLabel(medGap),
      occurrences: sorted.length,
      firstDate: sorted[0].date,
      lastDate: lastDate,
      nextDate: lastDate + medGap * DAY,
      confidence: confidence,
      score: Math.round(score * 100) / 100
    };
  }

  function analyze(text) {
    var rows = parseCSV(text);
    if (rows.length < 2) {
      return { error: 'That file looks empty. Try a CSV export straight from your bank.' };
    }

    var cols = detectColumns(rows);
    if (!cols) {
      return {
        error: "Couldn't find date, description and amount columns in that file. Try exporting transactions as CSV from your bank."
      };
    }

    var transactions = [];
    for (var i = cols.hasHeader ? 1 : 0; i < rows.length; i++) {
      var row = rows[i];
      var date = parseDate(row[cols.date]);
      var amount = parseAmount(row[cols.amount]);
      var desc = String(row[cols.desc] == null ? '' : row[cols.desc]).trim();
      if (date == null || amount == null || !desc) continue;
      transactions.push({ date: date, desc: desc, amount: amount });
    }

    if (transactions.length < 2) {
      return {
        error: 'Only ' + transactions.length + ' readable transactions were found. Check that the file is a transaction export, not a summary.'
      };
    }

    var negatives = transactions.filter(function (t) { return t.amount < 0; });
    var source = negatives.length >= 2 ? negatives : transactions;

    var expenses = source
      .filter(function (t) { return !INCOME_RE.test(t.desc); })
      .map(function (t) {
        return { date: t.date, desc: t.desc, amount: Math.abs(t.amount) };
      });

    var groups = {};
    var seen = {};
    expenses.forEach(function (t) {
      var key = merchantKey(t.desc);
      if (!key || key.length < 2) return;
      var dedupe = key + '|' + t.amount.toFixed(2) + '|' + t.date;
      if (seen[dedupe]) return;
      seen[dedupe] = 1;
      (groups[key] = groups[key] || []).push(t);
    });

    var results = [];
    Object.keys(groups).forEach(function (key) {
      var found = analyzeGroup(groups[key]);
      if (!found) return;
      var category = categoryFor(key);
      results.push({
        key: key,
        name: displayName(key),
        category: category.key,
        categoryLabel: category.label,
        amount: found.amount,
        annual: found.annual,
        interval: found.interval,
        cadence: found.cadence,
        occurrences: found.occurrences,
        firstDate: found.firstDate,
        lastDate: found.lastDate,
        nextDate: found.nextDate,
        confidence: found.confidence,
        score: found.score
      });
    });

    results.sort(function (a, b) { return b.annual - a.annual; });

    var byCategory = {};
    results.forEach(function (r) {
      if (!FLAGGED[r.category]) return;
      (byCategory[r.category] = byCategory[r.category] || {
        key: r.category,
        label: r.categoryLabel,
        annual: 0,
        names: []
      });
      byCategory[r.category].annual += r.annual;
      byCategory[r.category].names.push(r.name);
    });

    var duplicates = Object.keys(byCategory)
      .map(function (k) {
        return byCategory[k];
      })
      .filter(function (g) {
        return g.names.length >= 2;
      })
      .sort(function (a, b) { return b.annual - a.annual; })
      .map(function (g) {
        g.annual = Math.round(g.annual * 100) / 100;
        return g;
      });

    var annualTotal = results.reduce(function (sum, r) { return sum + r.annual; }, 0);
    var monthTotal = annualTotal / 12;

    var dates = transactions.map(function (t) { return t.date; });
    var minDate = Math.min.apply(null, dates);
    var maxDate = Math.max.apply(null, dates);

    return {
      transactions: transactions.length,
      expenses: expenses.length,
      results: results,
      duplicates: duplicates,
      summary: {
        count: results.length,
        annual: Math.round(annualTotal * 100) / 100,
        monthly: Math.round(monthTotal * 100) / 100
      },
      range: {
        start: minDate,
        end: maxDate
      }
    };
  }

  var LeakDetector = {
    parseCSV: parseCSV,
    parseAmount: parseAmount,
    parseDate: parseDate,
    detectColumns: detectColumns,
    merchantKey: merchantKey,
    analyze: analyze
  };

  root.LeakDetector = LeakDetector;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LeakDetector;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
