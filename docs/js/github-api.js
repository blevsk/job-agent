import { GH_REPO, ISSUES_TOKEN } from './constants.js?v=CACHE_BUST';

function authHeaders() {
  const h = { Accept: "application/vnd.github+json" };
  if (ISSUES_TOKEN?.startsWith("github_"))
    h["Authorization"] = `Bearer ${ISSUES_TOKEN}`;
  return h;
}

export async function createIssue(title, body) {
  const r = await fetch(`https://api.github.com/repos/${GH_REPO}/issues`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ title, body }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.message || `Impossible de créer l'issue (HTTP ${r.status})`);
  }
  return r.json();
}

export async function waitForOffers(profileId) {
  const deadline = Date.now() + 12 * 60 * 1000;
  const headers  = authHeaders();
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 10000));
    try {
      const res = await fetch(
        `https://api.github.com/repos/${GH_REPO}/contents/docs/${profileId}/offers.json`,
        { headers, cache: "no-store" }
      );
      if (res.ok) return;
    } catch (_) {}
  }
  throw new Error("Les offres ne sont pas disponibles après 12 minutes");
}

export async function waitForRebuild(issueNumber) {
  const deadline = Date.now() + 8 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 10000));
    try {
      const r = await fetch(
        `https://api.github.com/repos/${GH_REPO}/issues/${issueNumber}`,
        { headers: authHeaders() }
      );
      if (!r.ok) continue;
      if ((await r.json()).state === "closed") return;
    } catch (_) {}
  }
  throw new Error("Timeout : le rebuild n'a pas répondu dans les 8 minutes.");
}

// Récupère le contenu d'offers.json via l'API GitHub (pas le CDN Pages) pour éviter les délais de cache.
export async function fetchOffers(profileId) {
  const r = await fetch(
    `https://api.github.com/repos/${GH_REPO}/contents/docs/${profileId}/offers.json`,
    { headers: authHeaders(), cache: "no-store" }
  );
  if (!r.ok) throw new Error(`Impossible de lire les offres (HTTP ${r.status})`);
  const meta = await r.json();
  return JSON.parse(atob(meta.content.replace(/\s/g, "")));
}
