(() => {
  const LS_READ     = "job-agent:read-ids";
  const LS_KNOWN    = "job-agent:known-ids";
  const LS_TRACKING = "job-agent:tracking";

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

  const readIds  = loadSet(LS_READ);
  const tracking = loadTracking(); // { [id]: { status, status_date, notes } }
  let newIds = new Set();

  const STATUS_OPTIONS = ["Postulée", "Entretien", "Relancée", "Refusée"];
  const STATUS_CLASS   = {
    "Postulée":  "s-applied",
    "Entretien": "s-interview",
    "Relancée":  "s-followup",
    "Refusée":   "s-rejected",
  };

  const state = {
    offers: [],
    meta: null,
    sortKey: "default",
    sortDir: 1,
    filter: "",
    hideNegative: false,
    hideRead: false,
    openNotes: new Set(),
  };

  const $meta     = document.getElementById("meta");
  const $tbody    = document.querySelector("#offers tbody");
  const $empty    = document.getElementById("empty");
  const $filter   = document.getElementById("filter");
  const $hideNeg  = document.getElementById("hideNegative");
  const $hideRead = document.getElementById("hideRead");
  const $markAll  = document.getElementById("markAllRead");

  // --- Formatting ---

  function fmtDate(iso) {
    if (!iso) return "?";
    try {
      const d = new Date(iso);
      return d.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
    } catch { return iso; }
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return "?";
    if (days === 0) return "aujourd'hui";
    if (days === 1) return "1 jour";
    return `${days} j.`;
  }

  function fmtStatusDate(isoDate) {
    if (!isoDate) return "";
    try {
      return new Date(isoDate).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    } catch { return isoDate; }
  }

  function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // --- Meta ---

  function renderMeta() {
    if (!state.meta) { $meta.textContent = ""; return; }
    const m = state.meta;
    const features = [];
    if (m.semantic_active) features.push("matching sémantique");
    if (m.rerank_active) features.push("re-rank LLM");
    const featStr  = features.length ? ` · ${features.join(" + ")} actif` : "";
    const searches = (m.searches || []).map(s => s.label || s.keyword).filter(Boolean).join(", ");
    const unread   = state.offers.filter(o => !readIds.has(o.id)).length;
    const unreadStr = unread > 0 ? ` · <strong>${unread} non lue${unread > 1 ? "s" : ""}</strong>` : "";
    $meta.innerHTML = `${m.total} offres pour ${searches ? "« " + searches + " »" : "ta recherche"} ` +
      `(scrappé le ${fmtDate(m.scraped_at)}${featStr})${unreadStr}.`;
  }

  // --- Filter / sort ---

  function matchesFilter(o, q) {
    if (!q) return true;
    const t = tracking[o.id];
    const hay = `${o.title || ""} ${o.company || ""} ${o.location || ""} ${o.snippet || ""} ${o.llm_reason || ""} ${t?.notes || ""}`.toLowerCase();
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
    if (state.hideNegative) rows = rows.filter(o => (o.score ?? 0) >= 0);
    if (state.hideRead) rows = rows.filter(o => !readIds.has(o.id));
    if (state.sortKey === "default") {
      rows.sort(defaultSort);
    } else {
      const k = state.sortKey;
      const dir = state.sortDir;
      rows.sort((a, b) => {
        const va = a[k]; const vb = b[k];
        if (va === null || va === undefined) return 1;
        if (vb === null || vb === undefined) return -1;
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
        return String(va).localeCompare(String(vb), "fr") * dir;
      });
    }
    return rows;
  }

  // --- Badges ---

  function semanticBadge(s) {
    if (s === null || s === undefined) return "";
    const pct = Math.round(s * 100);
    return `<span class="badge sem" title="Similarité sémantique avec le profil">${pct}%</span>`;
  }

  function rankBadge(r) {
    if (r === null || r === undefined) return "";
    let cls = "rank";
    if (r === 1) cls += " gold";
    else if (r <= 3) cls += " silver";
    return `<span class="${cls}" title="Rang attribué par le re-rank LLM">★ ${r}</span>`;
  }

  function newBadge(id) {
    if (!newIds.has(id) || readIds.has(id)) return "";
    return `<span class="badge new" title="Nouvelle offre depuis ta dernière visite">Nouveau</span> `;
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
    const t   = tracking[id] || {};
    const cur = t.status || "";
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
      const scoreCls = o.score > 0 ? "pos" : (o.score < 0 ? "neg" : "");
      const reasonHtml = o.llm_reason
        ? `<div class="llm-reason">💡 ${escapeHtml(o.llm_reason)}</div>`
        : (o.snippet ? `<div class="snippet">${escapeHtml(o.snippet)}</div>` : "");

      const mainRow = `
        <tr data-id="${escapeHtml(o.id)}"${isRead ? ' class="read"' : ""}>
          <td class="rank-cell">${rankBadge(o.llm_rank)}</td>
          <td class="score ${scoreCls}" title="${escapeHtml(breakdownTooltip(o))}">${(o.score ?? 0).toFixed(1)}</td>
          <td class="title">
            <div class="title-line">${newBadge(o.id)}${escapeHtml(o.title)}</div>
            ${reasonHtml}
          </td>
          <td>${escapeHtml(o.company || "—")}</td>
          <td>${escapeHtml(o.location || "—")}</td>
          <td>${escapeHtml(o.contract_type || "—")}</td>
          <td>${escapeHtml(o.rome_code || "—")}${semanticBadge(o.semantic_score)}</td>
          <td>${fmtAge(o.posted_days_ago)}</td>
          <td><a href="${escapeHtml(o.url)}" target="_blank" rel="noopener" data-id="${escapeHtml(o.id)}">voir</a></td>
          <td class="status-cell">
            ${statusSelectHtml(o.id)}
            ${statusDateHtml(o.id)}
            <button class="notes-toggle${t.notes ? " has-notes" : ""}" data-id="${escapeHtml(o.id)}" title="Notes">✏</button>
          </td>
        </tr>`;

      const notesRow = `
        <tr class="notes-row" data-id="${escapeHtml(o.id)}"${hasNotes ? "" : " hidden"}>
          <td colspan="10">
            <textarea class="notes-area" data-id="${escapeHtml(o.id)}"
              placeholder="Numéro de tél, nom du contact, ressenti, infos importantes…"
            >${escapeHtml(t.notes || "")}</textarea>
          </td>
        </tr>`;

      return mainRow + notesRow;
    }).join("");

    // "voir" → mark read
    $tbody.querySelectorAll("a[data-id]").forEach(a => {
      a.addEventListener("click", () => markRead(a.dataset.id));
    });

    // Status select
    $tbody.querySelectorAll(".status-select").forEach(sel => {
      sel.addEventListener("change", () => {
        const id     = sel.dataset.id;
        const status = sel.value;
        if (!tracking[id]) tracking[id] = {};
        tracking[id].status      = status;
        tracking[id].status_date = status ? new Date().toISOString().slice(0, 10) : null;
        saveTracking();

        sel.className = `status-select ${STATUS_CLASS[status] || ""}`.trim();

        const cell     = sel.closest(".status-cell");
        const existing = cell.querySelector(".status-date");
        if (existing) existing.remove();
        const dateHtml = statusDateHtml(id);
        if (dateHtml) sel.insertAdjacentHTML("afterend", dateHtml);

        if (status === "Refusée") markRead(id);
      });
    });

    // Notes toggle
    $tbody.querySelectorAll(".notes-toggle").forEach(btn => {
      btn.addEventListener("click", () => {
        const id       = btn.dataset.id;
        const notesRow = $tbody.querySelector(`.notes-row[data-id="${id}"]`);
        if (!notesRow) return;
        const isOpen = !notesRow.hidden;
        if (isOpen) {
          state.openNotes.delete(id);
          notesRow.hidden = true;
        } else {
          state.openNotes.add(id);
          notesRow.hidden = false;
          notesRow.querySelector("textarea")?.focus();
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
        const btn = $tbody.querySelector(`.notes-toggle[data-id="${id}"]`);
        if (btn) btn.classList.toggle("has-notes", !!ta.value.trim());
      });
    });
  }

  // --- Controls ---

  document.querySelectorAll("th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const k = th.dataset.sort;
      if (state.sortKey === k) {
        state.sortDir *= -1;
      } else {
        state.sortKey = k;
        state.sortDir = (k === "score" || k === "posted_days_ago" || k === "semantic_score") ? -1 : 1;
      }
      render();
    });
  });

  $filter.addEventListener("input",  () => { state.filter      = $filter.value;   render(); });
  $hideNeg.addEventListener("change", () => { state.hideNegative = $hideNeg.checked; render(); });
  $hideRead.addEventListener("change", () => { state.hideRead    = $hideRead.checked; render(); });
  $markAll.addEventListener("click", e => {
    e.preventDefault();
    sortAndFilter().forEach(o => readIds.add(o.id));
    saveSet(LS_READ, readIds);
    render();
    renderMeta();
  });

  // --- Load ---

  fetch("offers.json", { cache: "no-store" })
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(data => {
      state.meta   = data.meta;
      state.offers = data.offers || [];

      const knownIds = loadSet(LS_KNOWN);
      if (knownIds.size > 0) {
        newIds = new Set(state.offers.filter(o => !knownIds.has(o.id)).map(o => o.id));
      }
      saveSet(LS_KNOWN, new Set(state.offers.map(o => o.id)));

      renderMeta();
      render();
    })
    .catch(err => {
      $meta.textContent = `Erreur de chargement : ${err.message}`;
      $empty.hidden = false;
    });
})();
