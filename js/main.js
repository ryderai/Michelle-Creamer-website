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

/* ============================================================
   LEAD FORMS
   ------------------------------------------------------------
   These used to be `mailto:` links. That opens the VISITOR'S own
   mail app with a draft they still have to send. On a phone with
   no mail account set up, nothing happened at all — and the page
   said "thank you" regardless, so a lost lead looked exactly like
   a successful one.

   Now the form posts to /api/lead, which sends the email from the
   server and reports back. The success message only appears when
   the lead genuinely went through. If it did not, the visitor is
   told plainly and given Michelle's phone number, and their typed
   answers are LEFT IN THE FORM so nothing they wrote is thrown
   away.
   ============================================================ */
const LEAD_API = "/api/lead";

function leadFallbackHtml(msg) {
  return '<div class="form-error" role="alert">' +
    "<b>" + msg + "</b><br>" +
    'Please call or text Michelle on <a href="tel:2059998164">(205) 999-8164</a>' +
    (MICHELLE_EMAIL ? ', or email <a href="mailto:' + MICHELLE_EMAIL + '">' + MICHELLE_EMAIL + "</a>" : "") +
    ".</div>";
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-lead-form]").forEach((form) => {
    // Bot traps: a hidden field a person never sees, and the time the page
    // was opened. Both are checked server-side.
    const openedAt = Date.now();
    const pot = document.createElement("input");
    pot.type = "text";
    pot.name = "website";
    pot.tabIndex = -1;
    pot.autocomplete = "off";
    pot.setAttribute("aria-hidden", "true");
    pot.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;opacity:0";
    form.appendChild(pot);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const btn = form.querySelector('[type="submit"], button:not([type="button"])');
      const btnText = btn ? btn.textContent : "";
      if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }

      const old = form.querySelector(".form-error");
      if (old) old.remove();

      const data = Object.fromEntries(new FormData(form).entries());
      data._form = form.getAttribute("data-lead-form");
      data._page = window.location.pathname;
      data._started = openedAt;

      let ok = false, message = "";
      try {
        const res = await fetch(LEAD_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data)
        });
        const out = await res.json().catch(() => ({}));
        ok = res.ok && out.ok === true;
        message = out.message || "";
      } catch (err) {
        console.warn("[lead] could not reach the server:", err);
      }

      if (btn) { btn.disabled = false; btn.textContent = btnText; }

      if (ok) {
        const okBox = form.querySelector(".form-success");
        if (okBox) okBox.classList.add("show");
        form.querySelectorAll("input, textarea, select").forEach((el) => {
          if (el.type !== "submit" && el.name !== "website") el.value = "";
        });
      } else {
        // Do NOT clear the fields — the visitor should not have to retype.
        form.insertAdjacentHTML("beforeend",
          leadFallbackHtml(message || "Sorry — that didn’t go through."));
      }
    });
  });
});
