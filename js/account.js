/* ============================================================
   Account / Login / Register — lead capture + saved homes
   ------------------------------------------------------------
   HOW THE BACKEND HOOKS IN (for Andrew):
   Works fully today with no backend: accounts live in the
   visitor's browser (localStorage) and every registration is a
   captured lead (preview mode logs to console, same as forms).
   When the backend is ready, set AUTH_API.mode = "live" and add
   the endpoint — register/sign-in/saves then POST there too:
     POST endpoint {action:"register"|"signin"|"save", ...data}
   ============================================================ */

const AUTH_API = {
  mode: "local",       // "local" = browser-only + lead log | "live" = POST to backend
  endpoint: "",        // e.g. https://api.aisyndicate.com/michelle/leads
  apiKey: ""
};

const ACCT_KEY = "mc_account";
const SAVED_KEY = "mc_saved";

/* ---------- state ---------- */
function getAccount() {
  try { return JSON.parse(localStorage.getItem(ACCT_KEY)); } catch (e) { return null; }
}
window.mcSaved = new Set(JSON.parse(localStorage.getItem(SAVED_KEY) || "[]"));

function persistSaved() {
  localStorage.setItem(SAVED_KEY, JSON.stringify([...window.mcSaved]));
}

async function pushToBackend(payload) {
  payload._page = location.pathname;
  payload._ts = new Date().toISOString();
  if (AUTH_API.mode === "live" && AUTH_API.endpoint) {
    try {
      await fetch(AUTH_API.endpoint, {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" },
          AUTH_API.apiKey ? { Authorization: "Bearer " + AUTH_API.apiKey } : {}),
        body: JSON.stringify(payload)
      });
    } catch (e) { console.warn("[account] backend unreachable:", e); }
  } else {
    console.log("[account lead — preview mode, no backend configured]", payload);
  }
}

/* ---------- saved homes ---------- */
window.mcToggleSave = function (id, btn) {
  const acct = getAccount();
  if (!acct) { openAuth("register", id); return; }
  if (window.mcSaved.has(id)) { window.mcSaved.delete(id); if (btn) btn.classList.remove("on"); }
  else { window.mcSaved.add(id); if (btn) btn.classList.add("on"); }
  persistSaved();
  pushToBackend({ action: "save", email: acct.email, listingId: id, saved: [...window.mcSaved] });
  renderNavAuth();
};

/* ---------- nav UI ---------- */
function renderNavAuth() {
  const menu = document.querySelector(".nav-menu");
  if (!menu) return;
  let li = document.getElementById("nav-auth");
  if (!li) { li = document.createElement("li"); li.id = "nav-auth"; li.className = "nav-item"; menu.appendChild(li); }
  const acct = getAccount();
  if (!acct) {
    li.className = "nav-item";
    li.innerHTML = '<a class="nav-link" href="#" data-auth-open><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"></path></svg> Login / Register</a>';
    li.querySelector("[data-auth-open]").addEventListener("click", (e) => { e.preventDefault(); openAuth("register"); });
  } else {
    const first = (acct.name || "").split(" ")[0] || "there";
    li.className = "nav-item has-dd";
    li.innerHTML =
      '<a class="nav-link" href="#"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"></path></svg> Hi, ' + first + ' <span class="caret">&#9660;</span></a>' +
      '<div class="dropdown">' +
        '<a href="property-search.html?saved=1">Saved Homes (' + window.mcSaved.size + ")</a>" +
        '<a href="#" data-auth-out>Sign Out</a>' +
      "</div>";
    li.querySelector(".nav-link").addEventListener("click", (e) => {
      if (window.innerWidth <= 1280) { e.preventDefault(); li.classList.toggle("open"); }
      else e.preventDefault();
    });
    li.addEventListener("mouseenter", () => { if (window.innerWidth > 1280) li.classList.add("open"); });
    li.addEventListener("mouseleave", () => { if (window.innerWidth > 1280) li.classList.remove("open"); });
    li.querySelector("[data-auth-out]").addEventListener("click", (e) => {
      e.preventDefault();
      localStorage.removeItem(ACCT_KEY);
      renderNavAuth();
    });
  }
}

/* ---------- modal ---------- */
let pendingSaveId = null;

function buildModal() {
  if (document.getElementById("auth-overlay")) return;
  const o = document.createElement("div");
  o.id = "auth-overlay";
  o.innerHTML = `
  <div class="auth-modal" role="dialog" aria-modal="true" aria-label="Login or register">
    <button class="auth-close" aria-label="Close">&times;</button>
    <div class="auth-tabs">
      <button class="auth-tab on" data-tab="register">Register</button>
      <button class="auth-tab" data-tab="signin">Sign In</button>
    </div>
    <div class="auth-pane" data-pane="register">
      <h3>Create your free account</h3>
      <p class="auth-sub">Save favorite homes, get first word on new listings, and message Michelle directly. No password needed.</p>
      <form id="auth-reg" class="form-grid" style="grid-template-columns:1fr">
        <div class="field"><label for="ar-name">Full Name</label><input id="ar-name" name="name" type="text" required></div>
        <div class="field"><label for="ar-email">Email</label><input id="ar-email" name="email" type="email" required></div>
        <div class="field"><label for="ar-phone">Phone (optional)</label><input id="ar-phone" name="phone" type="tel"></div>
        <div class="field"><label for="ar-int">I&rsquo;m interested in</label>
          <select id="ar-int" name="interest"><option>Buying</option><option>Selling</option><option>Buying &amp; Selling</option><option>Just browsing</option></select>
        </div>
        <div><button class="btn brass" type="submit" style="width:100%">Create Account</button>
        <p class="form-note">By registering you agree to be contacted by Michelle Creamer, ARC Realty. Unsubscribe anytime.</p></div>
      </form>
    </div>
    <div class="auth-pane" data-pane="signin" hidden>
      <h3>Welcome back</h3>
      <p class="auth-sub">Enter the email you registered with on this device.</p>
      <form id="auth-in" class="form-grid" style="grid-template-columns:1fr">
        <div class="field"><label for="ai-email">Email</label><input id="ai-email" name="email" type="email" required></div>
        <div><button class="btn" type="submit" style="width:100%">Sign In</button></div>
        <p class="auth-err" hidden>We don&rsquo;t recognize that email on this device yet &mdash; use the Register tab and you&rsquo;ll be set in ten seconds.</p>
      </form>
    </div>
  </div>`;
  document.body.appendChild(o);

  const close = () => o.classList.remove("show");
  o.addEventListener("click", (e) => { if (e.target === o) close(); });
  o.querySelector(".auth-close").addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  o.querySelectorAll(".auth-tab").forEach((t) => t.addEventListener("click", () => {
    o.querySelectorAll(".auth-tab").forEach((x) => x.classList.toggle("on", x === t));
    o.querySelectorAll(".auth-pane").forEach((p) => p.hidden = p.getAttribute("data-pane") !== t.dataset.tab);
  }));

  o.querySelector("#auth-reg").addEventListener("submit", (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    localStorage.setItem(ACCT_KEY, JSON.stringify(data));
    pushToBackend(Object.assign({ action: "register" }, data));
    if (pendingSaveId) { window.mcSaved.add(pendingSaveId); persistSaved();
      const btn = document.querySelector('.lc-save[data-id="' + pendingSaveId + '"]'); if (btn) btn.classList.add("on");
      pendingSaveId = null; }
    close(); renderNavAuth();
  });

  o.querySelector("#auth-in").addEventListener("submit", (e) => {
    e.preventDefault();
    const email = new FormData(e.target).get("email").trim().toLowerCase();
    const acct = getAccount();
    if (acct && acct.email && acct.email.toLowerCase() === email) {
      pushToBackend({ action: "signin", email: email });
      close(); renderNavAuth();
    } else {
      o.querySelector(".auth-err").hidden = false;
    }
  });
}

function openAuth(tab, saveId) {
  pendingSaveId = saveId || null;
  buildModal();
  const o = document.getElementById("auth-overlay");
  o.querySelector('[data-tab="' + (tab || "register") + '"]').click();
  o.classList.add("show");
}
window.openAuth = openAuth;

/* ---------- init ---------- */
document.addEventListener("DOMContentLoaded", () => {
  renderNavAuth();
  // save-heart clicks (cards are re-rendered, so delegate)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".lc-save");
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    window.mcToggleSave(btn.dataset.id, btn);
  });
});
