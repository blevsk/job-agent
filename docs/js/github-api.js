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
    await new Promise(r => setTimeout(r, 3000));
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
    await new Promise(r => setTimeout(r, 3000));
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
  const meta  = await r.json();
  const bytes = Uint8Array.from(atob(meta.content.replace(/\s/g, "")), c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

// Lit tracking.json depuis le repo. Retourne { data, sha } ou { data: null, sha: null } si absent.
export async function fetchTracking(profileId) {
  const r = await fetch(
    `https://api.github.com/repos/${GH_REPO}/contents/docs/${profileId}/tracking.json`,
    { headers: authHeaders(), cache: "no-store" }
  );
  if (r.status === 404) return { data: null, sha: null };
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const meta  = await r.json();
  const bytes = Uint8Array.from(atob(meta.content.replace(/\s/g, "")), c => c.charCodeAt(0));
  return { data: JSON.parse(new TextDecoder().decode(bytes)), sha: meta.sha };
}

// Crée ou met à jour tracking.json. Retourne le nouveau SHA du fichier.
export async function pushTracking(profileId, data, sha) {
  const encoded = new TextEncoder().encode(JSON.stringify(data, null, 2));
  let binary = "";
  encoded.forEach(b => { binary += String.fromCharCode(b); });
  const body = {
    message: `tracking: ${profileId}`,
    content: btoa(binary),
    ...(sha ? { sha } : {}),
  };
  const r = await fetch(
    `https://api.github.com/repos/${GH_REPO}/contents/docs/${profileId}/tracking.json`,
    {
      method:  "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    }
  );
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${r.status}`);
  }
  return (await r.json()).content.sha;
}
