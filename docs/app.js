(() => {
  const state = {
    offers: [],
    meta: null,
    sortKey: "default",
    sortDir: 1,
    filter: "",
    hideNegative: false,
  };

  const $meta = document.getElementById("meta");
  const $tbody = document.querySelector("#offers tbody");
  const $empty = document.getElementById("empty");
  const $filter = document.getElementById("filter");
  const $hideNeg = document.getElementById("hideNegative");

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

  function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderMeta() {
    if (!state.meta) { $meta.textContent = ""; return; }
    const m = state.meta;
    const features = [];
    if (m.semantic_active) features.push("matching sémantique");
    if (m.rerank_active) features.push("re-rank LLM");
    const featStr = features.length ? ` · ${features.join(" + ")} actif` : "";
    const searches = (m.searches || []).map(s => s.keyword).filter(Boolean).join(", ");
    $meta.textContent = `${m.total} offres pour ${searches ? "« " + searches + " »" : "ta recherche"} ` +
      `(scrappé le ${fmtDate(m.scraped_at)}${featStr}).`;
  }

  function matchesFilter(o, q) {
    if (!q) return true;
    const hay = `${o.title || ""} ${o.company || ""} ${o.location || ""} ${o.snippet || ""} ${o.llm_reason || ""}`.toLowerCase();
    return hay.includes(q);
  }

  function defaultSort(a, b) {
    // 1. llm_rank d'abord (1 = meilleur) ; ceux sans llm_rank vont après
    const ar = a.llm_rank ?? Infinity;
    const br = b.llm_rank ?? Infinity;
    if (ar !== br) return ar - br;
    // 2. puis par score décroissant
    return (b.score ?? 0) - (a.score ?? 0);
  }

  function sortAndFilter() {
    const q = state.filter.trim().toLowerCase();
    let rows = state.offers.filter(o => matchesFilter(o, q));
    if (state.hideNegative) rows = rows.filter(o => (o.score ?? 0) >= 0);
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

  function semanticBadge(s) {
    if (s === null || s === undefined) return "";
    const pct = Math.round(s * 100);
    return `<span class="badge sem" title="Similarité sémantique avec ton profil">${pct}%</span>`;
  }

  function rankBadge(r) {
    if (r === null || r === undefined) return "";
    let cls = "rank";
    if (r === 1) cls += " gold";
    else if (r <= 3) cls += " silver";
    return `<span class="${cls}" title="Rang attribué par le re-rank LLM">★ ${r}</span>`;
  }

  function breakdownTooltip(o) {
    if (!o.score_breakdown) return "";
    return Object.entries(o.score_breakdown)
      .filter(([, v]) => v !== 0)
      .map(([k, v]) => `${k}: ${v >= 0 ? "+" : ""}${typeof v === "number" ? v.toFixed(1) : v}`)
      .join(" | ");
  }

  function render() {
    const rows = sortAndFilter();
    if (rows.length === 0) {
      $tbody.innerHTML = "";
      $empty.hidden = false;
      return;
    }
    $empty.hidden = true;
    $tbody.innerHTML = rows.map(o => {
      const scoreCls = o.score > 0 ? "pos" : (o.score < 0 ? "neg" : "");
      const reasonHtml = o.llm_reason
        ? `<div class="llm-reason">💡 ${escapeHtml(o.llm_reason)}</div>`
        : (o.snippet ? `<div class="snippet">${escapeHtml(o.snippet)}</div>` : "");
      return `
        <tr>
          <td class="rank-cell">${rankBadge(o.llm_rank)}</td>
          <td class="score ${scoreCls}" title="${escapeHtml(breakdownTooltip(o))}">${(o.score ?? 0).toFixed(1)}</td>
          <td class="title">
            <div class="title-line">${escapeHtml(o.title)}</div>
            ${reasonHtml}
          </td>
          <td>${escapeHtml(o.company || "—")}</td>
          <td>${escapeHtml(o.location || "—")}</td>
          <td>${escapeHtml(o.contract_type || "—")}</td>
          <td>${escapeHtml(o.rome_code || "—")}${semanticBadge(o.semantic_score)}</td>
          <td>${fmtAge(o.posted_days_ago)}</td>
          <td><a href="${escapeHtml(o.url)}" target="_blank" rel="noopener">voir</a></td>
        </tr>`;
    }).join("");
  }

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

  $filter.addEventListener("input", () => { state.filter = $filter.value; render(); });
  $hideNeg.addEventListener("change", () => { state.hideNegative = $hideNeg.checked; render(); });

  fetch("offers.json", { cache: "no-store" })
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(data => {
      state.meta = data.meta;
      state.offers = data.offers || [];
      renderMeta();
      render();
    })
    .catch(err => {
      $meta.textContent = `Erreur de chargement : ${err.message}`;
      $empty.hidden = false;
    });
})();
