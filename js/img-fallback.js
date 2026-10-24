/* Image fallbacks without inline onerror/onclick attributes.
   Inline handlers need 'unsafe-inline' in the site's script rules (CSP);
   this file lets the CSP drop it. Loaded in <head>, so it is listening
   before any image on the page can fail.

     data-fallback="remove"  remove the broken image
     data-fallback="figure"  remove the broken image's <figure>
     data-fallback="hero"    mark the listing's main photo box as "no photo"
     data-thumb              listing thumbnail: click shows it as the main photo */
(function () {
  document.addEventListener("error", function (e) {
    var el = e.target;
    if (!el || el.tagName !== "IMG") return;
    var mode = el.getAttribute("data-fallback");
    if (mode === "remove") {
      el.remove();
    } else if (mode === "figure") {
      var fig = el.closest("figure");
      if (fig) fig.remove();
    } else if (mode === "hero") {
      var box = el.closest(".pd-hero-img");
      if (box) box.classList.add("noimg");
    }
  }, true);

  document.addEventListener("click", function (e) {
    var thumb = e.target && e.target.closest ? e.target.closest("img[data-thumb]") : null;
    if (!thumb) return;
    var main = document.getElementById("pd-main");
    if (main) main.src = thumb.src;
  });
})();
