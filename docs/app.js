(() => {
  // --- Constants ---
  const LS_TOKEN    = "job-agent:gh-token";
  const LS_PROFILE  = "job-agent:profile";
  const GH_REPO     = "blevsk/job-agent";
  const ISSUES_TOKEN = "REMPLACER_PAR_TON_TOKEN_ISSUES";

  // --- Profile resolution (URL param > localStorage > default) ---
  let currentProfile = new URLSearchParams(location.search).get("profile")
    || localStorage.getItem(LS_PROFILE)
    || null;   // sera fixé après chargement du manifeste

  function profileKey(base) { return `${base}:${currentProfile || "default"}`; }

  function ghPath()  { return `docs/${currentProfile}/tracking.json`; }
  function ghApi()   { return `https://api.github.com/repos/${GH_REPO}/contents/${ghPath()}`; }
  function offersUrl() { return `${currentProfile}/offers.json`; }

  // Clés localStorage scopées au profil (migration automatique depuis les anciennes clés)
  function lsRead()     { return profileKey("job-agent:read-ids"); }
  function lsKnown()    { return profileKey("job-agent:known-ids"); }
  function lsTracking() { return profileKey("job-agent:tracking"); }

  // --- Thème automatique (préférence système) ---
  (() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    document.documentElement.setAttribute("data-theme", mq.matches ? "dark" : "light");
    mq.addEventListener("change", e =>
      document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light")
    );
  })();

  // --- localStorage helpers ---
  function loadSet(key) {
    try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); }
    catch { return new Set(); }
  }
  function saveSet(key, set) {
    localStorage.setItem(key, JSON.stringify([...set]));
  }
  function loadTracking() {
    try { return JSON.parse(localStorage.getItem(lsTracking()) || "{}"); }
    catch { return {}; }
  }
  function saveTracking() {
    localStorage.setItem(lsTracking(), JSON.stringify(tracking));
  }
  function getToken() { return localStorage.getItem(LS_TOKEN) || ""; }

  // Configuration automatique via lien de partage (#setup=TOKEN dans l'URL)
  if (location.hash.startsWith("#setup=")) {
    const _t = decodeURIComponent(location.hash.slice(7)).trim();
    if (_t) {
      localStorage.setItem(LS_TOKEN, _t);
      history.replaceState(null, "", location.pathname);
      alert("✓ Synchronisation GitHub configurée sur cet appareil !");
    }
  }

  // --- App state ---
  const readIds  = loadSet(lsRead());
  const tracking = loadTracking();
  let newIds    = new Set();
  let ghSha     = null;
  let syncTimer = null;

  // Offres manuelles stockées dans tracking.__manual__ pour être synchro GitHub
  function getManualOffers() { return tracking.__manual__ || []; }
  function saveManualOffers() { saveTracking(); debouncedSync(); }

  const STATUS_OPTIONS = ["Postulée", "Entretien", "Relancée", "Refusée"];
  const STATUS_CLASS   = {
    "Postulée":  "s-applied",
    "Entretien": "s-interview",
    "Relancée":  "s-followup",
    "Refusée":   "s-rejected",
  };
  const KANBAN_COLS = [
    { key: "",           label: "À postuler" },
    { key: "Postulée",   label: "Postulée" },
    { key: "Entretien",  label: "Entretien" },
    { key: "Relancée",   label: "Relancée" },
    { key: "Refusée",    label: "Refusée" },
  ];

  const state = {
    offers: [],      // rawOffers + manualOffers
    rawOffers: [],   // offres depuis offers.json
    meta: null,
    sortKey: "default",
    sortDir: 1,
    filter: "",
    hideRead: false,
    filterStatus: "",
    openNotes: new Set(),
    viewMode: "table",
  };

  // --- DOM refs ---
  const $meta     = document.getElementById("meta");
  const $sync     = document.getElementById("sync-status");
  const $tbody    = document.querySelector("#offers tbody");
  const $empty    = document.getElementById("empty");
  const $filter   = document.getElementById("filter");
  const $hideRead      = document.getElementById("hideRead");
  const $filterStatus  = document.getElementById("filterStatus");
  const $markAll     = document.getElementById("markAllRead");
  const $exportCsv   = document.getElementById("exportCsv");
  const $ghConfig    = document.getElementById("gh-config");
  const $viewTable   = document.getElementById("view-table");
  const $viewKanban  = document.getElementById("view-kanban");
  const $tableWrapper  = document.getElementById("table-wrapper");
  const $kanbanWrapper = document.getElementById("kanban-wrapper");
  const $openAdd          = document.getElementById("open-add");
  const $addDialog        = document.getElementById("add-dialog");
  const $addForm          = document.getElementById("add-form");
  const $cancelAdd        = document.getElementById("cancel-add");
  const $notesDialog      = document.getElementById("notes-dialog");
  const $notesDialogArea  = document.getElementById("notes-dialog-area");
  const $notesDialogTitle = document.getElementById("notes-dialog-title");
  let currentNotesId = null;

  // --- Formatting ---
  function fmtDate(iso) {
    if (!iso) return "?";
    try { return new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }); }
    catch { return iso; }
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return "?";
    if (days === 0) return "aujourd'hui";
    if (days === 1) return "1 jour";
    return `${days} j.`;
  }
  function fmtStatusDate(isoDate) {
    if (!isoDate) return "";
    try { return new Date(isoDate).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }); }
    catch { return isoDate; }
  }
  function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // --- GitHub sync ---
  function setSyncStatus(status) {
    if (!$sync) return;
    const labels  = { syncing: "Synchronisation…", ok: "✓ Synchronisé", error: "⚠ Erreur sync" };
    const classes = { syncing: "sync-pending",      ok: "sync-ok",        error: "sync-error" };
    $sync.textContent = labels[status] || "";
    $sync.className   = `sync-status ${classes[status] || ""}`.trim();
  }

  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }
  function b64decode(b64) {
    const bin   = atob(b64.replace(/\s/g, ""));
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  async function fetchFromGitHub() {
    const token = getToken();
    if (!token) return;
    setSyncStatus("syncing");
    try {
      const r = await fetch(ghApi(), {
        headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
      });
      if (r.status === 404) { ghSha = null; setSyncStatus("ok"); return; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data     = await r.json();
      ghSha          = data.sha;
      const ghData   = JSON.parse(b64decode(data.content));
      // GitHub est la source de vérité ; on préserve les clés locales absentes de GitHub
      const merged = { ...ghData };
      for (const id of Object.keys(tracking)) {
        if (!(id in merged)) merged[id] = tracking[id];
      }
      for (const k of Object.keys(tracking)) delete tracking[k];
      Object.assign(tracking, merged);
      saveTracking();
      setSyncStatus("ok");
      state.offers = [...state.rawOffers, ...getManualOffers()];
      renderView();
      renderDashboard();
    } catch (e) {
      console.error("GitHub fetch:", e);
      setSyncStatus("error");
    }
  }

  async function pushToGitHub() {
    const token = getToken();
    if (!token) return;
    setSyncStatus("syncing");
    try {
      const body = {
        message: "chore: sync tracking",
        content: b64encode(JSON.stringify(tracking, null, 2)),
      };
      if (ghSha) body.sha = ghSha;
      const r = await fetch(ghApi(), {
        method: "PUT",
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      ghSha = (await r.json()).content.sha;
      setSyncStatus("ok");
    } catch (e) {
      console.error("GitHub push:", e);
      setSyncStatus("error");
    }
  }

  function debouncedSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(pushToGitHub, 3000);
  }

  // --- Meta ---
  function renderMeta() {
    if (!state.meta) { $meta.textContent = ""; return; }
    const m        = state.meta;
    const features = [];
    if (m.semantic_active) features.push("matching sémantique");
    if (m.rerank_active)   features.push("re-rank LLM");
    const featStr   = features.length ? ` · ${features.join(" + ")} actif` : "";
    const searches  = (m.searches || []).map(s => s.label || s.keyword).filter(Boolean).join(", ");
    const unread    = state.offers.filter(o => !readIds.has(o.id)).length;
    const unreadStr = unread > 0 ? ` · <strong>${unread} non lue${unread > 1 ? "s" : ""}</strong>` : "";
    $meta.innerHTML = `${m.total} offres pour ${searches ? "« " + searches + " »" : "ta recherche"} ` +
      `(scrappé le ${fmtDate(m.scraped_at)}${featStr})${unreadStr}.`;
  }

  // --- Filter / sort ---
  function matchesFilter(o, q) {
    if (!q) return true;
    const t   = tracking[o.id];
    const hay = `${o.title||""} ${o.company||""} ${o.location||""} ${o.snippet||""} ${o.llm_reason||""} ${t?.notes||""}`.toLowerCase();
    return hay.includes(q);
  }
  function defaultSort(a, b) {
    const ar = a.llm_rank ?? Infinity;
    const br = b.llm_rank ?? Infinity;
    if (ar !== br) return ar - br;
    return (b.score ?? 0) - (a.score ?? 0);
  }
  function sortAndFilter() {
    const q = state.filter.trim().toLowerCase();
    let rows = state.offers.filter(o => matchesFilter(o, q));
    if (state.hideRead)       rows = rows.filter(o => !readIds.has(o.id));
    if (state.filterStatus === "__none__") rows = rows.filter(o => !tracking[o.id]?.status);
    else if (state.filterStatus)          rows = rows.filter(o => tracking[o.id]?.status === state.filterStatus);
    if (state.sortKey === "default") {
      rows.sort(defaultSort);
    } else {
      const k = state.sortKey, dir = state.sortDir;
      rows.sort((a, b) => {
        const va = a[k], vb = b[k];
        if (va == null) return 1;
        if (vb == null) return -1;
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
        return String(va).localeCompare(String(vb), "fr") * dir;
      });
    }
    return rows;
  }

  // --- Badges ---
  function semanticBadge(s) {
    if (s == null) return "";
    return `<span class="badge sem" title="Similarité sémantique avec le profil">${Math.round(s * 100)}%</span>`;
  }
  function rankBadge(r) {
    if (r == null) return "";
    const cls = r === 1 ? "rank gold" : r <= 3 ? "rank silver" : "rank";
    return `<span class="${cls}" title="Rang re-rank LLM">★ ${r}</span>`;
  }
  function newBadge(id) {
    if (!newIds.has(id) || readIds.has(id)) return "";
    return `<span class="badge new" title="Nouvelle offre depuis ta dernière visite">Nouveau</span> `;
  }

  function sourceBadge(id) {
    const sid = String(id);
    if (sid.startsWith("manual_")) {
      const o   = state.offers.find(x => x.id === id);
      const src = o?._source || "Manuel";
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

  // --- Status ---
  function statusSelectHtml(id) {
    const cur = tracking[id]?.status || "";
    const cls = STATUS_CLASS[cur] || "";
    const opts = STATUS_OPTIONS.map(s =>
      `<option value="${s}"${s === cur ? " selected" : ""}>${s}</option>`
    ).join("");
    return `<select class="status-select ${cls}" data-id="${escapeHtml(id)}">
      <option value="">—</option>${opts}
    </select>`;
  }
  function statusDateHtml(id) {
    const t = tracking[id] || {};
    if (!t.status || !t.status_date) return "";
    return `<span class="status-date">${fmtStatusDate(t.status_date)}</span>`;
  }

  // --- Dashboard ---
  const STATUS_PLURAL = {
    "Postulée": ["postulée", "postulées"],
    "Entretien": ["entretien", "entretiens"],
    "Relancée": ["relancée", "relancées"],
    "Refusée": ["refusée", "refusées"],
  };

  function renderDashboard() {
    const $dash = document.getElementById("dashboard");
    if (!$dash) return;
    const counts = { "Postulée": 0, "Entretien": 0, "Relancée": 0, "Refusée": 0 };
    for (const t of Object.values(tracking)) {
      if (t.status && counts[t.status] !== undefined) counts[t.status]++;
    }
    const parts = Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([s, n]) => {
        const [sing, plur] = STATUS_PLURAL[s];
        return `<span class="dash-stat ${STATUS_CLASS[s]}">${n} ${n > 1 ? plur : sing}</span>`;
      });
    if (parts.length) {
      $dash.innerHTML = parts.join(" · ");
      $dash.hidden = false;
    } else {
      $dash.hidden = true;
    }
  }

  // --- Read ---
  function markRead(id) {
    if (readIds.has(id)) return;
    readIds.add(id);
    saveSet(lsRead(), readIds);
    $tbody.querySelectorAll("tr[data-id]").forEach(tr => {
      if (tr.dataset.id === id && !tr.classList.contains("notes-row"))
        tr.classList.add("read");
    });
    document.querySelector(`#kanban-wrapper .kanban-card[data-id="${id}"]`)?.classList.add("read");
    renderMeta();
  }

  // --- Render ---
  function render() {
    const rows = sortAndFilter();
    if (rows.length === 0) {
      $tbody.innerHTML = "";
      $empty.hidden = false;
      return;
    }
    $empty.hidden = true;
    $tbody.innerHTML = rows.map(o => {
      const isRead   = readIds.has(o.id);
      const hasNotes = state.openNotes.has(o.id);
      const t        = tracking[o.id] || {};
      const scoreCls = o.score > 0 ? "pos" : o.score < 0 ? "neg" : "";
      const reasonHtml = o.llm_reason
        ? `<div class="llm-reason">💡 ${escapeHtml(o.llm_reason)}</div>`
        : (o.snippet ? `<div class="snippet">${escapeHtml(o.snippet)}</div>` : "");
      const metaParts = [
        o.location,
        o.contract_type,
        o.posted_days_ago != null ? fmtAge(o.posted_days_ago) : null,
      ].filter(Boolean);
      const metaHtml = metaParts.map(escapeHtml).join(" · ");
      const trClass  = [isRead ? "read" : "", hasNotes ? "notes-open" : ""].filter(Boolean).join(" ");

      return `
        <tr data-id="${escapeHtml(o.id)}"${trClass ? ` class="${trClass}"` : ""}>
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
            <button class="notes-toggle${t.notes ? " has-notes" : ""}" data-id="${escapeHtml(o.id)}" title="Notes">✏</button>
          </td>
        </tr>
        <tr class="notes-row" data-id="${escapeHtml(o.id)}"${hasNotes ? "" : " hidden"}>
          <td colspan="10">
            <textarea class="notes-area" data-id="${escapeHtml(o.id)}"
              placeholder="Numéro de tél, nom du contact, ressenti, infos importantes…"
            >${escapeHtml(t.notes || "")}</textarea>
          </td>
        </tr>`;
    }).join("");

    // "voir" → mark read
    $tbody.querySelectorAll("a[data-id]").forEach(a => {
      a.addEventListener("click", () => markRead(a.dataset.id));
    });

    // Status select
    $tbody.querySelectorAll(".status-select").forEach(sel => {
      sel.addEventListener("change", () => {
        const id = sel.dataset.id, status = sel.value;
        if (!tracking[id]) tracking[id] = {};
        tracking[id].status      = status;
        tracking[id].status_date = status ? new Date().toISOString().slice(0, 10) : null;
        saveTracking();
        debouncedSync();
        sel.className = `status-select ${STATUS_CLASS[status] || ""}`.trim();
        const cell = sel.closest(".status-cell");
        cell.querySelector(".status-date")?.remove();
        const dh = statusDateHtml(id);
        if (dh) sel.insertAdjacentHTML("afterend", dh);
        if (status === "Refusée") markRead(id);
        renderDashboard();
      });
    });

    // Notes toggle
    $tbody.querySelectorAll(".notes-toggle").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        // Sur mobile : modal bottom sheet
        if (window.matchMedia("(max-width: 600px)").matches) {
          openNotesModal(id);
          return;
        }
        // Sur desktop : notes inline
        const row     = $tbody.querySelector(`.notes-row[data-id="${id}"]`);
        const mainRow = $tbody.querySelector(`tr:not(.notes-row)[data-id="${id}"]`);
        if (!row) return;
        const open = !row.hidden;
        if (open) {
          state.openNotes.delete(id);
          row.hidden = true;
          mainRow?.classList.remove("notes-open");
        } else {
          state.openNotes.add(id);
          row.hidden = false;
          mainRow?.classList.add("notes-open");
          row.querySelector("textarea")?.focus();
        }
      });
    });

    // Notes textarea → autosave
    $tbody.querySelectorAll(".notes-area").forEach(ta => {
      ta.addEventListener("input", () => {
        const id = ta.dataset.id;
        if (!tracking[id]) tracking[id] = {};
        tracking[id].notes = ta.value;
        saveTracking();
        debouncedSync();
        const btn = $tbody.querySelector(`.notes-toggle[data-id="${id}"]`);
        if (btn) btn.classList.toggle("has-notes", !!ta.value.trim());
      });
    });
  }

  // --- Kanban ---
  function kanbanCard(o) {
    const isRead = readIds.has(o.id);
    const t      = tracking[o.id] || {};
    const scoreCls = o.score > 0 ? "pos" : o.score < 0 ? "neg" : "";
    const sub = [o.location, o.contract_type, o.posted_days_ago != null ? fmtAge(o.posted_days_ago) : null]
      .filter(Boolean).map(escapeHtml).join(" · ");
    const reasonHtml = o.llm_reason
      ? `<div class="llm-reason">💡 ${escapeHtml(o.llm_reason)}</div>` : "";
    return `
      <div class="kanban-card${isRead ? " read" : ""}" data-id="${escapeHtml(o.id)}" draggable="true">
        <div class="kanban-card-top">
          ${sourceBadge(o.id)}${newBadge(o.id)}${o.llm_rank ? rankBadge(o.llm_rank) : ""}
          <span class="score ${scoreCls}">${(o.score ?? 0).toFixed(1)}</span>
        </div>
        <div class="kanban-card-title">${escapeHtml(o.title)}</div>
        <div class="kanban-card-company">${escapeHtml(o.company || "—")}</div>
        ${sub ? `<div class="kanban-card-sub">${sub}</div>` : ""}
        ${reasonHtml}
        <div class="kanban-card-actions">
          <a href="${escapeHtml(o.url)}" target="_blank" rel="noopener" class="kanban-link" data-id="${escapeHtml(o.id)}">Voir →</a>
          <button class="notes-toggle${t.notes ? " has-notes" : ""} kanban-notes-btn" data-id="${escapeHtml(o.id)}" title="Notes">✏</button>
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

    // Drag & drop
    $kanbanWrapper.querySelectorAll(".kanban-card").forEach(card => {
      card.addEventListener("dragstart", e => {
        e.dataTransfer.setData("text/plain", card.dataset.id);
        setTimeout(() => card.classList.add("dragging"), 0);
      });
      card.addEventListener("dragend", () => card.classList.remove("dragging"));
    });
    $kanbanWrapper.querySelectorAll(".kanban-cards").forEach(zone => {
      zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("drag-over"); });
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
        debouncedSync();
        if (newStatus === "Refusée") markRead(id);
        renderKanban();
        renderDashboard();
      });
    });

    // Notes + links
    $kanbanWrapper.querySelectorAll(".kanban-notes-btn").forEach(btn => {
      btn.addEventListener("click", () => openNotesModal(btn.dataset.id));
    });
    $kanbanWrapper.querySelectorAll(".kanban-link").forEach(a => {
      a.addEventListener("click", () => markRead(a.dataset.id));
    });
  }

  function renderView() {
    const isKanban = state.viewMode === "kanban";
    $tableWrapper.hidden  = isKanban;
    $kanbanWrapper.hidden = !isKanban;
    if (isKanban) renderKanban();
    else render();
  }

  // --- Controls ---
  document.querySelectorAll("th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const k = th.dataset.sort;
      if (state.sortKey === k) { state.sortDir *= -1; }
      else {
        state.sortKey = k;
        state.sortDir = (k === "score" || k === "posted_days_ago" || k === "semantic_score") ? -1 : 1;
      }
      renderView();
    });
  });

  $viewTable?.addEventListener("click", () => {
    state.viewMode = "table";
    $viewTable.classList.add("active");
    $viewKanban.classList.remove("active");
    renderView();
  });
  $viewKanban?.addEventListener("click", () => {
    state.viewMode = "kanban";
    $viewKanban.classList.add("active");
    $viewTable.classList.remove("active");
    renderView();
  });

  $filter.addEventListener("input",   () => { state.filter       = $filter.value;    renderView(); });
  $hideRead.addEventListener("change",     () => { state.hideRead     = $hideRead.checked;   renderView(); });
  $filterStatus.addEventListener("change", () => { state.filterStatus = $filterStatus.value; renderView(); });
  $markAll.addEventListener("click",  e  => {
    e.preventDefault();
    sortAndFilter().forEach(o => readIds.add(o.id));
    saveSet(lsRead(), readIds);
    renderView();
    renderMeta();
  });

  $exportCsv?.addEventListener("click", e => {
    e.preventDefault();
    const cols = ["Titre", "Entreprise", "Lieu", "Contrat", "Source", "Score", "Statut", "Date statut", "Notes", "Lien"];
    const esc  = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = state.offers
      .filter(o => tracking[o.id]?.status)
      .sort((a, b) => {
        const order = { "Entretien": 0, "Postulée": 1, "Relancée": 2, "Refusée": 3 };
        return (order[tracking[a.id]?.status] ?? 9) - (order[tracking[b.id]?.status] ?? 9);
      })
      .map(o => {
        const t = tracking[o.id] || {};
        const src = String(o.id).startsWith("lba_") ? "La Bonne Alternance" : "France Travail";
        return [o.title, o.company, o.location, o.contract_type, src, (o.score ?? 0).toFixed(1),
                t.status, t.status_date, t.notes, o.url].map(esc).join(",");
      });
    if (!rows.length) { alert("Aucune candidature enregistrée."); return; }
    const csv  = [cols.map(esc).join(","), ...rows].join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement("a"), {
      href: url, download: `candidatures_${new Date().toISOString().slice(0,10)}.csv`
    });
    a.click();
    URL.revokeObjectURL(url);
  });

  // --- Modal notes (mobile) ---
  function openNotesModal(id) {
    currentNotesId = id;
    const t     = tracking[id] || {};
    const offer = state.offers.find(o => o.id === id);
    if ($notesDialogTitle) $notesDialogTitle.textContent = offer?.title || "Notes";
    if ($notesDialogArea)  $notesDialogArea.value = t.notes || "";
    lockScroll();
    $notesDialog.showModal();
    setTimeout(() => $notesDialogArea?.focus(), 80);
  }

  $notesDialogArea?.addEventListener("input", () => {
    if (!currentNotesId) return;
    if (!tracking[currentNotesId]) tracking[currentNotesId] = {};
    tracking[currentNotesId].notes = $notesDialogArea.value;
    saveTracking();
    debouncedSync();
    const hasNotes = !!$notesDialogArea.value.trim();
    const btn = $tbody.querySelector(`.notes-toggle[data-id="${currentNotesId}"]`);
    if (btn) btn.classList.toggle("has-notes", hasNotes);
    const kbtn = $kanbanWrapper?.querySelector(`.kanban-notes-btn[data-id="${currentNotesId}"]`);
    if (kbtn) kbtn.classList.toggle("has-notes", hasNotes);
  });

  document.getElementById("close-notes")?.addEventListener("click", () => $notesDialog.close());
  document.getElementById("close-notes-btn")?.addEventListener("click", () => $notesDialog.close());
  $notesDialog?.addEventListener("click", e => { if (e.target === $notesDialog) $notesDialog.close(); });
  $notesDialog?.addEventListener("cancel", e => { e.preventDefault(); $notesDialog.close(); });
  $notesDialog?.addEventListener("close", () => { unlockScroll(); currentNotesId = null; });

  // --- Ajout manuel ---
  // Scroll lock : on touche uniquement overflow-y sur <html>
  // pour ne pas interférer avec overflow-x:clip déjà appliqué par le CSS.
  let _scrollY = 0;
  function lockScroll() {
    _scrollY = window.scrollY;
    document.documentElement.style.overflow = "hidden";
  }
  function unlockScroll() {
    document.documentElement.style.overflow = "";
    window.scrollTo(0, _scrollY);
  }

  function hasFormContent() {
    return [...$addForm.querySelectorAll("input, textarea")].some(el => el.value.trim() !== "");
  }
  function confirmClose() {
    if (hasFormContent() && !confirm("Des informations ont été saisies. Fermer sans sauvegarder ?")) return;
    $addDialog.close();
  }

  $openAdd?.addEventListener("click", () => {
    $addForm.reset();
    lockScroll();
    $addDialog.showModal();
  });
  $cancelAdd?.addEventListener("click", confirmClose);
  document.querySelector("#add-dialog .dialog-close")?.addEventListener("click", confirmClose);
  $addDialog?.addEventListener("click", e => { if (e.target === $addDialog) confirmClose(); });
  // Échap : intercepter avant fermeture native pour demander confirmation si besoin
  $addDialog?.addEventListener("cancel", e => {
    if (hasFormContent()) {
      e.preventDefault();
      if (confirm("Des informations ont été saisies. Fermer sans sauvegarder ?")) $addDialog.close();
    }
  });
  // Restaure le scroll quelle que soit la façon dont la modale se ferme
  $addDialog?.addEventListener("close", unlockScroll);

  $addForm?.addEventListener("submit", e => {
    e.preventDefault();
    const fd  = new FormData($addForm);
    const get = k => fd.get(k)?.trim() || null;
    const id  = `manual_${Date.now()}`;
    const offer = {
      id,
      title:         get("title"),
      company:       get("company"),
      location:      get("location"),
      contract_type: get("contract_type"),
      url:           get("url"),
      snippet:       get("snippet"),
      _source:       get("source") || "Manuel",
      salary:        null,
      posted_days_ago: 0,
      rome_code:     null,
      semantic_score: null,
      llm_rank:      null,
      llm_reason:    null,
      score:         0,
      score_breakdown: {},
    };
    if (!tracking.__manual__) tracking.__manual__ = [];
    tracking.__manual__.push(offer);
    saveManualOffers();
    state.offers = [...state.rawOffers, ...getManualOffers()];
    $addDialog.close();
    renderView();
    renderDashboard();
    // Scroll vers la nouvelle offre
    setTimeout(() => {
      const row = $tbody.querySelector(`tr[data-id="${id}"]`);
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  });

  $ghConfig?.addEventListener("click", () => {
    const current = getToken();
    if (current) {
      const shareUrl = `${location.origin}${location.pathname}#setup=${encodeURIComponent(current)}`;
      navigator.clipboard?.writeText(shareUrl).catch(() => {});
      const newToken = prompt(
        "Token GitHub configuré ✓\n\n" +
        "📋 Lien de partage copié dans le presse-papier.\n" +
        "Envoie ce lien sur ton autre appareil (téléphone, tablette…)\n" +
        "et ouvre-le — la synchro se configurera automatiquement.\n\n" +
        "Pour changer le token, colle-en un nouveau ci-dessous\n(laisse vide pour conserver l'actuel) :",
        ""
      );
      if (newToken?.trim()) {
        localStorage.setItem(LS_TOKEN, newToken.trim());
        fetchFromGitHub();
      }
      return;
    }
    const token = prompt(
      "Colle ici ton Personal Access Token GitHub\n(fine-grained PAT, permission « Contents: Read and write » sur le repo job-agent).",
      ""
    );
    if (token === null) return;
    if (token.trim()) {
      localStorage.setItem(LS_TOKEN, token.trim());
      fetchFromGitHub();
    }
  });

  // --- Profile switcher ---
  function renderProfileSwitcher(profiles) {
    const $sw = document.getElementById("profile-switcher");
    if (!$sw || profiles.length <= 1) return;
    $sw.hidden = false;
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

  // ── Onboarding ───────────────────────────────────────────────────────────────

  const $obOverlay = document.getElementById("onboarding-overlay");
  const $obCard    = document.getElementById("onboarding-card");
  let obData = {};
  let obIsEdit = false;
  let obFakeProgressStop = null;
  let _progressPct = 0;

  const OB_STEPS = [
    {
      title: "Votre recherche",
      subtitle: "Définissez le poste, la zone géographique et vos préférences.",
      fields: () => `
        <label>Intitulé du poste <span class="req">*</span>
          <input name="poste" required value="${escapeHtml(obData.poste || "")}" placeholder="Ex : Assistante administrative">
        </label>
        <label>Ville <span class="req">*</span>
          <input name="ville" required value="${escapeHtml(obData.ville || "")}" placeholder="Ex : Lyon">
        </label>
        <div class="ob-row">
          <label>Rayon (km)
            <input name="rayon" type="number" min="1" max="200" value="${obData.rayon || 25}">
          </label>
          <label>Contrat
            <select name="contrat">
              ${["Tous","CDI","CDD","Alternance","Stage","Intérim"].map(c =>
                `<option${c === (obData.contrat || "Tous") ? " selected" : ""}>${c}</option>`
              ).join("")}
            </select>
          </label>
        </div>
        <label>Fraîcheur des offres
          <select name="fraicheur">
            ${[["","Toutes les offres"],["7","7 derniers jours"],["14","14 derniers jours"],["30","30 derniers jours"]].map(([v, l]) =>
              `<option value="${v}"${(obData.fraicheur || "") === v ? " selected" : ""}>${l}</option>`
            ).join("")}
          </select>
        </label>
        <p class="ob-checks-label">Préférences de scoring</p>
        <div class="ob-checks">
          <label class="ob-check"><input type="checkbox" name="pref_remote"${obData.pref_remote === "on" ? " checked" : ""}> Favoriser le télétravail / hybride</label>
          <label class="ob-check"><input type="checkbox" name="pref_no_interim"${obData.pref_no_interim === "on" ? " checked" : ""}> Pénaliser les offres d'intérim</label>
          <label class="ob-check"><input type="checkbox" name="pref_no_junior"${obData.pref_no_junior === "on" ? " checked" : ""}> Pénaliser les postes débutants / juniors</label>
        </div>`,
    },
    {
      title: "Votre profil",
      subtitle: "Ce texte aide le moteur sémantique à mieux cibler les offres. Plus c'est précis, plus le matching est efficace.",
      fields: () => `
        <label>Décrivez ce que vous cherchez, vos compétences, votre expérience… <span class="opt">(optionnel)</span>
          <textarea name="profil" rows="5" placeholder="Ex : 5 ans d'expérience en gestion administrative, maîtrise d'Excel et SAGE, recherche un CDI avec des responsabilités d'organisation et de coordination…">${escapeHtml(obData.profil || "")}</textarea>
        </label>`,
    },
  ];

  function showOnboarding() {
    obIsEdit = false;
    $obOverlay.hidden = false;
    obData = { profileId: generateProfileId() };
    renderOnboardStep(0);
  }

  function renderOnboardStep(step) {
    const s = OB_STEPS[step];
    const isLast = step === OB_STEPS.length - 1;
    const dots = OB_STEPS.map((_, i) =>
      `<span class="ob-dot${i < step ? " done" : i === step ? " active" : ""}"></span>`
    ).join("");
    let leftBtn = "";
    if (step > 0) leftBtn = `<button type="button" class="ob-btn-secondary" id="ob-back">Retour</button>`;
    else if (obIsEdit) leftBtn = `<button type="button" class="ob-btn-secondary" id="ob-cancel-edit">Annuler</button>`;
    $obCard.innerHTML = `
      <h2>${escapeHtml(s.title)}</h2>
      <p class="ob-subtitle">${escapeHtml(s.subtitle)}</p>
      <div class="ob-dots">${dots}</div>
      <form id="ob-form">
        ${s.fields()}
        <div class="ob-actions">
          ${leftBtn}
          <button type="submit" class="ob-btn-primary">${isLast ? (obIsEdit ? "Sauvegarder" : "Créer mon profil") : "Suivant →"}</button>
        </div>
      </form>`;
    document.getElementById("ob-back")?.addEventListener("click", () => {
      collectOBStep(step);
      renderOnboardStep(step - 1);
    });
    document.getElementById("ob-cancel-edit")?.addEventListener("click", () => {
      $obOverlay.hidden = true;
      obIsEdit = false;
    });
    document.getElementById("ob-form").addEventListener("submit", e => {
      e.preventDefault();
      collectOBStep(step);
      if (isLast) {
        if (obIsEdit) {
          showProgressState();
          saveProfileEdits(obData).catch(err => {
            if (obFakeProgressStop) { obFakeProgressStop(); obFakeProgressStop = null; }
            showProgressError(`Erreur : ${err.message}`);
          });
        } else {
          startCreation(obData);
        }
      } else {
        renderOnboardStep(step + 1);
      }
    });
    const first = $obCard.querySelector("input, select");
    if (first) first.focus();
  }

  function collectOBStep(step) {
    const form = document.getElementById("ob-form");
    if (!form) return;
    new FormData(form).forEach((v, k) => { obData[k] = v; });
    // FormData omet les cases non cochées — on les force à vide
    form.querySelectorAll("input[type=checkbox]").forEach(cb => {
      if (!cb.checked) obData[cb.name] = "";
    });
  }

  function showProgressState() {
    $obCard.innerHTML = `
      <div class="ob-progress-header">
        <div class="ob-spinner"></div>
        <h2>Construction de votre profil…</h2>
        <p class="ob-subtitle">Votre tableau sera prêt dans quelques minutes.</p>
      </div>
      <div class="ob-progress-bar-wrap"><div class="ob-progress-bar" id="ob-bar"></div></div>
      <p class="ob-progress-step" id="ob-step-label">&nbsp;</p>
      <p class="ob-progress-label" id="ob-pct-label">0 %</p>`;
  }

  function updateProgress(pct, step, label) {
    if (pct !== null) _progressPct = pct;
    const bar    = document.getElementById("ob-bar");
    const stepEl = document.getElementById("ob-step-label");
    const pctEl  = document.getElementById("ob-pct-label");
    if (bar) bar.style.width = `${Math.round(_progressPct)}%`;
    if (pctEl) pctEl.textContent = `${Math.round(_progressPct)} %`;
    if (stepEl && step !== null) {
      stepEl.textContent = label ? `${step} — ${label}` : step;
    }
  }

  function startFakeProgress(from, to, durationMs) {
    _progressPct = from;
    const steps = durationMs / 1500;
    const inc   = (to - from) / steps;
    const timer = setInterval(() => {
      _progressPct = Math.min(to, _progressPct + inc);
      updateProgress(_progressPct, null, null);
    }, 1500);
    obFakeProgressStop = () => clearInterval(timer);
    return obFakeProgressStop;
  }

  function showProgressError(msg) {
    clearPendingBuild();
    if (obFakeProgressStop) { obFakeProgressStop(); obFakeProgressStop = null; }
    const bar = $obCard.querySelector(".ob-progress-bar-wrap");
    if (bar) bar.style.opacity = "0.3";
    const spinner = $obCard.querySelector(".ob-spinner");
    if (spinner) spinner.remove();
    const errEl = document.createElement("p");
    errEl.className = "ob-error";
    errEl.textContent = msg;
    const retryBtn = document.createElement("button");
    retryBtn.className = "ob-btn-secondary";
    retryBtn.textContent = "Recommencer";
    retryBtn.style.cssText = "margin-top:1rem;width:100%";
    retryBtn.addEventListener("click", () => {
      clearPendingBuild();
      localStorage.removeItem(LS_PROFILE);
      location.reload();
    });
    $obCard.appendChild(errEl);
    $obCard.appendChild(retryBtn);
  }

  // ── Profile creation ──────────────────────────────────────────────────────────

  function generateProfileId() {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  }

  function reEscape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function buildProfileMd(d) {
    const lines = [
      `# Profil de recherche : ${d.poste}`,
      "",
      `Poste visé : **${d.poste}** à **${d.ville}** (rayon ${d.rayon || 25} km).`,
    ];
    if (d.contrat && d.contrat !== "Tous") lines.push(`Contrat souhaité : **${d.contrat}**.`);
    const prefs = [];
    if (d.pref_remote === "on")    prefs.push("télétravail/hybride");
    if (d.pref_no_interim === "on") prefs.push("pas d'intérim");
    if (d.pref_no_junior === "on")  prefs.push("pas de postes juniors/débutants");
    if (prefs.length) lines.push(`Préférences : ${prefs.join(", ")}.`);
    if (d.profil?.trim()) lines.push("", "## À propos", "", d.profil.trim());
    return lines.join("\n");
  }

  function buildSearchConfig(d) {
    const isAlternance = d.contrat === "Alternance";
    const searches = [{ keyword: d.poste, "_label": d.poste }];
    if (isAlternance) {
      searches.push({ source: "la_bonne_alternance", "_label": `La Bonne Alternance — ${d.poste}` });
    }
    return {
      defaults: {
        location: d.ville,
        radius_km: parseInt(d.rayon) || 25,
        max_results: 150,
        published_within_days: parseInt(d.fraicheur) || null,
        alternance_only: isAlternance,
        contract_type: (d.contrat && d.contrat !== "Tous" && !isAlternance) ? d.contrat : null,
      },
      searches,
    };
  }

  function buildScoringConfig(d) {
    const preferred_contracts = {};
    if (d.contrat && d.contrat !== "Tous") preferred_contracts[d.contrat] = 8.0;
    const keywords = [];
    if (d.pref_remote === "on")     keywords.push({ pattern: "t[eé]l[eé]travail|remote|hybride?", weight: 4.0 });
    if (d.pref_no_interim === "on") keywords.push({ pattern: "int[eé]rim|CTT", weight: -8.0 });
    if (d.pref_no_junior === "on")  keywords.push({ pattern: "junior|d[eé]butant", weight: -5.0 });
    return {
      keywords,
      preferred_contracts,
      preferred_location: d.ville,
      location_bonus: 2.0,
      freshness_bonus: 3.0,
      freshness_max_days: parseInt(d.fraicheur) || 14,
      semantic_weight: 12.0,
      _prefs: {
        remote: d.pref_remote === "on",
        no_interim: d.pref_no_interim === "on",
        no_junior: d.pref_no_junior === "on",
      },
    };
  }

  async function waitForOffers(profileId) {
    const deadline = Date.now() + 12 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 15000));
      try {
        const res = await fetch(`${profileId}/offers.json?_=${Date.now()}`, { cache: "no-store" });
        if (res.ok) return;
      } catch (_) {}
    }
    throw new Error("Les offres ne sont pas disponibles après 12 minutes");
  }

  const LS_PENDING = "job-agent:pending-build";
  function getPendingBuild()  { return JSON.parse(localStorage.getItem(LS_PENDING) || "null"); }
  function setPendingBuild(v) { localStorage.setItem(LS_PENDING, JSON.stringify(v)); }
  function clearPendingBuild(){ localStorage.removeItem(LS_PENDING); }

  async function ghUpdateFile(path, content, token) {
    const getR = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (!getR.ok) throw new Error(`Fichier introuvable : ${path}`);
    const { sha } = await getR.json();
    const b64 = btoa(unescape(encodeURIComponent(content)));
    const putR = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${path}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ message: "chore: update profile config [skip ci]", content: b64, sha }),
    });
    if (!putR.ok) {
      const err = await putR.json().catch(() => ({}));
      throw new Error(err.message || `Impossible de mettre à jour ${path}`);
    }
  }

  async function waitForRebuild(issueNumber) {
    const deadline = Date.now() + 8 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 10000));
      try {
        const r = await fetch(
          `https://api.github.com/repos/${GH_REPO}/issues/${issueNumber}`,
          { headers: { Authorization: `Bearer ${ISSUES_TOKEN}`, Accept: "application/vnd.github+json" } }
        );
        if (!r.ok) continue;
        const issue = await r.json();
        if (issue.state === "closed") return;
      } catch (_) {}
    }
    throw new Error("Timeout : le rebuild n'a pas répondu dans les 8 minutes.");
  }

  async function showEditProfile() {
    const pid = currentProfile;
    if (!pid) return;
    const token = localStorage.getItem(LS_TOKEN);
    if (!token) {
      alert("Token de synchronisation non trouvé. Rechargez la page pour le récupérer automatiquement.");
      return;
    }
    try {
      const base = `https://raw.githubusercontent.com/${GH_REPO}/main`;
      const [searchCfg, scoringCfg, profileMdText] = await Promise.all([
        fetch(`${base}/profiles/${pid}/search.config.json`, { cache: "no-store" }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
        fetch(`${base}/profiles/${pid}/scoring.config.json`, { cache: "no-store" }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
        fetch(`${base}/profiles/${pid}/profile.md`, { cache: "no-store" }).then(r => { if (!r.ok) throw new Error(); return r.text(); }),
      ]);
      const prefs = scoringCfg._prefs || {};
      const contrat = searchCfg.defaults?.alternance_only
        ? "Alternance"
        : (searchCfg.defaults?.contract_type || "Tous");
      const pwdays = searchCfg.defaults?.published_within_days;
      obData = {
        profileId: pid,
        poste:          searchCfg.searches?.[0]?.keyword || "",
        ville:          searchCfg.defaults?.location || "",
        rayon:          searchCfg.defaults?.radius_km || 25,
        contrat,
        fraicheur:      pwdays ? String(pwdays) : "",
        pref_remote:    prefs.remote     ? "on" : "",
        pref_no_interim: prefs.no_interim ? "on" : "",
        pref_no_junior: prefs.no_junior  ? "on" : "",
        profil:         profileMdText.match(/## À propos\n\n([\s\S]*)/)?.[1]?.trim() || "",
      };
      obIsEdit = true;
      $obOverlay.hidden = false;
      renderOnboardStep(0);
    } catch (err) {
      alert(`Impossible de charger le profil : ${err.message}`);
    }
  }

  async function saveProfileEdits(data) {
    const pid = data.profileId;
    const token = localStorage.getItem(LS_TOKEN);
    if (!token) throw new Error("Token de synchronisation non configuré. Rechargez la page.");
    updateProgress(5, "Mise à jour de la configuration…", "profile.md");
    await ghUpdateFile(`profiles/${pid}/profile.md`, buildProfileMd(data), token);
    updateProgress(10, "Mise à jour de la configuration…", "search.config.json");
    await ghUpdateFile(`profiles/${pid}/search.config.json`, JSON.stringify(buildSearchConfig(data), null, 2), token);
    updateProgress(14, "Mise à jour de la configuration…", "scoring.config.json");
    await ghUpdateFile(`profiles/${pid}/scoring.config.json`, JSON.stringify(buildScoringConfig(data), null, 2), token);
    updateProgress(15, "Rebuild en cours…", "Déclenchement du workflow");
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/issues`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ISSUES_TOKEN}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ title: `[job-agent-rebuild] ${pid}`, body: JSON.stringify({ profileId: pid }) }),
    });
    if (!r.ok) throw new Error("Impossible de déclencher le rebuild");
    const { number: issueNumber } = await r.json();
    const fakeStop = startFakeProgress(15, 92, 10 * 60 * 1000);
    await waitForRebuild(issueNumber);
    fakeStop();
    updateProgress(100, "Mis à jour !", "Chargement de votre tableau…");
    await new Promise(r => setTimeout(r, 900));
    $obOverlay.hidden = true;
    obIsEdit = false;
    loadProfile(pid);
  }

  async function pollForTrackingToken(issueNumber) {
    const deadline = Date.now() + 12 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 5000));
      try {
        const r = await fetch(
          `https://api.github.com/repos/${GH_REPO}/issues/${issueNumber}/comments`,
          { headers: { Authorization: `Bearer ${ISSUES_TOKEN}`, Accept: "application/vnd.github+json" } }
        );
        if (!r.ok) continue;
        const comments = await r.json();
        const hit = comments.find(c => c.body?.startsWith("TRACKING_TOKEN:"));
        if (hit) {
          const token = hit.body.replace("TRACKING_TOKEN:", "").trim();
          if (token) {
            localStorage.setItem(LS_TOKEN, token);
            fetchFromGitHub();
            return;
          }
        }
      } catch (_) {}
    }
  }

  async function startCreation(data) {
    const pid      = data.profileId;
    currentProfile = pid;
    localStorage.setItem(LS_PROFILE, pid);
    setPendingBuild({ profileId: pid, poste: data.poste, issueNumber: null });
    showProgressState();
    await runBuildPhase(pid, true, data);
  }

  async function runBuildPhase(pid, createIssue, data) {
    try {
      if (createIssue) {
        updateProgress(5, "Envoi de la demande…", "Création de l'issue GitHub");
        const issueBody = JSON.stringify({
          profileId:     pid,
          poste:         data.poste,
          profileMd:     buildProfileMd(data),
          searchConfig:  buildSearchConfig(data),
          scoringConfig: buildScoringConfig(data),
        });
        const r = await fetch(`https://api.github.com/repos/${GH_REPO}/issues`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ISSUES_TOKEN}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: `[job-agent] ${pid}`, body: issueBody }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.message || `Impossible de créer l'issue (HTTP ${r.status})`);
        }
        const issueData = await r.json();
        const issueNumber = issueData.number;
        setPendingBuild({ profileId: pid, poste: data.poste, issueNumber });
        // Lance le polling du token en arrière-plan (non bloquant)
        pollForTrackingToken(issueNumber).catch(() => {});
      } else {
        // Reprise après rechargement : relancer le polling si on a le numéro d'issue
        const pb = getPendingBuild();
        if (pb?.issueNumber) pollForTrackingToken(pb.issueNumber).catch(() => {});
      }

      updateProgress(15, "Build en cours…", "Workflow GitHub Actions déclenché");
      const fakeStop = startFakeProgress(15, 92, 10 * 60 * 1000);
      await waitForOffers(pid);
      fakeStop();
      updateProgress(100, "C'est prêt !", "Chargement de votre tableau…");
      clearPendingBuild();
      await new Promise(r => setTimeout(r, 900));
      $obOverlay.hidden = true;
      loadProfile(pid);
    } catch (err) {
      if (obFakeProgressStop) { obFakeProgressStop(); obFakeProgressStop = null; }
      showProgressError(`Erreur : ${err.message}`);
    }
  }

  // --- Load ---
  async function loadProfile(profileId) {
    currentProfile = profileId;
    try {
      const r = await fetch(offersUrl(), { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      state.meta      = data.meta;
      state.rawOffers = data.offers || [];
      state.offers    = [...state.rawOffers, ...getManualOffers()];
      const knownIds = loadSet(lsKnown());
      if (knownIds.size > 0)
        newIds = new Set(state.offers.filter(o => !knownIds.has(o.id)).map(o => o.id));
      saveSet(lsKnown(), new Set(state.offers.map(o => o.id)));
      renderMeta();
      renderView();
      renderDashboard();
      fetchFromGitHub();
      document.getElementById("edit-profile-btn")?.removeAttribute("hidden");
    } catch (err) {
      const pb = getPendingBuild();
      if (pb && pb.profileId === profileId && pb.issueNumber) {
        showProgressState();
        $obOverlay.hidden = false;
        await runBuildPhase(pb.profileId, false, null);
        return;
      }
      if (pb && pb.profileId === profileId && !pb.issueNumber) {
        clearPendingBuild();
      }
      $meta.textContent = `Erreur de chargement : ${err.message}`;
      $empty.hidden = false;
    }
  }

  document.getElementById("edit-profile-btn")?.addEventListener("click", () => showEditProfile());

  fetch("profiles.json", { cache: "no-store" })
    .then(r => r.ok ? r.json() : null)
    .then(manifest => {
      const profiles = manifest?.profiles || [];
      renderProfileSwitcher(profiles);
      if (!currentProfile) { showOnboarding(); return; }
      const profileExists = profiles.some(p => p.id === currentProfile);
      if (!profileExists) {
        localStorage.removeItem(LS_PROFILE);
        currentProfile = null;
        showOnboarding();
        return;
      }
      loadProfile(currentProfile);
    })
    .catch(() => {
      if (!currentProfile) { showOnboarding(); return; }
      fetch("offers.json", { cache: "no-store" })
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then(data => {
          state.meta      = data.meta;
          state.rawOffers = data.offers || [];
          state.offers    = [...state.rawOffers, ...getManualOffers()];
          renderMeta(); renderView(); renderDashboard(); fetchFromGitHub();
        })
        .catch(err => { $meta.textContent = `Erreur : ${err.message}`; $empty.hidden = false; });
    });
})();
