// KI-Anbindung (Korrektorat/Lektorat/Stil-Analyse, Namens-/Orte-Erkennung für
// die Konsistenzprüfung).
//
// Ruft nicht direkt die Anthropic-API auf (der API-Key dürfte dafür nicht im
// Browser landen), sondern einen kleinen, kostenlosen Cloudflare-Worker, der
// den Key geheim hält und die Anfrage nur weiterleitet (siehe
// cloudflare-worker/worker.js). Austauschbar: eine andere KI müsste hier nur
// eigene Implementierungen mit denselben Rückgabeformen bekommen.
const AIProvider = (function () {
  "use strict";

  const LS_WORKER_URL = "sw_ai_worker_url";
  const LS_WORKER_KEY = "sw_ai_worker_key";
  // Sonnet statt Opus, "Denktiefe" niedrig: für diese klar umrissenen Aufgaben
  // (Stellen finden, Namen auflisten) völlig ausreichend, aber deutlich
  // günstiger (siehe README, Abschnitt "Kosten im Blick behalten").
  const MODEL = "claude-sonnet-5";

  function getWorkerUrl() { return localStorage.getItem(LS_WORKER_URL) || ""; }
  function setWorkerUrl(url) { localStorage.setItem(LS_WORKER_URL, (url || "").trim()); }
  function getWorkerKey() { return localStorage.getItem(LS_WORKER_KEY) || ""; }
  function setWorkerKey(key) { localStorage.setItem(LS_WORKER_KEY, (key || "").trim()); }
  function isConfigured() { return !!getWorkerUrl() && !!getWorkerKey(); }

  async function callClaude(system, userText, schema, maxTokens) {
    if (!isConfigured()) throw new Error("NOT_CONFIGURED");

    const res = await fetch(getWorkerUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Worker-Key": getWorkerKey() },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: userText }],
        output_config: {
          format: { type: "json_schema", schema },
          // "low" reicht für diese klar umrissenen Aufgaben und hält die -
          // mitbezahlten - Denkschritte der KI kurz.
          effort: "low"
        }
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error("KI-Anfrage fehlgeschlagen (" + res.status + "): " + errText.slice(0, 200));
    }

    const data = await res.json();
    const textBlock = (data.content || []).find(b => b.type === "text");
    if (!textBlock) return null;

    try { return JSON.parse(textBlock.text); }
    catch (e) { throw new Error("Antwort der KI konnte nicht gelesen werden."); }
  }

  // ---------- Korrektorat / Lektorat / Stil ----------
  const ANALYZE_SYSTEM_PROMPT = `Du bist eine sorgfältige, zurückhaltende Lektorats- und Korrektorats-Assistenz für eine Hobby-Autorin. Sie schreibt Kurzgeschichten aus dem Alltag mit ihren Hunden, oft aus der Perspektive der Hunde.

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

  const ANALYZE_SCHEMA = {
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
    if (!plainText || !plainText.trim()) return [];
    const parsed = await callClaude(
      ANALYZE_SYSTEM_PROMPT,
      "Hier ist die Geschichte:\n\n" + plainText,
      ANALYZE_SCHEMA,
      2048
    );
    const suggestions = Array.isArray(parsed && parsed.suggestions) ? parsed.suggestions : [];
    return suggestions.filter(s => s && typeof s.excerpt === "string" && s.excerpt.trim());
  }

  // ---------- Namen/Orte-Erkennung (für die Konsistenzprüfung) ----------
  // Wird pro Geschichte höchstens einmal aufgerufen (Ergebnis wird lokal
  // zwischengespeichert, siehe app.js) - der eigentliche Abgleich zwischen
  // den Geschichten passiert danach rein lokal, ohne weitere KI-Kosten.
  const ENTITIES_SYSTEM_PROMPT = `Du liest eine Kurzgeschichte und listest ausschließlich die darin vorkommenden Eigennamen auf: Namen von Personen und Tieren (figur) sowie Ortsnamen (ort).

Wichtig:
- Gib jeden Namen genauso wieder, wie er im Text geschrieben steht (keine Korrektur, keine Vereinheitlichung, keine Übersetzung).
- Jeden Namen nur einmal auflisten, auch wenn er mehrfach vorkommt.
- Keine allgemeinen Wörter, nur echte Eigennamen.
- Kommen keine Eigennamen vor, gib eine leere Liste zurück.`;

  const ENTITIES_SCHEMA = {
    type: "object",
    properties: {
      entities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string", enum: ["figur", "ort"] }
          },
          required: ["name", "type"],
          additionalProperties: false
        }
      }
    },
    required: ["entities"],
    additionalProperties: false
  };

  async function extractEntities(plainText) {
    if (!plainText || !plainText.trim()) return [];
    const parsed = await callClaude(
      ENTITIES_SYSTEM_PROMPT,
      "Hier ist die Geschichte:\n\n" + plainText,
      ENTITIES_SCHEMA,
      1024
    );
    const entities = Array.isArray(parsed && parsed.entities) ? parsed.entities : [];
    return entities.filter(e => e && typeof e.name === "string" && e.name.trim());
  }

  // ---------- Kapitel-Titel-Vorschläge (Buch-Assistent) ----------
  // Bekommt pro Kapitel nur Titel + kurze Ausschnitte der enthaltenen
  // Geschichten (keine vollen Texte) - reicht für Titel-Vorschläge und hält
  // die Anfrage klein und günstig.
  const CHAPTER_TITLES_SYSTEM_PROMPT = `Du hilfst einer Hobby-Autorin dabei, für die Kapitel ihres Buches passende, stimmungsvolle Titel zu finden. Sie schreibt Kurzgeschichten aus dem Alltag mit Hunden, oft aus der Perspektive der Hunde.

Du bekommst pro Kapitel den aktuellen Titel sowie Titel und kurze Ausschnitte der darin enthaltenen Geschichten.

Deine Aufgabe: Schlage für jedes Kapitel einen Titel vor, der zur Stimmung und zum Inhalt der enthaltenen Geschichten passt - lebendig und persönlich statt neutral (z. B. eher „Kurs unterbrochen" als „Kapitel 3"), ganz im Ton der jeweiligen Geschichten.

Wichtige Regeln:
- Nur vorschlagen, wenn ein anderer Titel wirklich eine Verbesserung gegenüber dem aktuellen wäre. Passt der aktuelle Titel schon gut, lass das Kapitel einfach weg.
- Der Titel-Stil soll sich an den tatsächlichen Geschichten orientieren, nicht an einem vorgegebenen Thema (z. B. nicht immer nautisch, außer die Geschichten legen das nahe).
- Kurz und einprägsam, kein ganzer Satz.
- Jeder Vorschlag braucht eine kurze, nachvollziehbare Begründung.`;

  const CHAPTER_TITLES_SCHEMA = {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            chapterId: { type: "string" },
            title: { type: "string" },
            reason: { type: "string" }
          },
          required: ["chapterId", "title", "reason"],
          additionalProperties: false
        }
      }
    },
    required: ["suggestions"],
    additionalProperties: false
  };

  async function suggestChapterTitles(chapters) {
    if (!Array.isArray(chapters) || chapters.length === 0) return [];
    const parsed = await callClaude(
      CHAPTER_TITLES_SYSTEM_PROMPT,
      "Hier sind die Kapitel:\n\n" + JSON.stringify(chapters),
      CHAPTER_TITLES_SCHEMA,
      1024
    );
    const suggestions = Array.isArray(parsed && parsed.suggestions) ? parsed.suggestions : [];
    return suggestions.filter(s => s && typeof s.chapterId === "string" && typeof s.title === "string" && s.title.trim());
  }

  // ---------- Aufbau & Wirkung (professionelle Lektorats-Reihenfolge) ----------
  // Anders als "analyzeStory": schaut sich die ganze Geschichte als Zusammenhang
  // an statt einzelne Textstellen. Braucht deshalb den vollen Text (wie
  // analyzeStory auch schon), ist also nicht teurer als die bestehende Prüfung.
  // Folgt bewusst der Lektorats-Reihenfolge vom Großen ins Detail (Makro ->
  // Szenen-Dynamik -> Mikro -> Stil), aber mit Kriterien, die zum tatsächlichen
  // Genre der Autorin passen (ruhige Tagebuch-Geschichten, kein Thriller) -
  // z. B. "lädt der Schluss zum Weiterlesen ein" statt "Cliffhanger".
  const STRUCTURE_SYSTEM_PROMPT = `Du bist eine einfühlsame Schreib-Mentorin für eine Hobby-Autorin, die Kurzgeschichten aus dem Alltag mit Hunden schreibt, oft aus der Perspektive der Hunde - ruhige, warme Tagebuch-Geschichten, kein Thriller und kein Krimi.

Du bekommst den vollständigen Text einer Geschichte. Gib eine kurze, ermutigende Gesamteinschätzung entlang von vier Ebenen, vom großen Ganzen ins Detail - kein Feintuning einzelner Sätze bei Rechtschreibung/Grammatik (das übernimmt eine andere Funktion):

- aufbauSpannungsbogen (Makro-Ebene): Sitzen die wichtigen Punkte an der richtigen Stelle - eine kurze Ausgangslage, ein auslösendes Ereignis, ein Wendepunkt oder Höhepunkt, ein stimmiger Abschluss? Wirkt der Aufbau in sich rund?
- einladungZumWeiterlesen (Szenen-Dynamik): Lädt der Schluss zum Weiterlesen/Wiederkommen ein - ein Gedanke, der nachhallt, eine offene Frage, ein Gefühl, das nachwirkt? Oder wirkt er zu abrupt abgeschnitten? (Kein Cliffhanger-Zwang - ein sanfter, stimmiger Abschluss ist bei diesem Genre oft genau richtig, das ist kein Mangel.)
- erzaehltempo (Mikro-Ebene/Pacing): Passt das Erzähltempo zur jeweiligen Szene - kurze, knappe Sätze in bewegten/aufgeregten Momenten, ruhigere, ausführlichere Sätze in stillen Momenten?
- showDontTell (Stil-Ebene): Werden Gefühle nur benannt ("Sie hatte Angst") statt durch Handlung/Körperreaktion spürbar gemacht ("Ihre Pfoten zitterten")?
- kapitelTrennung: Nur befüllen, wenn die Geschichte lang/vielschichtig genug ist, dass ein Schnitt in zwei eigenständige Teile sinnvoll wäre - mit kurzer Begründung.

Zu jeder Ebene gibst du zusätzlich "excerpt" mit: eine kurze, zeichengenau wörtlich aus der Geschichte kopierte Textstelle, auf die sich dein Kommentar konkret bezieht (kein Umformulieren, keine ergänzten Anführungszeichen) - damit die Stelle im Text wiedergefunden werden kann. Bezieht sich dein Kommentar auf die Geschichte als Ganzes statt auf eine bestimmte Stelle (z. B. allgemeines Tempo-Feedback), lass "excerpt" leer.

Wichtig:
- Sei konkret und nachvollziehbar, keine leeren Floskeln.
- Erfinde keine Probleme nur um etwas zu liefern - funktioniert eine Ebene schon gut, gib dort "text" und "excerpt" leer zurück.
- Dränge die Autorin nie in einen fremden Stil oder ein fremdes Genre (z. B. Spannung/Action-Schreibweise) - bewerte innerhalb ihres eigenen, ruhigen Tons.
- Bleib wertschätzend, das ist eine Hobby-Autorin, kein Uni-Seminar.
- Du schreibst nichts um, du gibst nur Einschätzungen.`;

  const STRUCTURE_FINDING_SCHEMA = {
    type: "object",
    properties: {
      text: { type: "string" },
      excerpt: { type: "string" }
    },
    required: ["text", "excerpt"],
    additionalProperties: false
  };

  const STRUCTURE_SCHEMA = {
    type: "object",
    properties: {
      aufbauSpannungsbogen: STRUCTURE_FINDING_SCHEMA,
      einladungZumWeiterlesen: STRUCTURE_FINDING_SCHEMA,
      erzaehltempo: STRUCTURE_FINDING_SCHEMA,
      showDontTell: STRUCTURE_FINDING_SCHEMA,
      kapitelTrennung: STRUCTURE_FINDING_SCHEMA
    },
    required: ["aufbauSpannungsbogen", "einladungZumWeiterlesen", "erzaehltempo", "showDontTell", "kapitelTrennung"],
    additionalProperties: false
  };

  function emptyFinding() { return { text: "", excerpt: "" }; }

  async function analyzeStructure(plainText) {
    const empty = {
      aufbauSpannungsbogen: emptyFinding(), einladungZumWeiterlesen: emptyFinding(),
      erzaehltempo: emptyFinding(), showDontTell: emptyFinding(), kapitelTrennung: emptyFinding()
    };
    if (!plainText || !plainText.trim()) return empty;
    const parsed = await callClaude(
      STRUCTURE_SYSTEM_PROMPT,
      "Hier ist die Geschichte:\n\n" + plainText,
      STRUCTURE_SCHEMA,
      1536
    );
    function pick(key) {
      const f = parsed && parsed[key];
      return { text: (f && f.text) || "", excerpt: (f && f.excerpt) || "" };
    }
    return {
      aufbauSpannungsbogen: pick("aufbauSpannungsbogen"),
      einladungZumWeiterlesen: pick("einladungZumWeiterlesen"),
      erzaehltempo: pick("erzaehltempo"),
      showDontTell: pick("showDontTell"),
      kapitelTrennung: pick("kapitelTrennung")
    };
  }

  return {
    getWorkerUrl, setWorkerUrl, getWorkerKey, setWorkerKey, isConfigured,
    analyzeStory, extractEntities, suggestChapterTitles, analyzeStructure
  };
})();
