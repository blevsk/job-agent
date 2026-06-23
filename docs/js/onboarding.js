import { GH_REPO, LS_PROFILE, LS_PENDING } from './constants.js?v=CACHE_BUST';
import { createIssue, waitForOffers, waitForRebuild, fetchOffers } from './github-api.js?v=CACHE_BUST';
import {
  escapeHtml, generateProfileId,
  buildProfileMd, buildSearchConfig, buildScoringConfig,
} from './config.js?v=CACHE_BUST';

// Module state
let obData             = {};
let obIsEdit           = false;
let obCanCancel        = false;  // true quand ouvert depuis un profil déjà chargé
let obFakeProgressStop = null;
let _progressPct       = 0;

let _onProfileReady    = null;  // callback → loadProfile(pid)
let _onOffersData      = null;  // callback → (pid, data) utilisé après rebuild pour bypasser le CDN Pages

const $overlay = () => document.getElementById("onboarding-overlay");
const $card    = () => document.getElementById("onboarding-card");

// Appelé une fois depuis app.js pour brancher les callbacks de fin de build
export function init(onProfileReady, onOffersData) {
  _onProfileReady = onProfileReady;
  _onOffersData   = onOffersData;
}

// ── Pending build helpers ─────────────────────────────────────────────────────

function getPendingBuild()   { return JSON.parse(localStorage.getItem(LS_PENDING) || "null"); }
function setPendingBuild(v)  { localStorage.setItem(LS_PENDING, JSON.stringify(v)); }
function clearPendingBuild() { localStorage.removeItem(LS_PENDING); }

// ── Progress UI ───────────────────────────────────────────────────────────────

export function showProgressState() {
  const footer = $card().querySelector(".dialog-footer");
  if (!footer) return;

  const btnLabel = obIsEdit ? "Sauvegarder" : "Créer mon profil";
  footer.style.cssText = "flex-direction:column;gap:0.6rem;align-items:stretch";
  footer.innerHTML = `
    <div class="ob-inline-progress">
      <div class="ob-bar-wrap-inline">
        <div class="ob-progress-bar" id="ob-bar"></div>
        <span class="ob-bar-label" id="ob-step-label">en cours…</span>
      </div>
    </div>
    <button class="btn-primary" disabled style="opacity:0.45;cursor:not-allowed">${escapeHtml(btnLabel)}</button>`;
}

export function updateProgress(pct, step) {
  if (pct !== null) _progressPct = pct;
  const bar    = document.getElementById("ob-bar");
  const stepEl = document.getElementById("ob-step-label");
  if (bar) bar.style.width = `${Math.round(_progressPct)}%`;
  if (stepEl && step !== null) {
    stepEl.textContent = step
      ? `${Math.round(_progressPct)} % — ${step}`
      : `${Math.round(_progressPct)} %`;
  }
}

function startFakeProgress(from, to, durationMs) {
  _progressPct = from;
  const inc   = (to - from) / (durationMs / 1500);
  const timer = setInterval(() => {
    _progressPct = Math.min(to, _progressPct + inc);
    const bar = document.getElementById("ob-bar");
    if (bar) bar.style.width = `${Math.round(_progressPct)}%`;
    const stepEl = document.getElementById("ob-step-label");
    if (stepEl) {
      const sep  = stepEl.textContent.indexOf(" — ");
      const step = sep !== -1 ? stepEl.textContent.slice(sep + 3) : "";
      stepEl.textContent = step
        ? `${Math.round(_progressPct)} % — ${step}`
        : `${Math.round(_progressPct)} %`;
    }
  }, 1500);
  obFakeProgressStop = () => clearInterval(timer);
  return obFakeProgressStop;
}

function showProgressError(msg) {
  clearPendingBuild();
  if (obFakeProgressStop) { obFakeProgressStop(); obFakeProgressStop = null; }

  const card = $card();
  const bar  = card.querySelector(".ob-bar-wrap-inline");
  if (bar) bar.style.opacity = "0.3";
  const body = card.querySelector(".dialog-footer") || card;
  const errEl = document.createElement("p");
  errEl.className   = "ob-error";
  errEl.textContent = msg;
  const retryBtn = document.createElement("button");
  retryBtn.className   = "ob-btn-secondary";
  retryBtn.textContent = "Recommencer";
  retryBtn.style.cssText = "margin-top:1rem;width:100%";
  retryBtn.addEventListener("click", () => {
    clearPendingBuild();
    localStorage.removeItem(LS_PROFILE);
    location.reload();
  });
  body.appendChild(errEl);
  body.appendChild(retryBtn);
}

// ── Onboarding form (page unique, 2 colonnes) ─────────────────────────────────

function collectOB() {
  const form = document.getElementById("ob-form");
  if (!form) return;
  new FormData(form).forEach((v, k) => { obData[k] = v; });
  // FormData omet les cases non cochées → forcer à vide
  form.querySelectorAll("input[type=checkbox]").forEach(cb => {
    if (!cb.checked) obData[cb.name] = "";
  });
}

function renderOnboarding() {
  $card().querySelector(".ob-card-overlay")?.remove();
  const cancelBtn = obIsEdit
    ? `<button type="button" class="btn-cancel" id="ob-cancel-edit">Annuler</button>`
    : (obCanCancel ? `<button type="button" class="btn-cancel" id="ob-cancel-switch">Fermer</button>` : "");
  const submitLabel = obIsEdit ? "Sauvegarder" : "Créer mon profil";

  $card().innerHTML = `
    <div class="dialog-header">
      <h2>${obIsEdit ? "Modifier le profil" : "Votre profil de recherche"}</h2>
    </div>
    <form id="ob-form" autocomplete="off">
      <div class="dialog-2col">
        <div class="dialog-col">
          <label><span><span class="req">*</span> Intitulé du poste</span>
            <input name="poste" required value="${escapeHtml(obData.poste || "")}" placeholder="Ex : Assistante administrative">
          </label>
          <label><span><span class="req">*</span> Ville</span>
            <input name="ville" required value="${escapeHtml(obData.ville || "")}" placeholder="Ex : Lyon">
          </label>
          <div class="ob-row">
            <label>Contrat
              <select name="contrat">
                ${["Tous","CDI","CDD","Alternance","Stage","Intérim"].map(c =>
                  `<option${c === (obData.contrat || "Tous") ? " selected" : ""}>${c}</option>`
                ).join("")}
              </select>
            </label>
            <label>Rayon (km)
              <input name="rayon" type="number" min="1" max="200" value="${obData.rayon || 25}">
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
          </div>
        </div>
        <div class="dialog-col dialog-col-text">
          <label>Décrivez vos compétences et ce que vous cherchez <span class="opt">(optionnel)</span>
            <textarea name="profil" placeholder="Ex : 5 ans d'expérience en gestion administrative, maîtrise des outils bureautiques…">${escapeHtml(obData.profil || "")}</textarea>
          </label>
        </div>
      </div>
    </form>
    <div class="dialog-footer">
      ${cancelBtn}
      <button type="submit" form="ob-form" class="btn-primary">${submitLabel}</button>
    </div>
    ${!obIsEdit ? `<div class="ob-reconnect-toggle"><a href="#" id="ob-toggle-reconnect">J'ai déjà un identifiant de profil →</a></div>` : ""}`;

  document.getElementById("ob-cancel-edit")?.addEventListener("click", () => {
    $overlay().hidden = true;
    obIsEdit = false;
  });
  document.getElementById("ob-cancel-switch")?.addEventListener("click", () => {
    $overlay().hidden = true;
    obCanCancel = false;
  });
  document.getElementById("ob-toggle-reconnect")?.addEventListener("click", e => {
    e.preventDefault();
    showReconnect();
  });
  document.getElementById("ob-form").addEventListener("submit", e => {
    e.preventDefault();
    collectOB();
    if (obIsEdit) {
      showProgressState();
      saveProfileEdits(obData).catch(err => {
        if (obFakeProgressStop) { obFakeProgressStop(); obFakeProgressStop = null; }
        showProgressError(`Erreur : ${err.message}`);
      });
    } else {
      startCreation(obData);
    }
  });
  $card().querySelector("input, select")?.focus();
}

// ── Reconnect (J'ai déjà un profil) ──────────────────────────────────────────

function showReconnect() {
  $card().innerHTML = `
    <div class="dialog-header">
      <h2>Retrouver mon profil</h2>
    </div>
    <div class="ob-simple-body">
      <p>Entrez l'identifiant de votre profil (visible dans l'URL après <code>?profile=</code>) :</p>
      <div class="ob-input-row">
        <input id="ob-pid-input" placeholder="ex : abc123def4" autocomplete="off" autocorrect="off" spellcheck="false">
        <button id="ob-pid-load" class="btn-primary">Charger</button>
      </div>
      <p id="ob-pid-error" hidden class="ob-error">Profil introuvable. Vérifiez l'identifiant.</p>
    </div>
    <div class="dialog-footer">
      <button type="button" class="btn-cancel" id="ob-back">← Retour</button>
    </div>`;

  document.getElementById("ob-back")?.addEventListener("click", renderOnboarding);
  const $input = document.getElementById("ob-pid-input");
  $input?.focus();

  const doLoad = async () => {
    const pid = $input?.value.trim();
    if (!pid) return;
    const $err = document.getElementById("ob-pid-error");
    $err.hidden = true;
    const $btn  = document.getElementById("ob-pid-load");
    $btn.disabled = true;
    try {
      const r = await fetch(`${pid}/offers.json`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      $overlay().hidden = true;
      _onProfileReady?.(pid);
    } catch {
      $err.hidden   = false;
      $btn.disabled = false;
    }
  };

  document.getElementById("ob-pid-load")?.addEventListener("click", doLoad);
  $input?.addEventListener("keydown", e => { if (e.key === "Enter") doLoad(); });
}

// ── Save-link screen (affiché après la création d'un profil) ──────────────────

function showSaveLink(pid, afterFn) {
  const url = (() => {
    const u = new URL(location.href);
    u.searchParams.set("profile", pid);
    u.searchParams.delete("fresh");
    return u.toString();
  })();

  $card().innerHTML = `
    <div class="dialog-header">
      <h2>Profil créé !</h2>
    </div>
    <div class="ob-simple-body">
      <p>Sauvegardez ce lien — c'est la seule façon de retrouver votre profil :</p>
      <div class="ob-input-row">
        <input id="ob-perm-link" type="text" readonly value="${escapeHtml(url)}">
        <button id="ob-copy-link" class="btn-primary">Copier</button>
      </div>
      <p class="ob-save-hint">Sans ce lien, vos offres et candidatures seront inaccessibles depuis un autre appareil.</p>
    </div>
    <div class="dialog-footer">
      <button type="button" class="btn-primary" id="ob-continue">Continuer →</button>
    </div>`;

  const $btn = document.getElementById("ob-copy-link");
  $btn?.addEventListener("click", () => {
    navigator.clipboard.writeText(url)
      .then(() => { $btn.textContent = "✓ Copié !"; setTimeout(() => { $btn.textContent = "Copier"; }, 2000); })
      .catch(() => { prompt("Copiez ce lien permanent :", url); });
  });

  document.getElementById("ob-perm-link")?.addEventListener("click", e => e.target.select());
  document.getElementById("ob-continue")?.addEventListener("click", () => {
    $overlay().hidden = true;
    afterFn();
  });
}

// ── Public: entry points ──────────────────────────────────────────────────────

export function showOnboarding(canCancel = false) {
  obIsEdit    = false;
  obCanCancel = canCancel;
  obData      = { profileId: generateProfileId() };
  $overlay().hidden = false;
  renderOnboarding();
}

export async function showEditProfile(pid) {
  try {
    const base = `https://raw.githubusercontent.com/${GH_REPO}/main`;
    const [meta, searchCfg, scoringCfg, profileMdText] = await Promise.all([
      fetch(`${base}/profiles/${pid}/meta.json`,           { cache: "no-store" }).then(r => r.ok ? r.json() : {}),
      fetch(`${base}/profiles/${pid}/search.config.json`,  { cache: "no-store" }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
      fetch(`${base}/profiles/${pid}/scoring.config.json`, { cache: "no-store" }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
      fetch(`${base}/profiles/${pid}/profile.md`,          { cache: "no-store" }).then(r => { if (!r.ok) throw new Error(); return r.text(); }),
    ]);
    const prefs  = scoringCfg._prefs || {};
    const contrat = searchCfg.defaults?.alternance_only
      ? "Alternance"
      : (searchCfg.defaults?.contract_type || "Tous");
    obData = {
      profileId:       pid,
      poste:           meta.label || searchCfg.searches?.[0]?.keyword || "",
      ville:           searchCfg.defaults?.location || "",
      rayon:           searchCfg.defaults?.radius_km || 25,
      contrat,
      fraicheur:       searchCfg.defaults?.published_within_days ? String(searchCfg.defaults.published_within_days) : "",
      pref_remote:     prefs.remote     ? "on" : "",
      pref_no_interim: prefs.no_interim ? "on" : "",
      pref_no_junior:  prefs.no_junior  ? "on" : "",
      profil:          profileMdText.match(/## À propos\n\n([\s\S]*)/)?.[1]?.trim() || "",
    };
    obIsEdit = true;
    $overlay().hidden = false;
    renderOnboarding();
  } catch {
    alert("Impossible de charger le profil. Réessayez.");
  }
}

// Reprend un build interrompu (rechargement de page en plein build)
export async function resumeBuild(pid) {
  $overlay().hidden = false;
  renderOnboarding();  // crée la structure dialog-footer nécessaire à showProgressState
  showProgressState();
  await runBuildPhase(pid, false, null);
}

// ── Build pipeline ────────────────────────────────────────────────────────────

async function startCreation(data) {
  const pid = data.profileId;
  localStorage.setItem(LS_PROFILE, pid);
  setPendingBuild({ profileId: pid, issueNumber: null });
  showProgressState();
  await runBuildPhase(pid, true, data);
}

async function runBuildPhase(pid, doCreate, data) {
  try {
    if (doCreate) {
      updateProgress(5, "envoi…");
      const issueBody = JSON.stringify({
        profileId:    pid,
        poste:        data.poste,
        profileMd:    buildProfileMd(data),
        searchConfig: buildSearchConfig(data),
        scoringConfig: buildScoringConfig(data),
      });
      const issue = await createIssue(`[job-agent] ${pid}`, issueBody);
      setPendingBuild({ profileId: pid, issueNumber: issue.number });
    }
    updateProgress(15, "build en cours…");
    const fakeStop = startFakeProgress(15, 92, 3 * 60 * 1000);
    await waitForOffers(pid);
    fakeStop();
  
    updateProgress(92, "chargement…");
    const offersData = await fetchOffers(pid);
    updateProgress(100, "prêt !");
    clearPendingBuild();
    await new Promise(r => setTimeout(r, 600));

    if (doCreate) {
      showSaveLink(pid, () => {
        if (_onOffersData) _onOffersData(pid, offersData);
        else _onProfileReady?.(pid);
      });
    } else {
      $overlay().hidden = true;
      if (_onOffersData) _onOffersData(pid, offersData);
      else _onProfileReady?.(pid);
    }
  } catch (err) {
    if (obFakeProgressStop) { obFakeProgressStop(); obFakeProgressStop = null; }
    showProgressError(`Erreur : ${err.message}`);
  }
}

async function saveProfileEdits(data) {
  const pid = data.profileId;
  updateProgress(5, "envoi…");
  const issueBody = JSON.stringify({
    profileId:     pid,
    poste:         data.poste,
    profileMd:     buildProfileMd(data),
    searchConfig:  buildSearchConfig(data),
    scoringConfig: buildScoringConfig(data),
  });
  const issue = await createIssue(`[job-agent-rebuild] ${pid}`, issueBody);
  updateProgress(10, "build en cours…");
  const fakeStop = startFakeProgress(10, 88, 3 * 60 * 1000);
  await waitForRebuild(issue.number);
  fakeStop();

  updateProgress(92, "chargement…");
  const offersData = await fetchOffers(pid);
  updateProgress(100, "mis à jour !");
  await new Promise(r => setTimeout(r, 900));
  $overlay().hidden = true;
  obIsEdit = false;
  if (_onOffersData) _onOffersData(pid, offersData);
  else _onProfileReady?.(pid);
}
