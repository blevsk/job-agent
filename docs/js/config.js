// Pure utility and config-builder functions — no DOM, no side effects.

export function escapeHtml(s) {
  if (s == null) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function fmtDate(iso) {
  if (!iso) return "?";
  try { return new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }); }
  catch { return iso; }
}

export function fmtAge(days) {
  if (days === null || days === undefined) return "?";
  if (days === 0) return "aujourd'hui";
  if (days === 1) return "1 jour";
  return `${days} j.`;
}

export function fmtStatusDate(isoDate) {
  if (!isoDate) return "";
  try { return new Date(isoDate).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }); }
  catch { return isoDate; }
}

export function generateProfileId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

export function buildProfileMd(d) {
  const lines = [
    `# Profil de recherche : ${d.poste}`,
    "",
    `Poste visé : **${d.poste}** à **${d.ville}** (rayon ${d.rayon || 25} km).`,
  ];
  if (d.contrat && d.contrat !== "Tous") lines.push(`Contrat souhaité : **${d.contrat}**.`);
  const prefs = [];
  if (d.pref_remote === "on")     prefs.push("télétravail/hybride");
  if (d.pref_no_interim === "on") prefs.push("pas d'intérim");
  if (d.pref_no_junior === "on")  prefs.push("pas de postes juniors/débutants");
  if (prefs.length) lines.push(`Préférences : ${prefs.join(", ")}.`);
  if (d.profil?.trim()) lines.push("", "## À propos", "", d.profil.trim());
  return lines.join("\n");
}

export function buildSearchConfig(d) {
  const isAlternance = d.contrat === "Alternance";
  // France Travail fait un AND sur tous les mots → splitter pour éviter 0 résultats
  const keywords = [...new Set(
    d.poste.split("/").flatMap(part => part.split(/ et /i)).map(k => k.trim()).filter(Boolean)
  )];
  const searches = keywords.map(kw => ({ keyword: kw, _label: kw }));
  if (isAlternance) {
    searches.push({ source: "la_bonne_alternance", _label: `La Bonne Alternance — ${d.poste}` });
  }
  return {
    defaults: {
      location:             d.ville,
      radius_km:            parseInt(d.rayon) || 25,
      max_results:          150,
      published_within_days: parseInt(d.fraicheur) || null,
      alternance_only:      isAlternance,
      contract_type:        (d.contrat && d.contrat !== "Tous" && !isAlternance) ? d.contrat : null,
    },
    searches,
  };
}

export function buildScoringConfig(d) {
  const preferred_contracts = {};
  if (d.contrat && d.contrat !== "Tous") preferred_contracts[d.contrat] = 8.0;
  const keywords = [];
  if (d.pref_remote === "on")     keywords.push({ pattern: "t[eé]l[eé]travail|remote|hybride?", weight: 4.0 });
  if (d.pref_no_interim === "on") keywords.push({ pattern: "int[eé]rim|CTT",          weight: -8.0 });
  if (d.pref_no_junior === "on")  keywords.push({ pattern: "junior|d[eé]butant",      weight: -5.0 });
  return {
    keywords,
    preferred_contracts,
    preferred_location:  d.ville,
    location_bonus:      2.0,
    freshness_bonus:     3.0,
    freshness_max_days:  parseInt(d.fraicheur) || 14,
    semantic_weight:     12.0,
    _prefs: {
      remote:     d.pref_remote     === "on",
      no_interim: d.pref_no_interim === "on",
      no_junior:  d.pref_no_junior  === "on",
    },
  };
}
