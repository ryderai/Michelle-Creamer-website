/* Homepage preloader (moved out of index.html so the CSP needs no 'unsafe-inline' for scripts). */
(function () {
  var html = document.documentElement;
  var pl = document.getElementById('preloader');
  if (!pl || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (pl) pl.remove();
    return;
  }
  html.classList.add('pl-active');

  /* Split the name into letters that rise in, one by one */
  var name = pl.querySelector('[data-pl-name]');
  var delay = 0.18;
  Array.prototype.slice.call(name.childNodes).forEach(function (node) {
    if (node.nodeType !== 3 && node.tagName !== 'EM') return;
    var isEm = node.nodeType !== 3;
    var text = node.textContent;
    var frag = document.createDocumentFragment();
    text.split('').forEach(function (ch) {
      if (ch === ' ') { frag.appendChild(document.createTextNode(' ')); return; }
      var w = document.createElement('span'); w.className = 'pl-w';
      var l = document.createElement('span'); l.className = 'pl-l';
      l.style.animationDelay = delay.toFixed(2) + 's';
      l.textContent = ch;
      if (isEm) { var em = document.createElement('em'); em.appendChild(l); w.appendChild(em); }
      else { w.appendChild(l); }
      frag.appendChild(w);
      delay += 0.045;
    });
    name.replaceChild(frag, node);
  });

  /* Eased 0 → 100 counter */
  var counter = pl.querySelector('[data-pl-count]');
  var t0 = null, DUR = 1900;
  function tick(ts) {
    if (!t0) t0 = ts;
    var p = Math.min((ts - t0) / DUR, 1);
    var eased = 1 - Math.pow(1 - p, 3); /* ease-out cubic */
    counter.textContent = Math.round(eased * 100);
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  /* Lift the curtain once the count lands and the page is ready */
  var finished = false;
  function done() {
    if (finished) return;
    finished = true;
    html.classList.add('pl-done');
    setTimeout(function () {
      pl.remove();
      html.classList.remove('pl-active');
    }, 1300);
  }
  var minShow = new Promise(function (r) { setTimeout(r, DUR + 350); });
  var loaded = new Promise(function (r) {
    if (document.readyState === 'complete') r();
    else window.addEventListener('load', r);
  });
  Promise.all([minShow, loaded]).then(done);
  setTimeout(done, 6000); /* failsafe: never trap the visitor */
})();
