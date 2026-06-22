// Détecte automatiquement owner/repo depuis l'URL GitHub Pages (blevsk.github.io/repo-name)
// afin que le fork staging fonctionne sans modification de code.
// Fallback sur la valeur codée en dur pour localhost.
function detectGhRepo() {
  const { hostname, pathname } = window.location;
  if (hostname.endsWith(".github.io")) {
    const owner = hostname.replace(".github.io", "");
    const repo  = pathname.split("/").filter(Boolean)[0] || "job-agent";
    return `${owner}/${repo}`;
  }
  return "blevsk/job-agent";
}
export const GH_REPO = detectGhRepo();
export const ISSUES_TOKEN = "REMPLACER_PAR_TON_TOKEN_ISSUES";
export const LS_PROFILE   = "job-agent:profile";
export const LS_PENDING   = "job-agent:pending-build";
