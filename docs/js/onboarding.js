import { GH_REPO, LS_PROFILE, LS_PENDING } from './constants.js?v=CACHE_BUST';
import { createIssue, waitForOffers, waitForRebuild, fetchOffers } from './github-api.js?v=CACHE_BUST';
import {
  escapeHtml, generateProfileId,
  buildProfileMd, buildSearchConfig, buildScoringConfig,
} from './config.js?v=CACHE_BUST';

// Module state
let obData             = {};
let obIsEdit           = false;
let obFakeProgressStop = null;
let _progressPct       = 0;
let _timerInterval     = null;
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
      <span class="ob-timer-small" id="ob-timer">0:00</span>
    </div>
    <button class="btn-primary" disabled style="opacity:0.45;cursor:not-allowed">${escapeHtml(btnLabel)}</button>`;

  const start = Date.now();
  if (_timerInterval) clearInterval(_timerInterval);
  _timerInterval = setInterval(() => {
    const el = document.getElementById("ob-timer");
    if (!el) { clearInterval(_timerInterval); _timerInterval = null; return; }
    const s = Math.floor((Date.now() - start) / 1000);
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }, 1000);
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
  if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
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
    : "";
  const submitLabel = obIsEdit ? "Sauvegarder" : "Créer mon profil";

  $card().innerHTML = `
    <div class="dialog-header">
      <h2>${obIsEdit ? "Modifier le profil" : "Votre profil de recherche"}</h2>
    </div>
    <form id="ob-form">
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
    </div>`;

  document.getElementById("ob-cancel-edit")?.addEventListener("click", () => {
    $overlay().hidden = true;
    obIsEdit = false;
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

// ── Public: entry points ──────────────────────────────────────────────────────

export function showOnboarding() {
  obIsEdit = false;
  obData   = { profileId: generateProfileId() };
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
    if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
    updateProgress(92, "chargement…");
    const offersData = await fetchOffers(pid);
    updateProgress(100, "prêt !");
    clearPendingBuild();
    await new Promise(r => setTimeout(r, 900));
    $overlay().hidden = true;
    if (_onOffersData) _onOffersData(pid, offersData);
    else _onProfileReady?.(pid);
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
  if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
  updateProgress(92, "chargement…");
  const offersData = await fetchOffers(pid);
  updateProgress(100, "mis à jour !");
  await new Promise(r => setTimeout(r, 900));
  $overlay().hidden = true;
  obIsEdit = false;
  if (_onOffersData) _onOffersData(pid, offersData);
  else _onProfileReady?.(pid);
}
