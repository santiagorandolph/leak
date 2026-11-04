(function () {
  'use strict';

  var detector = window.LeakDetector;
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    result: null,
    currency: 'USD'
  };

  var els = {
    hero: $('hero'),
    home: $('home'),
    results: $('results'),
    dropzone: $('dropzone'),
    file: $('file'),
    pick: $('pick'),
    sample: $('sample'),
    reset: $('reset'),
    error: $('error'),
    errorText: $('error-text'),
    errorReset: $('error-reset'),
    scanNote: $('scan-note'),
    stats: $('stats'),
    duplicates: $('duplicates'),
    empty: $('empty'),
    list: $('list'),
    currency: $('currency')
  };

  var dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  var dayYearFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  var monthYearFmt = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' });

  var CONFIDENCE_LABELS = {
    confident: 'Confident',
    likely: 'Likely',
    possible: 'Possible'
  };

  function money(value) {
    var digits = state.currency === 'JPY' ? 0 : 2;
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: state.currency,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
      }).format(value);
    } catch (err) {
      return '$' + value.toFixed(2);
    }
  }

  function scrollToEl(el) {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  }

  function makeStat(label, value, sub, accent) {
    var stat = document.createElement('div');
    stat.className = 'stat';

    var labelEl = document.createElement('p');
    labelEl.className = 'stat-label';
    labelEl.textContent = label;

    var valueEl = document.createElement('p');
    valueEl.className = 'stat-value' + (accent ? ' accent' : '');
    valueEl.textContent = value;

    stat.appendChild(labelEl);
    stat.appendChild(valueEl);

    if (sub) {
      var subEl = document.createElement('p');
      subEl.className = 'stat-sub';
      subEl.textContent = sub;
      stat.appendChild(subEl);
    }

    return stat;
  }

  function makeCard(item) {
    var card = document.createElement('li');
    card.className = 'charge';

    var top = document.createElement('div');
    top.className = 'charge-top';

    var heading = document.createElement('div');
    var name = document.createElement('h3');
    name.textContent = item.name;
    var category = document.createElement('p');
    category.className = 'category';
    category.textContent = item.categoryLabel;
    heading.appendChild(name);
    heading.appendChild(category);

    var cadence = document.createElement('span');
    cadence.className = 'cadence';
    cadence.textContent = item.cadence;

    top.appendChild(heading);
    top.appendChild(cadence);

    var amountRow = document.createElement('div');
    amountRow.className = 'amount-row';
    var amount = document.createElement('span');
    amount.className = 'amount';
    amount.textContent = money(item.amount);
    var per = document.createElement('span');
    per.className = 'per';
    per.textContent = item.cadence === 'monthly' ? '/mo' : item.cadence === 'yearly' ? '/yr' : '/charge';
    amountRow.appendChild(amount);
    amountRow.appendChild(per);

    var annual = document.createElement('p');
    annual.className = 'annual';
    annual.textContent = '≈ ' + money(item.annual) + ' a year';

    var meta = document.createElement('div');
    meta.className = 'charge-meta';

    var count = document.createElement('span');
    count.textContent = item.occurrences + (item.occurrences === 1 ? ' charge' : ' charges');

    var last = document.createElement('span');
    last.textContent = 'last ' + dayFmt.format(new Date(item.lastDate));

    var conf = document.createElement('span');
    conf.className = 'conf';
    conf.dataset.level = item.confidence;
    conf.textContent = CONFIDENCE_LABELS[item.confidence] || 'Possible';
    conf.title = 'Pattern score ' + Math.round(item.score * 100) + ' out of 100';

    meta.appendChild(count);
    meta.appendChild(last);
    meta.appendChild(conf);

    card.appendChild(top);
    card.appendChild(amountRow);
    card.appendChild(annual);
    card.appendChild(meta);

    return card;
  }

  function makeAlert(group) {
    var alert = document.createElement('div');
    alert.className = 'alert';

    var icon = document.createElement('span');
    icon.innerHTML =
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 9v4"/><path d="M12 17h.01"/>' +
      '<path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>' +
      '</svg>';

    var text = document.createElement('p');
    text.style.margin = '0';
    text.appendChild(document.createTextNode("You're paying for "));
    var count = document.createElement('strong');
    count.textContent = group.names.length + (group.names.length === 1 ? ' service' : ' services');
    text.appendChild(count);
    text.appendChild(document.createTextNode(' in ' + group.label + ' — about '));
    var cost = document.createElement('strong');
    cost.textContent = money(group.annual) + ' a year';
    text.appendChild(cost);
    text.appendChild(document.createTextNode('.'));
    var note = document.createElement('span');
    note.textContent = ' Worth asking which ones earn their keep.';
    text.appendChild(note);
    text.title = group.names.join(', ');

    alert.appendChild(icon);
    alert.appendChild(text);
    return alert;
  }

  function render(result, options) {
    var opts = options || {};

    state.result = result;

    els.error.hidden = true;
    els.hero.hidden = true;
    els.results.hidden = false;

    var start = monthYearFmt.format(new Date(result.range.start));
    var end = monthYearFmt.format(new Date(result.range.end));
    els.scanNote.textContent =
      'Scanned ' + result.transactions + ' transactions · ' +
      (start === end ? start : start + ' – ' + end);

    els.stats.replaceChildren(
      makeStat('Recurring charges', String(result.summary.count), 'monthly or less often', false),
      makeStat('Average per month', money(result.summary.monthly), 'across everything found', false),
      makeStat('Every year', money(result.summary.annual), 'if nothing changes', true)
    );

    els.duplicates.replaceChildren();
    result.duplicates.forEach(function (group) {
      els.duplicates.appendChild(makeAlert(group));
    });

    els.list.replaceChildren();
    result.results.forEach(function (item) {
      els.list.appendChild(makeCard(item));
    });

    els.empty.hidden = result.results.length > 0;

    if (opts.scroll !== false) {
      window.scrollTo({ top: 0, behavior: 'auto' });
      els.results.focus({ preventScroll: true });
    }
  }

  function showError(message) {
    state.result = null;
    els.results.hidden = true;
    els.hero.hidden = false;
    els.error.hidden = false;
    els.errorText.textContent = message;
    scrollToEl(els.error);
  }

  function analyzeText(text) {
    var result;
    try {
      result = detector.analyze(text);
    } catch (err) {
      showError('Something went wrong while reading that file. Check that it is a plain CSV export and try again.');
      return;
    }

    if (result.error) {
      showError(result.error);
      return;
    }

    render(result);
  }

  function handleFile(file) {
    if (!file) return;

    if (file.size > 20 * 1024 * 1024) {
      showError('That file is over 20 MB. Export a shorter date range — three to twelve months is plenty.');
      return;
    }

    if (typeof file.text === 'function') {
      file.text().then(analyzeText).catch(function () {
        showError('The file could not be read. Try exporting it again as a plain CSV.');
      });
      return;
    }

    var reader = new FileReader();
    reader.onload = function () { analyzeText(String(reader.result)); };
    reader.onerror = function () {
      showError('The file could not be read. Try exporting it again as a plain CSV.');
    };
    reader.readAsText(file);
  }

  function reset() {
    state.result = null;
    els.results.hidden = true;
    els.error.hidden = true;
    els.hero.hidden = false;
    els.list.replaceChildren();
    els.stats.replaceChildren();
    els.duplicates.replaceChildren();
    els.file.value = '';
    window.scrollTo({ top: 0, behavior: 'auto' });
    els.pick.focus({ preventScroll: true });
  }

  function bind() {
    els.home.addEventListener('click', function (event) {
      event.preventDefault();
      reset();
    });

    els.pick.addEventListener('click', function () { els.file.click(); });

    els.dropzone.addEventListener('click', function () { els.file.click(); });

    els.dropzone.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        els.file.click();
      }
    });

    els.file.addEventListener('change', function () {
      handleFile(els.file.files && els.file.files[0]);
    });

    els.sample.addEventListener('click', function () {
      if (typeof window.buildSampleCSV === 'function') {
        analyzeText(window.buildSampleCSV());
      }
    });

    els.reset.addEventListener('click', reset);
    els.errorReset.addEventListener('click', reset);

    els.currency.addEventListener('change', function () {
      state.currency = els.currency.value;
      if (state.result) render(state.result, { scroll: false });
    });

    var dragDepth = 0;

    window.addEventListener('dragover', function (event) {
      event.preventDefault();
    });

    window.addEventListener('drop', function (event) {
      event.preventDefault();
    });

    els.dropzone.addEventListener('dragenter', function (event) {
      event.preventDefault();
      dragDepth++;
      els.dropzone.classList.add('dragging');
    });

    els.dropzone.addEventListener('dragover', function (event) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      els.dropzone.classList.add('dragging');
    });

    els.dropzone.addEventListener('dragleave', function () {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) els.dropzone.classList.remove('dragging');
    });

    els.dropzone.addEventListener('drop', function (event) {
      event.preventDefault();
      dragDepth = 0;
      els.dropzone.classList.remove('dragging');
      var files = event.dataTransfer && event.dataTransfer.files;
      handleFile(files && files[0]);
    });
  }

  function init() {
    if (!detector) {
      showError('The detector failed to load. Reload the page and try again.');
      return;
    }
    state.currency = els.currency.value;
    bind();
  }

  init();
})();
