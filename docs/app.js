(() => {
  // --- Constants ---
  const LS_READ     = "job-agent:read-ids";
  const LS_KNOWN    = "job-agent:known-ids";
  const LS_TRACKING = "job-agent:tracking";
  const LS_TOKEN    = "job-agent:gh-token";
  const GH_REPO     = "blevsk/job-agent";
  const GH_PATH     = "docs/tracking.json";
  const GH_API      = `https://api.github.com/repos/${GH_REPO}/contents/${GH_PATH}`;

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
    try { return JSON.parse(localStorage.getItem(LS_TRACKING) || "{}"); }
    catch { return {}; }
  }
  function saveTracking() {
    localStorage.setItem(LS_TRACKING, JSON.stringify(tracking));
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
  const readIds  = loadSet(LS_READ);
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
      const r = await fetch(GH_API, {
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
      render();
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
      const r = await fetch(GH_API, {
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
    saveSet(LS_READ, readIds);
    $tbody.querySelectorAll("tr[data-id]").forEach(tr => {
      if (tr.dataset.id === id && !tr.classList.contains("notes-row"))
        tr.classList.add("read");
    });
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

  // --- Controls ---
  document.querySelectorAll("th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const k = th.dataset.sort;
      if (state.sortKey === k) { state.sortDir *= -1; }
      else {
        state.sortKey = k;
        state.sortDir = (k === "score" || k === "posted_days_ago" || k === "semantic_score") ? -1 : 1;
      }
      render();
    });
  });

  $filter.addEventListener("input",   () => { state.filter       = $filter.value;    render(); });
  $hideRead.addEventListener("change",     () => { state.hideRead     = $hideRead.checked;   render(); });
  $filterStatus.addEventListener("change", () => { state.filterStatus = $filterStatus.value; render(); });
  $markAll.addEventListener("click",  e  => {
    e.preventDefault();
    sortAndFilter().forEach(o => readIds.add(o.id));
    saveSet(LS_READ, readIds);
    render();
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
    const btn = $tbody.querySelector(`.notes-toggle[data-id="${currentNotesId}"]`);
    if (btn) btn.classList.toggle("has-notes", !!$notesDialogArea.value.trim());
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
    render();
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

  // --- Load ---
  fetch("offers.json", { cache: "no-store" })
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(data => {
      state.meta      = data.meta;
      state.rawOffers = data.offers || [];
      state.offers    = [...state.rawOffers, ...getManualOffers()];
      const knownIds = loadSet(LS_KNOWN);
      if (knownIds.size > 0)
        newIds = new Set(state.offers.filter(o => !knownIds.has(o.id)).map(o => o.id));
      saveSet(LS_KNOWN, new Set(state.offers.map(o => o.id)));
      renderMeta();
      render();
      renderDashboard();
      fetchFromGitHub(); // sync tracking depuis GitHub après affichage initial
    })
    .catch(err => {
      $meta.textContent = `Erreur de chargement : ${err.message}`;
      $empty.hidden = false;
    });
})();
