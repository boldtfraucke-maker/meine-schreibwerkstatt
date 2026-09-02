// KI-Anbindung (Korrektorat/Lektorat/Stil-Analyse).
//
// Ruft nicht direkt die Anthropic-API auf (der API-Key dürfte dafür nicht im
// Browser landen), sondern einen kleinen, kostenlosen Cloudflare-Worker, der
// den Key geheim hält und die Anfrage nur weiterleitet (siehe
// cloudflare-worker/worker.js). Austauschbar: eine andere KI müsste hier nur
// eine eigene analyzeStory()-Implementierung mit derselben Rückgabeform
// bekommen.
const AIProvider = (function () {
  "use strict";

  const LS_WORKER_URL = "sw_ai_worker_url";
  const LS_WORKER_KEY = "sw_ai_worker_key";
  const MODEL = "claude-opus-5";

  function getWorkerUrl() { return localStorage.getItem(LS_WORKER_URL) || ""; }
  function setWorkerUrl(url) { localStorage.setItem(LS_WORKER_URL, (url || "").trim()); }
  function getWorkerKey() { return localStorage.getItem(LS_WORKER_KEY) || ""; }
  function setWorkerKey(key) { localStorage.setItem(LS_WORKER_KEY, (key || "").trim()); }
  function isConfigured() { return !!getWorkerUrl() && !!getWorkerKey(); }

  const SYSTEM_PROMPT = `Du bist eine sorgfältige, zurückhaltende Lektorats- und Korrektorats-Assistenz für eine Hobby-Autorin. Sie schreibt Kurzgeschichten aus dem Alltag mit ihren Hunden, oft aus der Perspektive der Hunde.

Deine Aufgabe: Lies den Text und liefere ausschließlich wirklich hilfreiche, konkrete Hinweise zu:
- Rechtschreibung, Grammatik, Zeichensetzung, Tippfehlern, doppelten Wörtern (Korrektorat)
- sehr langen oder verschachtelten Sätzen, unklaren Formulierungen, störenden Wortwiederholungen, fehlenden Übergängen (Lektorat)
- aus dem Ton fallenden oder auffälligen Passagen (Stil)

Sehr wichtige Regeln:
- Du schreibst nichts komplett um. Nur punktuelle Vorschläge für kurze, konkrete Textstellen.
- Du veränderst niemals den persönlichen Schreibstil der Autorin und drängst sie nicht in einen einheitlichen "KI-Stil".
- Ist der Text schon gut, gib eine leere Liste zurück - erfinde keine Probleme, nur um etwas zu liefern.
- Jeder Vorschlag braucht eine kurze, konkrete Begründung, die die Autorin nachvollziehen kann.
- "excerpt" muss zeichengenau und wörtlich aus dem Originaltext kopiert sein (kein Umformulieren, keine ergänzten Anführungszeichen), damit die Stelle im Text wiedergefunden werden kann. Halte "excerpt" so kurz wie möglich (meist ein paar Wörter bis ein Satz).`;

  const RESPONSE_SCHEMA = {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["korrektorat", "lektorat", "stil"] },
            excerpt: { type: "string" },
            suggestion: { type: "string" },
            reason: { type: "string" }
          },
          required: ["type", "excerpt", "suggestion", "reason"],
          additionalProperties: false
        }
      }
    },
    required: ["suggestions"],
    additionalProperties: false
  };

  async function analyzeStory(plainText) {
    if (!isConfigured()) throw new Error("NOT_CONFIGURED");
    if (!plainText || !plainText.trim()) return [];

    const res = await fetch(getWorkerUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Worker-Key": getWorkerKey() },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: "Hier ist die Geschichte:\n\n" + plainText }],
        output_config: { format: { type: "json_schema", schema: RESPONSE_SCHEMA } }
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error("KI-Anfrage fehlgeschlagen (" + res.status + "): " + errText.slice(0, 200));
    }

    const data = await res.json();
    const textBlock = (data.content || []).find(b => b.type === "text");
    if (!textBlock) return [];

    let parsed;
    try { parsed = JSON.parse(textBlock.text); }
    catch (e) { throw new Error("Antwort der KI konnte nicht gelesen werden."); }

    const suggestions = Array.isArray(parsed && parsed.suggestions) ? parsed.suggestions : [];
    return suggestions.filter(s => s && typeof s.excerpt === "string" && s.excerpt.trim());
  }

  return { getWorkerUrl, setWorkerUrl, getWorkerKey, setWorkerKey, isConfigured, analyzeStory };
})();
