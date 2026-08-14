/* ============================================================
   Michelle Creamer — site behavior
   Nav (glass), dropdowns, reveals, lead forms, hero search
   ============================================================ */

/* Where website leads go. This is Michelle's brokerage address, taken from
   the Birmingham Association of REALTORS IDX ticket #113466 email thread
   (she is a named recipient on it) and from CJ's Jul 24 2026 forward of an
   email she sent herself. Set this back to "" to send leads to the browser
   console instead of to her. */
const MICHELLE_EMAIL = "mcreamer@arcrealtyco.com";

/* ---------- Navigation ---------- */
(function nav() {
  const wrap = document.querySelector(".nav-wrap");
  const toggle = document.querySelector(".nav-toggle");
  const menu = document.querySelector(".nav-menu");
  if (!wrap) return;

  const onScroll = () => wrap.classList.toggle("scrolled", window.scrollY > 24);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  if (toggle && menu) {
    toggle.addEventListener("click", () => {
      toggle.classList.toggle("open");
      menu.classList.toggle("open");
    });
  }

  // Dropdowns: hover on desktop, tap on mobile
  document.querySelectorAll(".nav-item.has-dd").forEach((item) => {
    const link = item.querySelector(".nav-link");
    item.addEventListener("mouseenter", () => { if (window.innerWidth > 1280) item.classList.add("open"); });
    item.addEventListener("mouseleave", () => { if (window.innerWidth > 1280) item.classList.remove("open"); });
    link.addEventListener("click", (e) => {
      if (window.innerWidth <= 1280) {
        e.preventDefault();
        document.querySelectorAll(".nav-item.has-dd.open").forEach((o) => { if (o !== item) o.classList.remove("open"); });
        item.classList.toggle("open");
      }
    });
  });
})();

/* ---------- Reveal on scroll ---------- */
window.observeReveals = function (root) {
  const els = (root || document).querySelectorAll(".reveal:not(.visible)");
  if (!("IntersectionObserver" in window)) {
    els.forEach((el) => el.classList.add("visible"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("visible"); io.unobserve(en.target); }
    }),
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );
  els.forEach((el) => io.observe(el));
};
document.addEventListener("DOMContentLoaded", () => window.observeReveals());

/* ---------- Hero / quick search → property search page ---------- */
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-quick-search]").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = form.querySelector("input").value.trim();
      window.location.href = "property-search.html" + (q ? "?q=" + encodeURIComponent(q) : "");
    });
  });

  // Prefill search page from ?q=
  const params = new URLSearchParams(window.location.search);
  const q = params.get("q");
  const searchBox = document.querySelector("[data-listing-search]");
  if (q && searchBox) {
    searchBox.value = q;
    searchBox.dispatchEvent(new Event("input"));
  }

  // Prefill contact form "about" field from ?about=
  const about = params.get("about");
  const aboutField = document.querySelector("[data-about-field]");
  if (about && aboutField) aboutField.value = "I'd like to know more about " + about;
});

/* ---------- Lead forms ---------- */
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-lead-form]").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      data._form = form.getAttribute("data-lead-form");
      data._page = window.location.pathname;
      if (MICHELLE_EMAIL) {
        const subject = encodeURIComponent("[michellesellslibertypark.com] " + data._form);
        const body = encodeURIComponent(Object.entries(data).map(([k, v]) => k + ": " + v).join("\n"));
        window.location.href = "mailto:" + MICHELLE_EMAIL + "?subject=" + subject + "&body=" + body;
      } else {
        console.log("[lead — preview mode, no email configured]", data);
      }
      const ok = form.querySelector(".form-success");
      if (ok) ok.classList.add("show");
      form.querySelectorAll("input, textarea, select").forEach((el) => { if (el.type !== "submit") el.value = ""; });
    });
  });
});
