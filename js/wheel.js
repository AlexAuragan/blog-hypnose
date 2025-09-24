

;(function () {
  'use strict';

  /**
     * @type {number} The minimum spin time in seconds for the first reel
     */
  var BASE_SPINNING_DURATION = 2.7;

  /**
     * @type {number} Extra duration added per subsequent reel (seconds)
     */
  var COLUMN_SPINNING_DURATION = 0.3;

  /**
     * @type {number} How many full cycles a reel should visibly travel
     */
  var CYCLES = 8;

  /**
     * @type {number} How many reels to render (default 3). Can be overridden via data-reels on .wheel
     */
  var DEFAULT_REELS = 3;

  // DOM refs
  var root;               // .wheel
  var viewport;           // .wheel-viewport
  var mask                // .wheel-mask
  var spinBtn;            // .wheel-spin
  var dataList;           // #wheel-data
  var resultDlg;          // #wheel-result
  var resultTitleNode;    // [data-title]
  var resultDescNode;     // [data-desc]
  var resultAuthorNode    // [data-author]
  var resultTagNode;      // [data-tag]
  var closeBtn;           // .wheel-close

  // Data / state
  var items = [];         // { title, desc }
  var reels = [];         // [{ colEl, trackEl, cellHeight, itemCount, baseIndex }]
  var reelCount = DEFAULT_REELS;
  var isSpinning = false;


  function parseCSV(text) {
    var lines = text.trim().split(/\r?\n/);
    if (!lines.length) return [];

    // Assume first row is headers, drop it
    lines.shift();

    var results = [];

    for (var i = 0; i < lines.length; i++) {
      var row = lines[i];
      // Split by commas but respect quotes
      var cols = [];
      var re = /(?:^|[,\t])(?:"([^"]*)"|([^",\t]*))/g;
      var match;
      while ((match = re.exec(row))) {
  cols.push(match[1] !== undefined ? match[1] : (match[2] !== undefined ? match[2] : ""));
      }

      if (cols.length >= 2) {
        console.log(cols[0]);
        console.log(cols[1]);
        console.log(cols[2]);
        console.log(cols[3]);
        console.log(cols[4]);
        results.push({
          title: (cols[0] || '').trim(),
          desc: (cols[1] || '').trim(),
          author: (cols[2] || '').trim(),
          video: (cols[3] || '').trim(),
          tag: (cols[4] || '').trim(),
        });
      }
    }
    return results;
  }
  window.addEventListener('DOMContentLoaded', function () {
    root = document.querySelector('.wheel');
    if (!root) return;

    viewport = root.querySelector('.wheel-viewport');
    mask = viewport.querySelector('.wheel-mask');
    spinBtn = root.querySelector('.wheel-spin');

    var resultId = root.getAttribute('data-result-id') || 'wheel-result';
    resultDlg = document.getElementById(resultId);

    if (resultDlg) {
      resultTitleNode = resultDlg.querySelector('[data-title]');
      resultDescNode = resultDlg.querySelector('[data-desc]');
      resultAuthorNode = resultDlg.querySelector('[data-author]');
      resultTagNode = resultDlg.querySelector('[data-tag]');
      closeBtn = resultDlg.querySelector('.wheel-close');
    }

    // Optional: number of reels from data attribute
    var reelsAttr = root.getAttribute('data-reels');
    if (reelsAttr && !isNaN(parseInt(reelsAttr, 10))) {
      reelCount = Math.max(1, parseInt(reelsAttr, 10));
    }

    // Load data from /data/wheel.csv
    fetch('/data/wheel.csv')
      .then(r => r.text())
      .then(text => {
        items = parseCSV(text);
        if (!items.length) return;
        buildReels();
        attachEvents();
      });
  });


  function collectItemsFromDOM() {
    items = [];
    if (!dataList) return;

    var children = dataList.querySelectorAll('li');
    for (var i = 0; i < children.length; i++) {
      var li = children[i];
      var title = li.getAttribute('data-title') || li.textContent.trim();
      var desc = li.getAttribute('data-desc') || '';
      if (title) items.push({ title: title, desc: desc });
    }
  }

  function buildReels() {
    // Clear viewport first
    mask.innerHTML = '';
    reels = [];

    for (var i = 0; i < reelCount; i++) {
      var col = document.createElement('div');
      col.className = 'wheel-col';

      var track = document.createElement('div');
      track.className = 'wheel-track';

      // Repeat items enough times so the reel can travel multiple cycles
      // We’ll also place a stable base block so we can “reset” after each spin.
      var repeatFactor = Math.max(16, CYCLES + 3); // ensure plenty of content
      var fragment = document.createDocumentFragment();

      for (var r = 0; r < repeatFactor; r++) {
        appendItemSet(fragment, items);
      }

      track.appendChild(fragment);
      col.appendChild(track);
      mask.appendChild(col);

      // Measure a cell to get height
      var firstCell = track.querySelector('.wheel-cell');
      var cellHeight = firstCell ? firstCell.getBoundingClientRect().height : 28; // fallback
      var itemCount = items.length;
      var baseIndex = itemCount * 3; // a “middle” anchor to start from

      // Pre-position to baseIndex so the reel looks “in the middle”
      setTransition(track, 'none');
      setTransform(track, -(baseIndex * cellHeight));
      // force reflow
      void track.offsetHeight;

      reels.push({
        colEl: col,
        trackEl: track,
        cellHeight: cellHeight,
        itemCount: itemCount,
        baseIndex: baseIndex
      });
    }
  }

  function appendItemSet(fragment, src) {
    for (var i = 0; i < src.length; i++) {
      var cell = document.createElement('div');
      cell.className = 'wheel-cell';
      cell.setAttribute('data-item-index', i);
      cell.textContent = src[i].title;
      fragment.appendChild(cell);
    }
  }

  function attachEvents() {
    if (spinBtn) {
      spinBtn.addEventListener('click', function () {
        spin(this);
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', closeResult);
    }

    if (resultDlg) {
      resultDlg.addEventListener('click', function (e) {
        if (e.target === resultDlg) closeResult();
      });

      resultDlg.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeResult();
      });
    }
  }

  /**
     * Called when the “Spin” button is pressed.
     *
     * @param elem {HTMLButtonElement}
     */
  function spin(elem) {
    if (isSpinning || !reels.length) return;

    isSpinning = true;
    if (elem) {
      elem.setAttribute('disabled', 'true');
      elem.setAttribute('aria-disabled', 'true');
    }
    root.classList.add('spinning');

    // Choose ONE target item for all reels (feels like a “win” and matches your single-result dialog)
    var targetIndex = getRandomIndex(items.length);
    var target = items[targetIndex];

    var baseDuration = BASE_SPINNING_DURATION + randomDuration();
    var longestDuration = baseDuration;

    for (var i = 0; i < reels.length; i++) {
      var extra = (i * (COLUMN_SPINNING_DURATION + randomDuration()));
      var duration = baseDuration + extra;
      if (duration > longestDuration) longestDuration = duration;

      spinReelTo(reels[i], targetIndex, duration);
    }

    // Announce result after the last reel stops
    window.setTimeout(function () {
      openResult(target);
      isSpinning = false;
      if (elem) {
        elem.removeAttribute('disabled');
        elem.removeAttribute('aria-disabled');
      }
      root.classList.remove('spinning');
    }, (longestDuration * 1000) + 60); // tiny buffer
  }

  /**
     * Animate a single reel to land on targetIndex.
     *
     * @param reel {object}
     * @param targetIndex {number}
     * @param durationSec {number}
     */
  function spinReelTo(reel, targetIndex, durationSec) {
    var track = reel.trackEl;
    var h = reel.cellHeight;
    var n = reel.itemCount;

    var offset = h / 2

    // Always start each spin from the reel's baseIndex (instant jump, hidden by “spinning” CSS)
    setTransition(track, 'none');
    setTransform(track, -(reel.baseIndex * h) + offset);
    void track.offsetHeight; // reflow

    // Compute a far-away end index to show multiple cycles
    var endIndex = reel.baseIndex + (CYCLES * n) + targetIndex;

    // Animate to endIndex
    setTransition(track, 'transform ' + durationSec + 's cubic-bezier(.17,.67,.15,1)');
    setTransform(track, -(endIndex * h) + offset);

    // After transition, snap back to a clean equivalent position so values don't grow forever
    var cleanup = function () {
      track.removeEventListener('transitionend', cleanup);

      // Normalize: place the same visible item at baseIndex + targetIndex
      var normalizedIndex = (reel.baseIndex + targetIndex) % n;
      var snapIndex = reel.baseIndex + normalizedIndex; // keep it in the comfortable zone

      setTransition(track, 'none');
      setTransform(track, -(snapIndex * h) + offset);
      void track.offsetHeight; // reflow
    };
    track.addEventListener('transitionend', cleanup, { once: true });
  }

  function openResult(item) {
    if (!resultDlg) return;
    if (resultTitleNode) resultTitleNode.textContent = item.title;
    if (resultDescNode) resultDescNode.textContent = item.desc || '';
    if (resultAuthorNode) resultAuthorNode.textContent =item.author || '';
    if (resultTagNode) resultTagNode.textContent = item.tag || '';

    resultDlg.removeAttribute('hidden');
    var card = resultDlg.querySelector('.wheel-card');
    if (card) {
      card.setAttribute('tabindex', '-1');
      card.focus({ preventScroll: true });
    }
    // Prevent screen readers from double-announcing background content while dialog is open
    mask.setAttribute('aria-hidden', 'true');
  }

  function closeResult() {
    if (!resultDlg) return;
    resultDlg.setAttribute('hidden', 'true');
    mask.removeAttribute('aria-hidden');
    if (spinBtn) spinBtn.focus({ preventScroll: true });
  }

  function getRandomIndex(maxExclusive) {
    return Math.floor(Math.random() * maxExclusive);
  }

  /**
     * @returns {number} 0.00–0.09 inclusive
     */
  function randomDuration() {
    return Math.floor(Math.random() * 10) / 100;
  }

  function setTransition(el, value) {
    el.style.transition = value;
    el.style.webkitTransition = value;
  }

  function setTransform(el, translateYpx) {
    var v = 'translateY(' + translateYpx + 'px)';
    el.style.transform = v;
    el.style.webkitTransform = v;
  }
})();
