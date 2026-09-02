// Cloudflare Worker: sicherer Vermittler zwischen der App und der Claude-API.
//
// Warum das nötig ist: Die App läuft komplett im Browser, ohne eigenen Server.
// Der Anthropic-API-Key darf aber niemals im Browser landen (er wäre im
// Netzwerk-Tab sichtbar). Dieser winzige, kostenlose Worker hält den Key
// geheim und leitet nur die Anfrage weiter.
//
// Einrichtung: Diesen Code 1:1 in einen neuen Cloudflare Worker einfügen
// (siehe README.md im Hauptordner für die Schritt-für-Schritt-Anleitung).
// Danach unter "Settings -> Variables and Secrets" zwei Secrets anlegen:
//   ANTHROPIC_API_KEY   - der eigene Anthropic-API-Key
//   WORKER_ACCESS_KEY   - ein selbst ausgedachtes Passwort für diesen Worker
//                          (schützt davor, dass Fremde den Worker mitbenutzen)

const ALLOWED_ORIGINS = [
  "https://boldtfraucke-maker.github.io",
  "http://localhost:8934"
];

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Worker-Key",
    "Vary": "Origin"
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Nur POST erlaubt." }), {
        status: 405,
        headers: { ...headers, "Content-Type": "application/json" }
      });
    }

    const workerKey = request.headers.get("X-Worker-Key");
    if (!env.WORKER_ACCESS_KEY || workerKey !== env.WORKER_ACCESS_KEY) {
      return new Response(JSON.stringify({ error: "Nicht autorisiert." }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json" }
      });
    }

    let body;
    try {
      body = await request.text();
    } catch (e) {
      return new Response(JSON.stringify({ error: "Ungültige Anfrage." }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" }
      });
    }

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body
    });

    const resBody = await anthropicRes.text();
    return new Response(resBody, {
      status: anthropicRes.status,
      headers: { ...headers, "Content-Type": "application/json" }
    });
  }
};
