import { LS_PROFILE, LS_PENDING }                                  from './js/constants.js?v=CACHE_BUST';
import { escapeHtml, fmtDate, fmtAge, fmtStatusDate }               from './js/config.js?v=CACHE_BUST';
import { init as initOnboarding, showOnboarding, showEditProfile,
         showProgressState, resumeBuild }                            from './js/onboarding.js?v=CACHE_BUST';

// ── Reset localStorage (param ?reset pour tester proprement) ─────────────────
if (new URLSearchParams(location.search).has('reset')) {
  Object.keys(localStorage)
    .filter(k => k.startsWith('job-agent:'))
    .forEach(k => localStorage.removeItem(k));
  location.replace(location.pathname + location.search.replace(/[?&]reset/, '').replace(/^&/, '?'));
}

// ── App state ─────────────────────────────────────────────────────────────────

let currentProfile = new URLSearchParams(location.search).get("profile")
  || localStorage.getItem(LS_PROFILE)
  || null;

function profileKey(base) { return `${base}:${currentProfile || "default"}`; }
function lsRead()          { return profileKey("job-agent:read-ids"); }
function lsKnown()         { return profileKey("job-agent:known-ids"); }
function lsTracking()      { return profileKey("job-agent:tracking"); }
function lsView()          { return profileKey("job-agent:view-mode"); }
function offersUrl()       { return `${currentProfile}/offers.json`; }

function loadSet(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); }
  catch { return new Set(); }
}
function saveSet(key, set) { localStorage.setItem(key, JSON.stringify([...set])); }
function loadTracking()    {
  try { return JSON.parse(localStorage.getItem(lsTracking()) || "{}"); }
  catch { return {}; }
}
function saveTracking()    { localStorage.setItem(lsTracking(), JSON.stringify(tracking)); }

const readIds  = loadSet(lsRead());
const tracking = loadTracking();
let newIds   = new Set();

function getManualOffers() { return tracking.__manual__ || []; }

// ── Theme ─────────────────────────────────────────────────────────────────────

(() => {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  document.documentElement.setAttribute("data-theme", mq.matches ? "dark" : "light");
  mq.addEventListener("change", e =>
    document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light")
  );
})();

// ── Détection navigateur → data-browser sur <html> ────────────────────────────
(() => {
  const ua = navigator.userAgent;
  document.documentElement.dataset.browser =
    /Firefox\//.test(ua)                                    ? "firefox" :
    /Safari\//.test(ua) && !/Chrome\/|Chromium\//.test(ua) ? "safari"  : "chrome";
})();

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = ["Postulée", "Entretien", "Relancée", "Refusée"];
const STATUS_CLASS   = {
  "Postulée":  "s-applied",
  "Entretien": "s-interview",
  "Relancée":  "s-followup",
  "Refusée":   "s-rejected",
};
const KANBAN_COLS = [
  { key: "",          label: "À postuler" },
  { key: "Postulée",  label: "Postulée" },
  { key: "Entretien", label: "Entretien" },
  { key: "Relancée",  label: "Relancée" },
  { key: "Refusée",   label: "Refusée" },
];

const state = {
  offers:    [],
  rawOffers: [],
  meta:      null,
  sortKey:   "default",
  sortDir:   1,
  filter:    "",
  hideRead:  false,
  filterStatus: "",
  viewMode:  localStorage.getItem(lsView()) || "table",
};

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $meta          = document.getElementById("meta");
const $tbody         = document.querySelector("#offers tbody");
const $empty         = document.getElementById("empty");
const $filter        = document.getElementById("filter");
const $hideRead      = document.getElementById("hideRead");
const $filterStatus  = document.getElementById("filterStatus");
const $markAll       = document.getElementById("markAllRead");
const $exportCsv     = document.getElementById("exportCsv");
const $viewTable     = document.getElementById("view-table");
const $viewKanban    = document.getElementById("view-kanban");
const $tableWrapper  = document.getElementById("table-wrapper");
const $kanbanWrapper = document.getElementById("kanban-wrapper");
const $openAdd       = document.getElementById("open-add");
const $addDialog     = document.getElementById("add-dialog");
const $addForm       = document.getElementById("add-form");
const $cancelAdd     = document.getElementById("cancel-add");
const $notesDialog = document.getElementById("notes-dialog");
let currentNotesId  = null;
let _notesInitial   = "";

// ── Badges / helpers ──────────────────────────────────────────────────────────

function semanticBadge(s) {
  if (s == null) return "";
  return `<span class="badge sem" title="Similarité sémantique avec le profil">${Math.round(s * 100)}%</span>`;
}
function rankBadge(r) {
  if (r == null) return "";
  const cls = r === 1 ? "rank gold" : r <= 3 ? "rank silver" : "rank";
  return `<span class="${cls}" title="Rang reclassement LLM">★ ${r}</span>`;
}
function newBadge(id) {
  if (!newIds.has(id) || readIds.has(id)) return "";
  return `<span class="badge new" title="Nouvelle offre depuis ta dernière visite">Nouveau</span> `;
}
function sourceBadge(id) {
  const sid = String(id);
  if (sid.startsWith("manual_")) {
    const src = state.offers.find(x => x.id === id)?._source || "Manuel";
    return `<span class="badge src manual" title="${escapeHtml(src)}">${escapeHtml(src)}</span> `;
  }
  return sid.startsWith("lba_")
    ? `<span class="badge src lba" title="La Bonne Alternance">LBA</span> `
    : `<span class="badge src ft"  title="France Travail">FT</span> `;
}
function breakdownTooltip(o) {
  if (!o.score_breakdown) return "";
  return Object.entries(o.score_breakdown)
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => `${k}: ${v >= 0 ? "+" : ""}${typeof v === "number" ? v.toFixed(1) : v}`)
    .join(" | ");
}

// ── Status ────────────────────────────────────────────────────────────────────

function statusSelectHtml(id) {
  const cur  = tracking[id]?.status || "";
  const opts = STATUS_OPTIONS.map(s =>
    `<option value="${s}"${s === cur ? " selected" : ""}>${s}</option>`
  ).join("");
  return `<select class="status-select ${STATUS_CLASS[cur] || ""}" data-id="${escapeHtml(id)}">
    <option value="">—</option>${opts}
  </select>`;
}
function statusDateHtml(id) {
  const t = tracking[id] || {};
  if (!t.status || !t.status_date) return "";
  return `<span class="status-date">${fmtStatusDate(t.status_date)}</span>`;
}

// ── Meta / Dashboard ──────────────────────────────────────────────────────────

function renderMeta() {
  if (!state.meta) { $meta.textContent = ""; return; }
  const m        = state.meta;
  const features = [];
  if (m.semantic_active) features.push("correspondance sémantique");
  if (m.rerank_active)   features.push("reclassement LLM");
  const featStr  = features.length
    ? ` · ${features.join(" + ")} ${features.length > 1 ? "actifs" : "actif"}`
    : "";
  const searches = (m.searches || []).map(s => s.label || s.keyword).filter(Boolean).join(", ");
  const unread   = state.offers.filter(o => !readIds.has(o.id)).length;
  const unreadStr = unread > 0 ? ` · <strong>${unread} non lue${unread > 1 ? "s" : ""}</strong>` : "";
  $meta.innerHTML = `${m.total} offres pour ${searches ? `« ${searches} »` : "ta recherche"} ` +
    `(scrappé le ${fmtDate(m.scraped_at)}${featStr})${unreadStr}.`;
}

const STATUS_PLURAL = {
  "Postulée":  ["postulée", "postulées"],
  "Entretien": ["entretien", "entretiens"],
  "Relancée":  ["relancée", "relancées"],
  "Refusée":   ["refusée", "refusées"],
};

function renderDashboard() {
  const $dash  = document.getElementById("dashboard");
  if (!$dash) return;
  const counts = { "Postulée": 0, "Entretien": 0, "Relancée": 0, "Refusée": 0 };
  for (const t of Object.values(tracking))
    if (t.status && counts[t.status] !== undefined) counts[t.status]++;
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => {
      const [sing, plur] = STATUS_PLURAL[s];
      return `<span class="dash-stat ${STATUS_CLASS[s]}">${n} ${n > 1 ? plur : sing}</span>`;
    });
  $dash.hidden  = parts.length === 0;
  $dash.innerHTML = parts.join(" · ");
}

// ── Filter / sort ─────────────────────────────────────────────────────────────

function matchesFilter(o, q) {
  if (!q) return true;
  const hay = `${o.title||""} ${o.company||""} ${o.location||""} ${o.snippet||""} ${o.llm_reason||""} ${tracking[o.id]?.notes||""}`.toLowerCase();
  return hay.includes(q);
}
function defaultSort(a, b) {
  const ar = a.llm_rank ?? Infinity, br = b.llm_rank ?? Infinity;
  if (ar !== br) return ar - br;
  return (b.score ?? 0) - (a.score ?? 0);
}
function sortAndFilter() {
  const q = state.filter.trim().toLowerCase();
  let rows = state.offers.filter(o => matchesFilter(o, q));
  if (state.hideRead)       rows = rows.filter(o => !readIds.has(o.id));
  if (state.filterStatus === "__none__") rows = rows.filter(o => !tracking[o.id]?.status);
  else if (state.filterStatus)          rows = rows.filter(o => tracking[o.id]?.status === state.filterStatus);
  if (state.sortKey === "default") rows.sort(defaultSort);
  else {
    const k = state.sortKey, dir = state.sortDir;
    rows.sort((a, b) => {
      const va = a[k], vb = b[k];
      if (va == null) return 1; if (vb == null) return -1;
      if (typeof va === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "fr") * dir;
    });
  }
  return rows;
}

// ── Read ──────────────────────────────────────────────────────────────────────

function markRead(id) {
  if (readIds.has(id)) return;
  readIds.add(id);
  saveSet(lsRead(), readIds);
  $tbody.querySelectorAll(`tr[data-id="${id}"]`).forEach(tr => tr.classList.add("read"));
  document.querySelector(`#kanban-wrapper .kanban-card[data-id="${id}"]`)?.classList.add("read");
  renderMeta();
}

// ── Table render ──────────────────────────────────────────────────────────────

function render() {
  const rows = sortAndFilter();
  if (rows.length === 0) { $tbody.innerHTML = ""; $empty.hidden = false; return; }
  $empty.hidden = true;
  $tbody.innerHTML = rows.map(o => {
    const isRead   = readIds.has(o.id);
    const t        = tracking[o.id] || {};
    const hasNotes = !!t.notes?.trim();
    const scoreCls = o.score > 0 ? "pos" : o.score < 0 ? "neg" : "";
    const reasonHtml = o.llm_reason
      ? `<div class="llm-reason">💡 ${escapeHtml(o.llm_reason)}</div>`
      : (o.snippet ? `<div class="snippet">${escapeHtml(o.snippet)}</div>` : "");
    const metaHtml = [o.location, o.contract_type, o.posted_days_ago != null ? fmtAge(o.posted_days_ago) : null]
      .filter(Boolean).map(escapeHtml).join(" · ");
    const trClass  = [isRead ? "read" : "", hasNotes ? "has-notes" : ""].filter(Boolean).join(" ");
    return `
      <tr data-id="${escapeHtml(o.id)}"${trClass ? ` class="${trClass}"` : ""} style="cursor:pointer">
        <td class="rank-cell col-rank">${rankBadge(o.llm_rank)}</td>
        <td class="score ${scoreCls}" title="${escapeHtml(breakdownTooltip(o))}">${(o.score ?? 0).toFixed(1)}</td>
        <td class="title">
          <div class="title-line">${sourceBadge(o.id)}${newBadge(o.id)}${escapeHtml(o.title)}</div>
          ${reasonHtml}
        </td>
        <td class="company-cell">${escapeHtml(o.company || "—")}<span class="meta-line">${metaHtml}</span></td>
        <td class="col-location">${escapeHtml(o.location || "—")}</td>
        <td class="col-contract">${escapeHtml(o.contract_type || "—")}</td>
        <td class="col-rome">${escapeHtml(o.rome_code || "—")}${semanticBadge(o.semantic_score)}</td>
        <td class="col-age">${fmtAge(o.posted_days_ago)}</td>
        <td class="col-link"><a href="${escapeHtml(o.url)}" target="_blank" rel="noopener" data-id="${escapeHtml(o.id)}">Voir l'offre →</a></td>
        <td class="status-cell">
          ${statusSelectHtml(o.id)}
          ${statusDateHtml(o.id)}
        </td>
      </tr>`;
  }).join("");

  $tbody.querySelectorAll("a[data-id]").forEach(a =>
    a.addEventListener("click", () => markRead(a.dataset.id))
  );

  $tbody.querySelectorAll("tr[data-id]").forEach(tr => {
    tr.addEventListener("click", e => {
      if (e.target.closest("a, select, button")) return;
      markRead(tr.dataset.id);
      openNotesModal(tr.dataset.id);
    });
  });

  $tbody.querySelectorAll(".status-select").forEach(sel => {
    sel.addEventListener("change", () => {
      const id = sel.dataset.id, status = sel.value;
      if (!tracking[id]) tracking[id] = {};
      tracking[id].status      = status;
      tracking[id].status_date = status ? new Date().toISOString().slice(0, 10) : null;
      saveTracking();
      sel.className = `status-select ${STATUS_CLASS[status] || ""}`.trim();
      const cell = sel.closest(".status-cell");
      cell.querySelector(".status-date")?.remove();
      const dh = statusDateHtml(id);
      if (dh) sel.insertAdjacentHTML("afterend", dh);
      markRead(id);
      renderDashboard();
    });
  });

}

// ── Kanban ────────────────────────────────────────────────────────────────────

function kanbanCard(o) {
  const isRead = readIds.has(o.id);
  const t      = tracking[o.id] || {};
  const scoreCls = o.score > 0 ? "pos" : o.score < 0 ? "neg" : "";
  const sub = [o.location, o.contract_type, o.posted_days_ago != null ? fmtAge(o.posted_days_ago) : null]
    .filter(Boolean).map(escapeHtml).join(" · ");
  return `
    <div class="kanban-card${isRead ? " read" : ""}" data-id="${escapeHtml(o.id)}" draggable="true">
      <div class="kanban-card-top">
        ${sourceBadge(o.id)}${newBadge(o.id)}${o.llm_rank ? rankBadge(o.llm_rank) : ""}
        <span class="score ${scoreCls}">${(o.score ?? 0).toFixed(1)}</span>
      </div>
      <div class="kanban-card-title">${escapeHtml(o.title)}</div>
      <div class="kanban-card-company">${escapeHtml(o.company || "—")}</div>
      ${sub ? `<div class="kanban-card-sub">${sub}</div>` : ""}
      ${o.llm_reason ? `<div class="llm-reason">💡 ${escapeHtml(o.llm_reason)}</div>` : ""}
      <div class="kanban-card-actions">
        <a href="${escapeHtml(o.url)}" target="_blank" rel="noopener" class="kanban-link" data-id="${escapeHtml(o.id)}">Voir →</a>
      </div>
    </div>`;
}

function renderKanban() {
  const rows = sortAndFilter();
  if (rows.length === 0) { $kanbanWrapper.innerHTML = ""; $empty.hidden = false; return; }
  $empty.hidden = true;
  const groups = {};
  KANBAN_COLS.forEach(c => { groups[c.key] = []; });
  rows.forEach(o => {
    const s = tracking[o.id]?.status || "";
    (groups[s] !== undefined ? groups[s] : groups[""]).push(o);
  });
  $kanbanWrapper.innerHTML = KANBAN_COLS.map(col => `
    <div class="kanban-col">
      <div class="kanban-col-header">
        <span>${escapeHtml(col.label)}</span>
        <span class="kanban-col-count">${groups[col.key].length}</span>
      </div>
      <div class="kanban-cards" data-status="${escapeHtml(col.key)}">
        ${groups[col.key].map(kanbanCard).join("")}
      </div>
    </div>`).join("");

  let _dragging = false;
  $kanbanWrapper.querySelectorAll(".kanban-card").forEach(card => {
    card.addEventListener("dragstart", e => { _dragging = true; e.dataTransfer.setData("text/plain", card.dataset.id); setTimeout(() => card.classList.add("dragging"), 0); });
    card.addEventListener("dragend",   () => { card.classList.remove("dragging"); setTimeout(() => { _dragging = false; }, 0); });
    card.addEventListener("click", e => {
      if (_dragging) return;
      if (e.target.closest(".kanban-link")) return;
      markRead(card.dataset.id);
      openNotesModal(card.dataset.id);
    });
  });
  $kanbanWrapper.querySelectorAll(".kanban-cards").forEach(zone => {
    zone.addEventListener("dragover",  e => { e.preventDefault(); zone.classList.add("drag-over"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", e => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      const id = e.dataTransfer.getData("text/plain");
      const newStatus = zone.dataset.status;
      if (!tracking[id]) tracking[id] = {};
      tracking[id].status      = newStatus;
      tracking[id].status_date = newStatus ? new Date().toISOString().slice(0, 10) : null;
      saveTracking();
      markRead(id);
      renderKanban(); renderDashboard();
    });
  });
  $kanbanWrapper.querySelectorAll(".kanban-link").forEach(a =>
    a.addEventListener("click", () => markRead(a.dataset.id))
  );
}

function renderView() {
  const isKanban = state.viewMode === "kanban";
  $tableWrapper.hidden  = isKanban;
  $kanbanWrapper.hidden = !isKanban;
  if (isKanban) renderKanban(); else render();
}

// ── Profile switcher ──────────────────────────────────────────────────────────

function renderProfileSwitcher(profiles) {
  const $sw = document.getElementById("profile-switcher");
  if (!$sw || profiles.length <= 1) return;
  $sw.hidden   = false;
  $sw.innerHTML = profiles.map(p =>
    `<button class="profile-btn${p.id === currentProfile ? " active" : ""}" data-profile="${escapeHtml(p.id)}">${escapeHtml(p.label)}</button>`
  ).join("");
  $sw.querySelectorAll(".profile-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const pid = btn.dataset.profile;
      localStorage.setItem(LS_PROFILE, pid);
      const url = new URL(location.href);
      url.searchParams.set("profile", pid);
      location.href = url.toString();
    });
  });
}

// ── Notes modal ───────────────────────────────────────────────────────────────

let _scrollY = 0;
function lockScroll()   { _scrollY = window.scrollY; document.documentElement.style.overflow = "hidden"; }
function unlockScroll() { document.documentElement.style.overflow = ""; window.scrollTo(0, _scrollY); }

function openNotesModal(id) {
  currentNotesId = id;
  const offer    = state.offers.find(o => o.id === id);
  _notesInitial  = tracking[id]?.notes || "";

  // Générer le contenu dynamiquement : détails offre + champ notes
  const scoreCls = (offer?.score ?? 0) > 0 ? "pos" : (offer?.score ?? 0) < 0 ? "neg" : "";
  const meta = [offer?.company, offer?.location, offer?.contract_type, offer?.salary]
    .filter(Boolean).map(escapeHtml).join(" · ");
  const bodyHtml = offer?.llm_reason
    ? `<div class="llm-reason">💡 ${escapeHtml(offer.llm_reason)}</div>`
    : offer?.snippet ? `<p class="offer-snippet">${escapeHtml(offer.snippet)}</p>` : "";

  $notesDialog.innerHTML = `
    <div class="dialog-header">
      <button type="button" class="dialog-close nd-cancel" aria-label="Fermer">✕</button>
      <h2>${escapeHtml(offer?.title || "Détail de l'offre")}</h2>
    </div>
    <div class="dialog-2col">
      <div class="dialog-col">
        ${offer ? `
          <div class="offer-detail-top">
            ${meta ? `<p class="offer-detail-meta">${meta}</p>` : ""}
            <span class="score ${scoreCls}">${(offer.score ?? 0).toFixed(1)} pts</span>
          </div>
          ${bodyHtml}
          <a href="${escapeHtml(offer.url)}" target="_blank" rel="noopener" class="offer-detail-link">Voir l'offre sur le site →</a>
        ` : `<p class="offer-detail-meta">Aucun détail disponible.</p>`}
      </div>
      <div class="dialog-col dialog-col-text">
        <label>Vos notes
          <textarea id="notes-dialog-area"
            placeholder="Numéro de tél, nom du contact, ressenti, infos importantes…"
          >${escapeHtml(_notesInitial)}</textarea>
        </label>
      </div>
    </div>
    <div class="dialog-footer">
      <button type="button" class="btn-cancel nd-cancel">Annuler</button>
      <button type="button" class="btn-primary nd-save">Enregistrer</button>
    </div>`;

  const $area = $notesDialog.querySelector("#notes-dialog-area");

  function saveNotes() {
    const val = $area.value;
    if (!tracking[currentNotesId]) tracking[currentNotesId] = {};
    tracking[currentNotesId].notes = val;
    saveTracking();
    const hasNotes = !!val.trim();
    $tbody.querySelector(`tr[data-id="${currentNotesId}"]`)?.classList.toggle("has-notes", hasNotes);
    $kanbanWrapper?.querySelector(`.kanban-card[data-id="${currentNotesId}"]`)?.classList.toggle("has-notes", hasNotes);
    $notesDialog.close();
  }

  function maybeClose() {
    if ($area.value !== _notesInitial &&
        !confirm("Des modifications n'ont pas été enregistrées. Fermer sans sauvegarder ?")) return;
    $notesDialog.close();
  }

  $notesDialog.querySelector(".nd-save")?.addEventListener("click", saveNotes);
  $notesDialog.querySelectorAll(".nd-cancel").forEach(b => b.addEventListener("click", maybeClose));
  // Stocker maybeClose pour backdrop click et ESC
  $notesDialog._maybeClose = maybeClose;

  lockScroll();
  $notesDialog.showModal();
  setTimeout(() => $area?.focus(), 80);
}

$notesDialog?.addEventListener("click",  e => { if (e.target === $notesDialog) $notesDialog._maybeClose?.(); });
$notesDialog?.addEventListener("cancel", e => { e.preventDefault(); $notesDialog._maybeClose?.(); });
$notesDialog?.addEventListener("close",  () => { unlockScroll(); currentNotesId = null; _notesInitial = ""; });

// ── Add manual offer ──────────────────────────────────────────────────────────

function hasFormContent() {
  return [...$addForm.querySelectorAll("input, textarea")].some(el => el.value.trim() !== "");
}
function confirmClose() {
  if (hasFormContent() && !confirm("Des informations ont été saisies. Fermer sans sauvegarder ?")) return;
  $addDialog.close();
}

$openAdd?.addEventListener("click", () => { $addForm.reset(); lockScroll(); $addDialog.showModal(); });
$cancelAdd?.addEventListener("click", confirmClose);
document.querySelector("#add-dialog .dialog-close")?.addEventListener("click", confirmClose);
$addDialog?.addEventListener("click",  e => { if (e.target === $addDialog) confirmClose(); });
$addDialog?.addEventListener("cancel", e => {
  if (hasFormContent()) { e.preventDefault(); if (confirm("Des informations ont été saisies. Fermer sans sauvegarder ?")) $addDialog.close(); }
});
$addDialog?.addEventListener("close", unlockScroll);

$addForm?.addEventListener("submit", e => {
  e.preventDefault();
  const fd  = new FormData($addForm);
  const get = k => fd.get(k)?.trim() || null;
  const id  = `manual_${Date.now()}`;
  const offer = {
    id, title: get("title"), company: get("company"), location: get("location"),
    contract_type: get("contract_type"), url: get("url"), snippet: get("snippet"),
    _source: get("source") || "Manuel",
    salary: null, posted_days_ago: 0, rome_code: null,
    semantic_score: null, llm_rank: null, llm_reason: null, score: 0, score_breakdown: {},
  };
  if (!tracking.__manual__) tracking.__manual__ = [];
  tracking.__manual__.push(offer);
  saveTracking();
  state.offers = [...state.rawOffers, ...getManualOffers()];
  $addDialog.close();
  renderView(); renderDashboard();
  setTimeout(() => {
    $tbody.querySelector(`tr[data-id="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 100);
});

// ── Controls ──────────────────────────────────────────────────────────────────

document.querySelectorAll("th[data-sort]").forEach(th => {
  th.addEventListener("click", () => {
    const k = th.dataset.sort;
    if (state.sortKey === k) state.sortDir *= -1;
    else { state.sortKey = k; state.sortDir = (k === "score" || k === "posted_days_ago" || k === "semantic_score") ? -1 : 1; }
    renderView();
  });
});

// Appliquer la vue sauvegardée dès le chargement
if (state.viewMode === "kanban") {
  $viewKanban?.classList.add("active"); $viewTable?.classList.remove("active");
}

$viewTable?.addEventListener("click", () => {
  state.viewMode = "table";
  localStorage.setItem(lsView(), "table");
  $viewTable.classList.add("active"); $viewKanban.classList.remove("active");
  renderView();
});
$viewKanban?.addEventListener("click", () => {
  state.viewMode = "kanban";
  localStorage.setItem(lsView(), "kanban");
  $viewKanban.classList.add("active"); $viewTable.classList.remove("active");
  renderView();
});

$filter.addEventListener("input",       () => { state.filter       = $filter.value;        renderView(); });
$hideRead.addEventListener("change",     () => { state.hideRead     = $hideRead.checked;    renderView(); });
$filterStatus.addEventListener("change", () => { state.filterStatus = $filterStatus.value;  renderView(); });
$markAll.addEventListener("click", e => {
  e.preventDefault();
  sortAndFilter().forEach(o => readIds.add(o.id));
  saveSet(lsRead(), readIds);
  renderView(); renderMeta();
});

$exportCsv?.addEventListener("click", e => {
  e.preventDefault();
  const cols = ["Titre","Entreprise","Lieu","Contrat","Source","Score","Statut","Date statut","Notes","Lien"];
  const esc  = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = state.offers
    .filter(o => tracking[o.id]?.status)
    .sort((a, b) => {
      const ord = { "Entretien": 0, "Postulée": 1, "Relancée": 2, "Refusée": 3 };
      return (ord[tracking[a.id]?.status] ?? 9) - (ord[tracking[b.id]?.status] ?? 9);
    })
    .map(o => {
      const t   = tracking[o.id] || {};
      const src = String(o.id).startsWith("lba_") ? "La Bonne Alternance" : "France Travail";
      return [o.title, o.company, o.location, o.contract_type, src,
              (o.score ?? 0).toFixed(1), t.status, t.status_date, t.notes, o.url].map(esc).join(",");
    });
  if (!rows.length) { alert("Aucune candidature enregistrée."); return; }
  const blob = new Blob(["﻿" + [cols.map(esc).join(","), ...rows].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), {
    href: url, download: `candidatures_${new Date().toISOString().slice(0,10)}.csv`
  }).click();
  URL.revokeObjectURL(url);
});

document.getElementById("edit-profile-btn")?.addEventListener("click", () => showEditProfile(currentProfile));

// ── Load profile ──────────────────────────────────────────────────────────────

async function loadProfile(profileId) {
  currentProfile = profileId;
  try {
    const r = await fetch(offersUrl(), { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    state.meta      = data.meta;
    state.rawOffers = data.offers || [];
    state.offers    = [...state.rawOffers, ...getManualOffers()];
    const knownIds  = loadSet(lsKnown());
    if (knownIds.size > 0)
      newIds = new Set(state.offers.filter(o => !knownIds.has(o.id)).map(o => o.id));
    saveSet(lsKnown(), new Set(state.offers.map(o => o.id)));
    renderMeta(); renderView(); renderDashboard();
    document.getElementById("edit-profile-btn")?.removeAttribute("hidden");
  } catch (err) {
    const pb = JSON.parse(localStorage.getItem(LS_PENDING) || "null");
    if (pb?.profileId === profileId && pb?.issueNumber) {
      await resumeBuild(profileId);
      return;
    }
    if (pb?.profileId === profileId) localStorage.removeItem(LS_PENDING);
    $meta.textContent = `Erreur de chargement : ${err.message}`;
    $empty.hidden = false;
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

// Appelé après un rebuild pour charger les données fraîches sans passer par le CDN Pages
function receiveOffers(pid, data) {
  currentProfile = pid;
  state.meta      = data.meta;
  state.rawOffers = data.offers || [];
  state.offers    = [...state.rawOffers, ...getManualOffers()];
  const knownIds  = loadSet(lsKnown());
  if (knownIds.size > 0)
    newIds = new Set(state.offers.filter(o => !knownIds.has(o.id)).map(o => o.id));
  saveSet(lsKnown(), new Set(state.offers.map(o => o.id)));
  renderMeta(); renderView(); renderDashboard();
  document.getElementById("edit-profile-btn")?.removeAttribute("hidden");
}

initOnboarding(loadProfile, receiveOffers);

fetch("profiles.json", { cache: "no-store" })
  .then(r => r.ok ? r.json() : null)
  .then(manifest => {
    const profiles = manifest?.profiles || [];
    renderProfileSwitcher(profiles);
    if (!currentProfile) {
      const defaultId = manifest?.default;
      if (defaultId && profiles.some(p => p.id === defaultId)) {
        currentProfile = defaultId;
        localStorage.setItem(LS_PROFILE, defaultId);
        loadProfile(defaultId);
      } else {
        showOnboarding();
      }
      return;
    }
    if (!profiles.some(p => p.id === currentProfile)) {
      localStorage.removeItem(LS_PROFILE);
      currentProfile = null;
      showOnboarding();
      return;
    }
    loadProfile(currentProfile);
  })
  .catch(() => {
    if (!currentProfile) { showOnboarding(); return; }
    // Fallback legacy : offers.json à la racine
    fetch("offers.json", { cache: "no-store" })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => {
        state.meta = data.meta; state.rawOffers = data.offers || [];
        state.offers = [...state.rawOffers, ...getManualOffers()];
        renderMeta(); renderView(); renderDashboard();
      })
      .catch(err => { $meta.textContent = `Erreur : ${err.message}`; $empty.hidden = false; });
  });
