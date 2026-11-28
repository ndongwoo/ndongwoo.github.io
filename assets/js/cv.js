/**
 * Renders the CV from data/cv.json.
 *
 * - CV view:     elements with [data-cv="<type>"] receive entries of that type.
 *                Optional [data-cv-role="first,co-first"] narrows publications.
 * - Timeline:    type × topic matrix (#timeline-controls) + one-line event feed
 *                (#timeline-list). Selection lives in the URL, e.g.
 *                ?type=publication  ?tag=vestibular  ?cell=talk.genetics  ?featured=1  ?sel=none  ?view=date
 *                (no parameters = everything, grouped by section)
 *
 * Fields that may contain inline HTML (authored by the site owner only):
 *   description, bullets[].  Everything else is escaped.
 */
(function () {
  "use strict";

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let DATA = null;

  /* ---------- helpers ---------- */

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function fmtDate(d) {
    if (!d) return "";
    const [y, m, day] = d.split("-");
    if (!m) return y;
    const mon = MONTHS[parseInt(m, 10) - 1];
    return day ? `${mon} ${parseInt(day, 10)}, ${y}` : `${mon} ${y}`;
  }

  const YEAR_ONLY_IN_CV = new Set(["award", "license"]);

  function fmtWhen(e, inCv) {
    if (e.date) return inCv && YEAR_ONLY_IN_CV.has(e.type) ? e.date.slice(0, 4) : fmtDate(e.date);
    if (e.start) return `${fmtDate(e.start)} - ${e.end ? fmtDate(e.end) : "Present"}`;
    return "";
  }

  // Sortable key: the point in time the entry began ("2026" < "2026-04" < "2026-04-10").
  const sortKey = (e) => e.date || e.start || "";
  const byDateDesc = (a, b) => (sortKey(a) < sortKey(b) ? 1 : sortKey(a) > sortKey(b) ? -1 : 0);

  function boldName(authors) {
    return esc(authors).replace(/\b(Nam DW|Nam D)\b/g, "<strong>$1</strong>");
  }

  function linksHtml(e) {
    const links = (e.links || []).map((l) =>
      `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${l.icon ? `<i class="${esc(l.icon)}"></i> ` : ""}${esc(l.label)}</a>`
    );
    return links.length ? `<p>${links.join("&nbsp;·&nbsp;")}</p>` : "";
  }

  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  function bodyHtml(e) {
    let h = "";
    if (e.type === "review" && e.manuscripts)
      h += `<p>${esc(e.basis || "Since")}: ${esc(fmtDate(e.date))}. ${plural(e.manuscripts, "manuscript")}, ${plural(e.rounds || e.manuscripts, "review round")}.</p>`;
    if (e.description) h += `<p>${e.description}</p>`;
    if (e.bullets && e.bullets.length) h += `<ul>${e.bullets.map((b) => `<li>${b}</li>`).join("")}</ul>`;
    return h;
  }

  function pubCitationHtml(p) {
    const doi = p.doi ? ` <a href="https://doi.org/${esc(p.doi)}" target="_blank" rel="noopener noreferrer">doi:${esc(p.doi)}</a>` : "";
    return `${boldName(p.authors)} ${esc(p.title)} <i>${esc(p.venue)}</i> ${esc(p.citation)}${doi}`;
  }

  /* ---------- CV view ---------- */

  // Entries sharing a `group` collapse into one CV item (e.g. an award won twice).
  function groupEntries(entries) {
    const out = [];
    const seen = new Map();
    for (const e of entries) {
      if (e.group && seen.has(e.group)) { seen.get(e.group).push(e); continue; }
      const bucket = [e];
      if (e.group) seen.set(e.group, bucket);
      out.push(bucket);
    }
    return out;
  }

  function cvItemHtml(bucket) {
    const first = bucket[0];
    if (bucket.length === 1) {
      const e = first;
      return `<div class="resume-item" id="cv-${esc(e.id)}">
        <h4>${esc(e.title)}</h4>
        ${e.subtitle ? `<h5>${esc(e.subtitle)}</h5>` : fmtWhen(e, true) ? `<h5>${esc(fmtWhen(e, true))}</h5>` : ""}
        ${e.org ? `<p><em>${esc(e.org)}</em></p>` : ""}
        ${bodyHtml(e)}${linksHtml(e)}
      </div>`;
    }
    const sameOrg = bucket.every((e) => e.org === first.org);
    const sameDesc = bucket.every((e) => e.description === first.description && !e.bullets);
    if (first.type === "award" || first.date) {
      // Point-in-time entries: "2017 & 2014"
      const when = bucket.map((e) => fmtWhen(e, true)).join(" &amp; ");
      const body = sameDesc
        ? bodyHtml(first)
        : `<ul>${bucket.map((e) => `<li><strong>${esc(fmtWhen(e, true))}:</strong> ${e.description || ""}</li>`).join("")}</ul>`;
      return `<div class="resume-item"><h4>${esc(first.title)}</h4><h5>${when}</h5>${sameOrg && first.org ? `<p><em>${esc(first.org)}</em></p>` : ""}${body}</div>`;
    }
    // Ranged entries (e.g. two military postings): one heading, a dated block per entry.
    return `<div class="resume-item"><h4>${esc(first.title)}</h4>${bucket
      .map((e) => `<h5>${esc(fmtWhen(e))}</h5>${e.org ? `<p><em>${esc(e.org)}</em></p>` : ""}${bodyHtml(e)}${linksHtml(e)}`)
      .join("")}</div>`;
  }

  function renderCv() {
    document.querySelectorAll("[data-cv]").forEach((el) => {
      const type = el.dataset.cv;
      const roles = el.dataset.cvRole ? el.dataset.cvRole.split(",") : null;
      let list = DATA.entries.filter((e) => e.type === type && (!roles || roles.includes(e.role)));
      if (el.dataset.cvSort === "date") list = [...list].sort(byDateDesc);

      if (el.dataset.cvStyle === "citation") {
        el.innerHTML = `<ol>${list.map((p) => `<li>${pubCitationHtml(p)}</li>`).join("")}</ol>`;
      } else if (el.dataset.cvStyle === "line") {
        el.innerHTML = list
          .map((e) => `<p><strong>${esc(e.title)}</strong>${(() => { const p = [e.org, fmtWhen(e, true)].filter(Boolean).join(", "); return p ? ` (${esc(p)})` : ""; })()}${e.description ? ` — ${e.description}` : ""}</p>`)
          .join("");
      } else if (el.dataset.cvStyle === "reviewer-line") {
        const total = list.reduce((n, e) => n + (e.manuscripts || 0), 0);
        el.innerHTML = list.length ? `<div class="resume-item"><ul><li><strong>Invited peer reviewer</strong> for ${list
          .sort((a, b) => (a.date < b.date ? -1 : 1))
          .map((e) => `<em>${esc(e.journal || e.org)}</em> (since ${esc(fmtDate(e.date.slice(0, 7)))})`)
          .join(", ")}; ${plural(total, "manuscript")} reviewed in total.</li></ul></div>` : "";
      } else if (el.dataset.cvStyle === "bullets") {
        el.innerHTML = `<div class="resume-item"><ul>${list
          .map((e) => {
            const when = fmtWhen(e) && e.dateLabel ? `${e.dateLabel.toLowerCase()} ${fmtWhen(e)}` : fmtWhen(e);
            const paren = [e.org, when].filter(Boolean).join(e.dateLabel ? "; " : ", ");
            return `<li><strong>${esc(e.title)}</strong>${paren ? ` (${esc(paren)})` : ""}${e.description ? ` ${e.description}` : ""}.</li>`;
          })
          .join("")}</ul></div>`;
      } else {
        el.innerHTML = groupEntries(list).map(cvItemHtml).join("");
      }
    });

    // Auto-computed counts, e.g. <span data-count="peer-reviewed"></span>
    const pubs = DATA.entries.filter((e) => e.type === "publication" && e.kind !== "letter");
    const counts = {
      "peer-reviewed": pubs.length,
      "first-author": pubs.filter((p) => p.role === "first" || p.role === "co-first").length,
      "counts-as-of": DATA.profile.countsAsOf,
      updated: DATA.profile.updated,
    };
    document.querySelectorAll("[data-count]").forEach((el) => (el.textContent = counts[el.dataset.count] ?? ""));
    document.querySelectorAll("[data-cv-summary]").forEach((el) => (el.textContent = DATA.profile.summary));
  }

  /* ---------- Timeline view ----------
   * Selection is a set of matrix cells "type|tag" (rows = types, columns = topics,
   * plus a "no topic" column). An entry is shown when any of its cells is selected.
   * Ranged entries (start/end) produce two feed events; matrix counts are per entry.
   */

  const NONE = "_none";
  const TODAY = new Date().toISOString().slice(0, 10);
  const QUICK = ["publication", "education", "experience"];
  const sel = new Set();
  let featuredOnly = false;
  let view = "section"; // default; "section" = grouped by type in CV order, "date" = event feed
  let ROWS = [], COLS = [];

  const cellKey = (ty, tg) => `${ty}|${tg}`;
  const entryCols = (e) => (e.tags && e.tags.length ? e.tags : [NONE]);
  const colLabel = (c) => (c === NONE ? "No topic" : DATA.tags[c].short || DATA.tags[c].label);
  const colTitle = (c) => (c === NONE ? "Entries without a topic tag" : DATA.tags[c].label);
  const pool = () => DATA.entries.filter((e) => !featuredOnly || e.featured);
  const isShown = (e) => (!featuredOnly || e.featured) && entryCols(e).some((c) => sel.has(cellKey(e.type, c)));

  // Cells that have at least one entry (ignoring the highlights toggle), used for header state.
  let NONEMPTY = new Set();
  function computeNonEmpty() {
    NONEMPTY = new Set();
    for (const e of DATA.entries) for (const c of entryCols(e)) NONEMPTY.add(cellKey(e.type, c));
  }
  const rowCells = (r) => COLS.map((c) => cellKey(r, c)).filter((k) => NONEMPTY.has(k));
  const colCells = (c) => ROWS.map((r) => cellKey(r, c)).filter((k) => NONEMPTY.has(k));
  const allCells = () => [...NONEMPTY];
  const stateOf = (cells) => {
    const n = cells.filter((k) => sel.has(k)).length;
    return n === 0 ? "off" : n === cells.length ? "on" : "partial";
  };
  const setCells = (cells, on) => cells.forEach((k) => (on ? sel.add(k) : sel.delete(k)));
  const toggleCells = (cells) => setCells(cells, stateOf(cells) !== "on");

  /* URL: nothing = everything; ?sel=none; otherwise union of type= (rows), tag= (columns), cell=type.tag */
  function readUrl() {
    const q = new URLSearchParams(location.search);
    featuredOnly = q.get("featured") === "1";
    view = q.get("view") === "date" ? "date" : "section";
    sel.clear();
    if (q.get("sel") === "none") return;
    const types = (q.get("type") || "").split(",").filter((t) => DATA.types[t]);
    const tags = (q.get("tag") || "").split(",").filter((t) => DATA.tags[t] || t === NONE);
    const cells = (q.get("cell") || "").split(",").filter(Boolean);
    if (!types.length && !tags.length && !cells.length) return setCells(allCells(), true);
    types.forEach((r) => setCells(rowCells(r), true));
    tags.forEach((c) => setCells(colCells(c), true));
    cells.forEach((k) => {
      const [r, c] = k.split(".");
      if (NONEMPTY.has(cellKey(r, c))) sel.add(cellKey(r, c));
    });
  }

  function writeUrl() {
    const q = new URLSearchParams();
    if (stateOf(allCells()) === "off") q.set("sel", "none");
    else if (stateOf(allCells()) !== "on") {
      const covered = new Set();
      const rows = ROWS.filter((r) => rowCells(r).length && stateOf(rowCells(r)) === "on");
      rows.forEach((r) => rowCells(r).forEach((k) => covered.add(k)));
      const cols = COLS.filter((c) => colCells(c).length && stateOf(colCells(c)) === "on" && colCells(c).some((k) => !covered.has(k)));
      cols.forEach((c) => colCells(c).forEach((k) => covered.add(k)));
      const cells = [...sel].filter((k) => !covered.has(k)).map((k) => k.replace("|", "."));
      if (rows.length) q.set("type", rows.join(","));
      if (cols.length) q.set("tag", cols.join(","));
      if (cells.length) q.set("cell", cells.join(","));
    }
    if (featuredOnly) q.set("featured", "1");
    if (view === "date") q.set("view", "date");
    const s = q.toString();
    history.replaceState(null, "", `${location.pathname}${s ? "?" + s : ""}#timeline`);
  }

  function renderControls() {
    const P = pool();
    const shown = P.filter(isShown);
    const count = (list, pred) => list.filter(pred).length;

    // Quick views
    const onlyRow = (r) => stateOf(allCells()) !== "off" && stateOf(rowCells(r)) === "on" &&
      allCells().every((k) => k.startsWith(r + "|") || !sel.has(k));
    const quick = `<div class="tl-quick">
      <button type="button" class="tl-qbtn${stateOf(allCells()) === "on" && !featuredOnly ? " active" : ""}" data-act="quick-all">Everything <span>${DATA.entries.length}</span></button>
      ${QUICK.map((r) => `<button type="button" class="tl-qbtn${onlyRow(r) && !featuredOnly ? " active" : ""}" data-act="quick" data-row="${r}"><i class="bi ${esc(DATA.types[r].icon)}"></i> ${esc(DATA.types[r].label)} <span>${count(DATA.entries, (e) => e.type === r)}</span></button>`).join("")}
    </div>`;

    // Matrix
    const head = COLS.map((c) => {
      const st = stateOf(colCells(c));
      return `<th scope="col"><button type="button" class="tl-h tl-${st}" data-act="col" data-col="${c}" title="${esc(colTitle(c))}">${esc(colLabel(c))}</button></th>`;
    }).join("");
    const body = ROWS.map((r) => {
      const rs = stateOf(rowCells(r));
      const cells = COLS.map((c) => {
        const k = cellKey(r, c);
        const n = count(P, (e) => e.type === r && entryCols(e).includes(c));
        if (!NONEMPTY.has(k)) return `<td class="tl-cell tl-empty-cell"></td>`;
        return `<td><button type="button" class="tl-cell${sel.has(k) ? " on" : ""}${n ? "" : " zero"}" data-act="cell" data-cell="${k}" aria-pressed="${sel.has(k)}" title="${esc(DATA.types[r].label)} × ${esc(colTitle(c))}: ${n}">${n}</button></td>`;
      }).join("");
      const rowShown = count(shown, (e) => e.type === r);
      const rowTotal = count(P, (e) => e.type === r);
      return `<tr><th scope="row"><button type="button" class="tl-h tl-row-h tl-${rs}" data-act="row" data-row="${r}"><i class="bi ${esc(DATA.types[r].icon)}"></i> ${esc(DATA.types[r].short || DATA.types[r].label)}</button></th>${cells}<td class="tl-total"><b>${rowShown}</b>/${rowTotal}</td></tr>`;
    }).join("");
    const foot = COLS.map((c) => `<td class="tl-total"><b>${count(shown, (e) => entryCols(e).includes(c))}</b></td>`).join("");
    const allSt = stateOf(allCells());

    const events = shown.flatMap(eventsOf).length;
    document.getElementById("timeline-controls").innerHTML = `${quick}
      <div class="tl-toolbar">
        <div class="tl-seg" role="group" aria-label="List order">
          <button type="button" class="${view === "date" ? "active" : ""}" data-act="view" data-view="date" aria-pressed="${view === "date"}"><i class="bi bi-calendar3"></i> By date</button>
          <button type="button" class="${view === "section" ? "active" : ""}" data-act="view" data-view="section" aria-pressed="${view === "section"}"><i class="bi bi-list-nested"></i> By section</button>
        </div>
        <button type="button" class="tl-tbtn" data-act="all-on"${allSt === "on" ? " disabled" : ""}><i class="bi bi-check2-all"></i> Select all</button>
        <button type="button" class="tl-tbtn" data-act="all-off"${allSt === "off" ? " disabled" : ""}><i class="bi bi-x-lg"></i> Clear all</button>
        <label class="tl-switch"><input type="checkbox" data-act="featured"${featuredOnly ? " checked" : ""}> Highlights only</label>
      </div>
      <div class="tl-matrix-wrap"><table class="tl-matrix">
        <thead><tr><th scope="col"><button type="button" class="tl-h tl-${allSt}" data-act="corner" title="Toggle everything">Type \\ Topic</button></th>${head}<th scope="col" class="tl-total-h">Shown</th></tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr><th scope="row" class="tl-total-h">Shown</th>${foot}<td class="tl-total tl-grand"><b>${shown.length}</b>/${P.length}</td></tr></tfoot>
      </table></div>`;
    document.getElementById("timeline-summary").innerHTML =
      `Showing <b>${shown.length}</b> of ${P.length} entries${featuredOnly ? " (highlights)" : ""}${view === "date" ? ` as <b>${events}</b> dated events (start and end of a period are listed separately)` : " grouped by section"}. Entries with several topics are counted once in the totals.`;
  }

  /* ---------- feed ---------- */

  function eventsOf(e) {
    if (!e.start) return [{ e, kind: "point", date: e.date || "" }];
    const ev = [{ e, kind: "start", date: e.start }];
    if (e.end && e.end <= TODAY) ev.push({ e, kind: "end", date: e.end });
    return ev;
  }

  // Newest first; within the same date a start sits above the end it follows.
  const rank = { start: 1, point: 1, end: 0 };
  function evCompare(a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return rank[b.kind] - rank[a.kind];
  }

  function rangeText(e) {
    return e.start ? `${fmtDate(e.start)} – ${e.end ? fmtDate(e.end) : "Present"}` : "";
  }

  function eventHtml(ev) {
    const { e, kind } = ev;
    const t = DATA.types[e.type] || { label: e.type, icon: "bi-dot" };
    const verb = kind === "entry" ? "" : kind === "start" ? e.startVerb || t.startVerb || "Started" : kind === "end" ? e.endVerb || t.endVerb || "Ended" : e.dateLabel || "";
    let sub;
    if (e.type === "publication") sub = `<i>${esc(e.venue)}</i>`;
    else if (kind === "end") sub = esc([e.org, rangeText(e)].filter(Boolean).join(" · "));
    else sub = esc(e.org || "");
    const role = e.type === "publication" && e.role !== "co" ? `<span class="ev-badge">${e.role === "first" ? "1st author" : "Co-1st"}</span>` : "";
    const present = kind === "start" && !e.end ? `<span class="ev-badge ev-now">Present</span>` : "";
    const upcoming = kind === "start" && e.end && e.end > TODAY ? `<span class="ev-badge">until ${esc(fmtDate(e.end))}</span>` : "";

    const detail = e.type === "publication"
      ? `<p>${pubCitationHtml(e)}</p>`
      : `${e.org ? `<p class="tl-org"><em>${esc(e.org)}</em></p>` : ""}${e.start ? `<p class="ev-range">${esc(rangeText(e))}</p>` : ""}${bodyHtml(e)}${linksHtml(e)}`;
    const tags = (e.tags || []).map((g) => `<button type="button" class="tl-tag" data-act="tag-only" data-col="${esc(g)}">#${esc(DATA.tags[g]?.label || g)}</button>`).join("");

    return `<li class="ev ev-${kind}">
      <button type="button" class="ev-line" aria-expanded="false">
        <time>${esc(kind === "entry" ? fmtWhen(e) : fmtDate(ev.date)) || "—"}</time>
        <i class="bi ${esc(t.icon)} ev-icon" title="${esc(t.label)}"></i>
        <span class="ev-main">${verb ? `<span class="ev-verb">${esc(verb)}</span> ` : ""}<span class="ev-title">${esc(e.title)}</span>${role}${present}${upcoming}${e.featured ? ' <span class="tl-star" title="Highlight">★</span>' : ""}
          ${sub ? `<span class="ev-sub">${sub}</span>` : ""}</span>
      </button>
      <div class="ev-detail" hidden>${detail}${tags ? `<div class="tl-tags">${tags}</div>` : ""}</div>
    </li>`;
  }

  function renderSectionView() {
    const shown = pool().filter(isShown);
    const line = (e) => eventHtml({ e, kind: "entry", date: sortKey(e) });
    const list = (l) => `<ul class="ev-list">${l.map(line).join("")}</ul>`;
    const html = ROWS.map((r) => {
      const items = shown.filter((e) => e.type === r).sort(byDateDesc);
      if (!items.length) return "";
      const t = DATA.types[r];
      const inner = r === "publication"
        ? [["First / co-first author", items.filter((e) => e.role !== "co")], ["Co-author", items.filter((e) => e.role === "co")]]
            .filter(([, l]) => l.length)
            .map(([h, l]) => `<h4 class="tl-subhead">${h} <span>${l.length}</span></h4>${list(l)}`).join("")
        : list(items);
      return `<div class="tl-year tl-section"><h3 class="tl-year-label"><i class="bi ${esc(t.icon)}"></i> ${esc(t.label)} <span>${items.length}</span></h3>${inner}</div>`;
    }).join("");
    document.getElementById("timeline-list").innerHTML =
      html || `<p class="tl-empty">Nothing selected. Pick cells in the matrix or use “Select all”.</p>`;
  }

  function renderTimeline() {
    if (view === "section") return renderSectionView();
    const events = pool().filter(isShown).flatMap(eventsOf).sort(evCompare);
    const groups = new Map();
    for (const ev of events) {
      const y = ev.date.slice(0, 4) || "Undated";
      if (!groups.has(y)) groups.set(y, []);
      groups.get(y).push(ev);
    }
    document.getElementById("timeline-list").innerHTML = events.length
      ? [...groups].map(([y, list]) => `<div class="tl-year"><h3 class="tl-year-label">${esc(y)} <span>${list.length}</span></h3><ul class="ev-list">${list.map(eventHtml).join("")}</ul></div>`).join("")
      : `<p class="tl-empty">Nothing selected. Pick cells in the matrix or use “Select all”.</p>`;
  }

  function updateTimeline() {
    writeUrl();
    renderControls();
    renderTimeline();
  }

  function showOnly(cells) {
    sel.clear();
    setCells(cells, true);
    featuredOnly = false;
    updateTimeline();
    document.getElementById("timeline-summary").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function onTimelineClick(ev) {
    const line = ev.target.closest(".ev-line");
    if (line) {
      const d = line.nextElementSibling;
      d.hidden = !d.hidden;
      line.setAttribute("aria-expanded", String(!d.hidden));
      line.parentElement.classList.toggle("open", !d.hidden);
      return;
    }
    const el = ev.target.closest("[data-act]");
    if (!el || el.tagName === "INPUT") return;
    switch (el.dataset.act) {
      case "cell": sel.has(el.dataset.cell) ? sel.delete(el.dataset.cell) : sel.add(el.dataset.cell); break;
      case "row": toggleCells(rowCells(el.dataset.row)); break;
      case "col": toggleCells(colCells(el.dataset.col)); break;
      case "corner": toggleCells(allCells()); break;
      case "all-on": setCells(allCells(), true); break;
      case "all-off": sel.clear(); break;
      case "view": view = el.dataset.view; break;
      case "quick": return showOnly(rowCells(el.dataset.row));
      case "quick-all": return showOnly(allCells());
      case "tag-only": return showOnly(colCells(el.dataset.col));
      default: return;
    }
    updateTimeline();
  }

  function onTimelineChange(ev) {
    if (ev.target.dataset.act === "featured") {
      featuredOnly = ev.target.checked;
      updateTimeline();
    }
  }

  // Any element with [data-filter-tag] (e.g. the research topic cards) opens the timeline on that topic.
  function onTopicLink(ev) {
    const el = ev.target.closest("[data-filter-tag]");
    if (!el) return;
    ev.preventDefault();
    showOnly(colCells(el.dataset.filterTag));
  }

  function initTimeline() {
    ROWS = Object.keys(DATA.types);
    COLS = [...Object.keys(DATA.tags), NONE];
    computeNonEmpty();
    readUrl();
    renderControls();
    renderTimeline();
    const root = document.getElementById("timeline");
    root.addEventListener("click", onTimelineClick);
    root.addEventListener("change", onTimelineChange);
  }

  /* ---------- boot ---------- */

  fetch("data/cv.json", { cache: "no-cache" })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((data) => {
      DATA = data;
      renderCv();
      if (document.getElementById("timeline")) initTimeline();
      document.addEventListener("click", onTopicLink);
      document.addEventListener("keydown", (ev) => { if (ev.key === "Enter") onTopicLink(ev); });
      if (window.AOS) window.AOS.refresh();
      // Content above may have changed height; re-apply the hash scroll.
      if (location.hash && document.querySelector(location.hash)) {
        const target = document.querySelector(location.hash);
        setTimeout(() => window.scrollTo({ top: target.offsetTop, behavior: "auto" }), 0);
      }
    })
    .catch((err) => {
      console.error("Failed to load CV data:", err);
      document.querySelectorAll("[data-cv], #timeline-list").forEach((el) => {
        el.innerHTML = '<p class="tl-empty">CV data could not be loaded. Please see my <a href="https://orcid.org/0000-0002-2350-6077">ORCID</a> or <a href="https://scholar.google.com/citations?user=zh9jBmIAAAAJ&amp;hl=en">Google Scholar</a> profile.</p>';
      });
    });
})();
