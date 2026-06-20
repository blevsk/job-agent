const GH_REPO = "blevsk/job-agent";

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function cors(request) {
  const origin = request.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

export default {
  async fetch(request, env) {
    const corsHeaders = cors(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/create-profile") {
      return new Response("Not Found", { status: 404 });
    }

    const token = env.GITHUB_TOKEN;
    if (!token) return json({ error: "Server misconfigured" }, 500, corsHeaders);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400, corsHeaders);
    }

    const { profileId, files } = body;
    if (!profileId || !Array.isArray(files) || files.length === 0) {
      return json({ error: "Missing profileId or files" }, 400, corsHeaders);
    }

    const ghHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "job-agent-worker/1.0",
    };

    // Create profile files one by one
    for (const [path, content] of files) {
      const r = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${path}`, {
        method: "PUT",
        headers: ghHeaders,
        body: JSON.stringify({
          message: `feat: add profile ${profileId} [skip ci]`,
          content: toBase64(content),
          branch: "main",
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        return json({ error: err.message || `Failed to create ${path}` }, r.status, corsHeaders);
      }
    }

    // Trigger the CI workflow
    const afterTime = new Date().toISOString();
    const wr = await fetch(
      `https://api.github.com/repos/${GH_REPO}/actions/workflows/search.yml/dispatches`,
      {
        method: "POST",
        headers: ghHeaders,
        body: JSON.stringify({ ref: "main" }),
      }
    );
    if (!wr.ok) {
      const err = await wr.json().catch(() => ({}));
      return json({ error: err.message || "Failed to trigger workflow" }, wr.status, corsHeaders);
    }

    return json({ ok: true, afterTime }, 200, corsHeaders);
  },
};
