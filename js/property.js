/* ============================================================
   Property Detail Page — renders any listing from the data feed
   URL: property.html?id=<listing id>  or  property.html?mls=<mls#>
   Mirrors the section skeleton of her ARC detail pages:
   Gallery → Address/Price → Request Info → Listing Agent →
   General / Interior / Exterior / Size & Lot / Schools / Utilities →
   Mortgage Calculator → Similar Listings
   When the live MLS feed is connected in js/listings.js, every
   listing in the feed automatically gets this page.
   ============================================================ */

(function () {
  const $ = (s) => document.querySelector(s);

  const escAttr = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  /* ---------- gallery ----------
     GALMLS/Paragon will not send pictures with a listing record
     (`$expand=Media` answers 501 Not Implemented), so the full photo set is
     fetched from /api/media in its own request. Nothing is guessed from the
     MLS number any more: the old {mls}_1.jpg pattern belonged to her ARC
     template and produces dead image links on this feed. */
  async function paintGallery(l, chips) {
    const wrap = $("#pd-gallery");
    if (!wrap) return;

    wrap.innerHTML =
      '<div class="pd-hero-img loading"><div class="lc-chips">' + chips.join("") + "</div>" +
      '<span class="pd-photo-note">Loading photos&hellip;</span></div>';

    let urls = Array.isArray(l.photos) && l.photos.length ? l.photos : null;
    if (!urls && window.fetchListingPhotos) urls = await window.fetchListingPhotos(l.id);
    if (!urls || !urls.length) urls = l.photo ? [l.photo] : [];

    if (!urls.length) {
      wrap.innerHTML =
        '<div class="pd-hero-img noimg"><div class="lc-chips">' + chips.join("") + "</div>" +
        '<span class="pd-photo-note">No photos are published for this listing in the MLS.</span></div>';
      return;
    }

    wrap.innerHTML =
      '<div class="pd-hero-img"><div class="lc-chips">' + chips.join("") + "</div>" +
        '<img id="pd-main" src="' + escAttr(urls[0]) + '" alt="' + escAttr(l.address) +
        '" onerror="this.closest(\'.pd-hero-img\').classList.add(\'noimg\')"></div>' +
      '<div class="pd-thumbs">' + urls.slice(1).map((u) =>
        '<img src="' + escAttr(u) + '" alt="" loading="lazy" decoding="async" onerror="this.remove()" ' +
        'onclick="document.getElementById(\'pd-main\').src=this.src">'
      ).join("") + "</div>";
  }

  function factRow(label, value) {
    if (value == null || value === "") return "";
    return '<div class="pd-row"><span>' + label + "</span><b>" + value + "</b></div>";
  }

  function detailSection(title, rows) {
    const inner = (rows || []).map((r) => factRow(r[0], r[1])).join("");
    if (!inner) return "";
    return '<div class="pd-section"><h3>' + title + '</h3><div class="pd-rows">' + inner + "</div></div>";
  }

  /* Every listing shares property.html, so the static canonical tag in the head
     points at the bare template. Left alone, that tells search engines all
     listings are the same page and only one would ever get indexed. Point the
     canonical (and the markdown twin link) at this specific listing instead. */
  function fixCanonical(l) {
    const abs = location.origin + location.pathname + "?id=" + encodeURIComponent(l.id);
    const c = document.querySelector('link[rel="canonical"]');
    if (c) c.href = abs;
    const md = document.querySelector('link[type="text/markdown"]');
    if (md) md.remove();   // no markdown twin exists for an individual listing
  }

  function render(l, all) {
    fixCanonical(l);
    const priceStr = fmtPrice(l.price) + (l.type === "rental" ? "/mo" : "");
    document.title = l.address.toUpperCase() + ", " + l.city.toUpperCase() + ", " + l.state + " " + l.zip + " | Michelle Creamer, ARC Realty";

    // ---- chips
    const chips = ['<span class="chip status-' + l.status + '">' + STATUS_LABEL[l.status] + "</span>"];
    if (l.openHouse && l.status !== "sold") chips.push('<span class="chip open-house">Open House ' + fmtOpenHouse(l.openHouse) + "</span>");
    if (l.newConstruction) chips.push('<span class="chip">New Construction</span>');
    if (l.luxury) chips.push('<span class="chip">Luxury</span>');
    if (l.type === "rental") chips.push('<span class="chip">For Lease</span>');

    // ---- gallery (fills itself in from /api/media; see paintGallery above)
    paintGallery(l, chips);

    // ---- header
    $("#pd-head").innerHTML =
      '<nav class="breadcrumb" style="color:var(--text-soft)"><a href="index.html">Home</a><span>/</span><a href="property-search.html">Property Search</a><span>/</span><span>' + l.address + "</span></nav>" +
      "<h1>" + l.address + '</h1><p class="pd-city">' + l.city + ", " + l.state + " " + l.zip + (l.community ? " · " + l.community : "") + "</p>" +
      '<div class="pd-price">' + priceStr + "</div>" +
      '<div class="pd-facts">' +
      (l.beds != null ? '<div><b>' + l.beds + "</b><span>Beds</span></div>" : "") +
      (l.baths != null ? '<div><b>' + l.baths + "</b><span>Baths</span></div>" : "") +
      (l.sqft != null ? '<div><b>' + fmtSqft(l.sqft) + "</b><span>Sq. Ft.</span></div>" : "") +
      '<div><b>' + l.mls.replace("PLACEHOLDER-", "") + "</b><span>MLS#</span></div>" +
      "</div>";

    // ---- description
    $("#pd-desc").innerHTML = "<p>" + (l.description || l.blurb || "") + "</p>" +
      (l.description ? "" : '<p class="pd-note">Full MLS remarks, photos, and property details will populate automatically when the live listing feed is connected.</p>');

    // ---- detail sections (her site's exact section order)
    const d = l.details || {};
    $("#pd-details").innerHTML =
      detailSection("General", [
        ["Property Type", l.type === "single-family" ? "Single Family" : l.type === "townhome" ? "Townhome / Condo" : l.type === "lot" ? "Lot / Land" : l.type === "rental" ? "Residential Rental" : "Commercial"],
        ["Status", STATUS_LABEL[l.status]],
        ["MLS#", l.mls.replace("PLACEHOLDER-", "")],
        ["List Price", priceStr],
        ["List Date", d.listDate], ["Year Built", d.yearBuilt], ["County", d.county],
        ["Area", d.area], ["Subdivision", d.subdivision || l.community],
        ["Beds", l.beds], ["Full Bathrooms", l.baths], ["Sq. Ft.", l.sqft != null ? fmtSqft(l.sqft) : null],
        ["Lot Description", d.lot]
      ]) +
      detailSection("Interior Features", (d.interior || []).map((x) => ["•", x])) +
      detailSection("Exterior Features", (d.exterior || []).map((x) => ["•", x])) +
      detailSection("Size and Lot", [["Acres", d.acres], ["Upper Level Sq. Ft.", d.upperSqft], ["Main Level Sq. Ft.", d.mainSqft]]) +
      detailSection("Schools", [["Elementary", d.elementary], ["Middle", d.middle], ["High", d.high]]) +
      detailSection("Utilities", (d.utilities || []).map((x) => ["•", x]));
    if (!$("#pd-details").innerHTML.includes("Interior")) {
      $("#pd-details").innerHTML += '<p class="pd-note">Interior, exterior, school, and utility details arrive with the live MLS feed.</p>';
    }

    // ---- form prefill
    const msg = $("#pd-form textarea");
    if (msg) msg.value = "I'd like more information about " + l.address + ", " + l.city + " (MLS# " + l.mls.replace("PLACEHOLDER-", "") + ").";

    // ---- mortgage calculator
    if (l.type !== "rental" && l.status !== "sold") initCalc(l.price);
    else $("#pd-calc-wrap").style.display = "none";

    // ---- similar listings
    const sim = all.filter((x) => x.id !== l.id && x.status !== "sold" && x.type === l.type &&
      (x.community === l.community || Math.abs((x.price || 0) - (l.price || 0)) < (l.price || 0) * 0.3)).slice(0, 3);
    const simAlt = sim.length ? sim : all.filter((x) => x.id !== l.id && x.status !== "sold").slice(0, 3);
    $("#pd-similar").innerHTML = simAlt.map(listingCard).join("");
    if (window.observeReveals) window.observeReveals($("#pd-similar"));
    if (window.watchPhotoSlots) window.watchPhotoSlots($("#pd-similar"));

    // map link
    const q = encodeURIComponent(l.address + ", " + l.city + ", " + l.state + " " + l.zip);
    $("#pd-map").src = "https://maps.google.com/maps?q=" + q + "&z=15&output=embed";
    $("#pd-map-link").href = "https://maps.google.com/maps?q=" + q;
  }

  function initCalc(price) {
    const P = $("#calc-price"), D = $("#calc-down"), R = $("#calc-rate"), T = $("#calc-term"), OUT = $("#calc-out");
    P.value = price || 500000;
    const run = () => {
      const price = +P.value || 0, down = (+D.value || 0) / 100, rate = (+R.value || 0) / 100 / 12, n = (+T.value || 30) * 12;
      const loan = price * (1 - down);
      const m = rate ? loan * rate / (1 - Math.pow(1 + rate, -n)) : loan / n;
      OUT.textContent = "$" + Math.round(m).toLocaleString("en-US") + "/mo";
    };
    [P, D, R, T].forEach((el) => el.addEventListener("input", run));
    run();
  }

  window.addEventListener("DOMContentLoaded", async () => {
    const params = new URLSearchParams(location.search);
    const id = params.get("id"), mls = params.get("mls");
    const all = await fetchListings();
    const l = all.find((x) => x.id === id || x.mls === mls || x.mls.replace("PLACEHOLDER-", "") === mls);
    if (!l) {
      // No listing to show — stay on the page, hide the empty template,
      // and explain that this page fills in from the MLS feed.
      ["#pd-gallery", "#pd-desc", "#pd-details", "#pd-calc-wrap", "#pd-form-wrap", "#pd-loc-wrap"].forEach((s) => { const el = $(s); if (el) el.style.display = "none"; });
      $("#pd-head").innerHTML =
        '<div class="pd-notice">' +
          '<span class="pd-notice-dot"></span>' +
          "<div><b>Awaiting MLS connection</b>" +
          "<p>" + ((id || mls)
            ? "This property isn&rsquo;t in the current data set — it may have sold, or it&rsquo;s waiting on the live MLS feed. Once the feed is connected, this page will populate automatically."
            : "This page builds itself from the listing feed. Once the live MLS connection is in place, opening any listing will fill in photos, details, schools, and more — automatically.") +
          "</p>" +
          '<a class="btn ghost sm" href="property-search.html">Browse Current Listings</a></div>' +
        "</div>";
      $("#pd-similar").innerHTML = all.filter((x) => x.status !== "sold").slice(0, 3).map(listingCard).join("");
      if (window.observeReveals) window.observeReveals($("#pd-similar"));
      if (window.watchPhotoSlots) window.watchPhotoSlots($("#pd-similar"));
      return;
    }
    render(l, all);
  });
})();
