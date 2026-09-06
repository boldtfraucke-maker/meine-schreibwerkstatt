(function () {
  "use strict";

  // ---------- State ----------
  let stories = [];
  let ideas = [];
  let books = [];
  let activeStoryId = null;
  let activeBookId = null;
  let autosaveTimer = null;
  let bookSaveTimer = null;
  let suggestionResizeHandler = null;

  const STATUS_OPTIONS = [
    { value: "idee", label: "Idee", color: "#A79E8C" },
    { value: "entwurf", label: "Entwurf", color: "#5D7E8F" },
    { value: "in_arbeit", label: "In Arbeit", color: "#8B5E3C" },
    { value: "ueberarbeitung", label: "Überarbeitung", color: "#C08A2E" },
    { value: "fertig", label: "Fertig", color: "#2F4B3C" },
    { value: "veroeffentlicht", label: "Veröffentlicht", color: "#5C4A9C" }
  ];

  const FONT_OPTIONS = [
    { label: "Georgia", stack: "Georgia, 'Times New Roman', serif" },
    { label: "Times New Roman", stack: "'Times New Roman', Times, serif" },
    { label: "Garamond", stack: "'EB Garamond', Garamond, serif" },
    { label: "Merriweather", stack: "'Merriweather', Georgia, serif" },
    { label: "Verdana", stack: "Verdana, Geneva, sans-serif" }
  ];
  const FONT_SIZE_OPTIONS = [9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32];

  function statusLabel(v) { return (STATUS_OPTIONS.find(s => s.value === v) || STATUS_OPTIONS[0]).label; }
  function statusColor(v) { return (STATUS_OPTIONS.find(s => s.value === v) || STATUS_OPTIONS[0]).color; }

  function uid() {
    return (crypto.randomUUID ? crypto.randomUUID() : "s-" + Date.now() + "-" + Math.random().toString(16).slice(2));
  }

  function wordCount(html) {
    const text = (html || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").trim();
    if (!text) return 0;
    return text.split(/\s+/).filter(Boolean).length;
  }

  function plainSnippet(html, len) {
    const text = (html || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    return text.length > len ? text.slice(0, len) + "…" : text;
  }

  function relativeTime(iso) {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    const isYest = d.toDateString() === yest.toDateString();
    const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    if (sameDay) return "Heute, " + time + " Uhr";
    if (isYest) return "Gestern, " + time + " Uhr";
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ", " + time + " Uhr";
  }

  function escapeHtml(str) {
    return (str || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function escapeAttr(str) { return escapeHtml(str); }

  // Hebt in einem bereits escapten Text zitierte Wortgruppen (in
  // Anführungszeichen) farbig hervor, damit man in einer Begründung leichter
  // erkennt, welche Textstelle konkret gemeint ist - rot bei Handlungsbedarf,
  // grün bei reinem Lob (sonst wirkt eine rote Hervorhebung in einer
  // positiven Karte widersprüchlich). Arbeitet bewusst auf dem schon
  // escapten String (kein XSS-Risiko), deshalb auch die escapten Formen
  // gerader Anführungszeichen (&quot;/&#39;) mit berücksichtigen.
  function highlightQuotedPhrases(escapedText, positive) {
    const cls = positive ? "quote-flag quote-flag-positive" : "quote-flag";
    return escapedText.replace(
      /(&quot;|&#39;|„|")([^&"'„“”]{2,}?)(&quot;|&#39;|"|“|”)/g,
      (m, open, inner, close) => `${open}<span class="${cls}">${inner}</span>${close}`
    );
  }
  function textToHtml(text) {
    return text.split(/\n+/).filter(Boolean).map(line => `<p>${escapeHtml(line)}</p>`).join("");
  }
  function htmlToPlainText(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html || "";
    const blocks = tmp.querySelectorAll("p, h1, h2, h3, li");
    if (blocks.length === 0) return (tmp.textContent || "").trim();
    return Array.from(blocks).map(el => el.textContent).join("\n\n").trim();
  }

  // Sucht einen Textausschnitt im sichtbaren Text (nicht im rohen HTML) und
  // gibt dafür eine DOM-Range zurück - robuster als ein Vergleich gegen
  // innerHTML, das durch verschachtelte Formatierung (z. B. <b>) oder
  // HTML-Sonderzeichen leicht vom sichtbaren Text abweicht.
  function findExcerptRange(root, excerpt) {
    if (!excerpt) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let fullText = "";
    let node;
    while ((node = walker.nextNode())) {
      nodes.push({ node, start: fullText.length });
      fullText += node.nodeValue;
    }

    // forEnd: true für den Ende-Punkt eines Bereichs - bevorzugt dann das
    // Ende des vorherigen Textknotens statt den Anfang des nächsten, wenn der
    // Offset exakt auf eine Knotengrenze fällt (z. B. Absatzende). Ohne das
    // würde der Bereich manchmal fälschlich in den nächsten Absatz
    // hineinreichen, was insertNode()/deleteContents() den neuen Text
    // versehentlich außerhalb des ursprünglichen <p> einfügen lässt.
    function locate(offset, forEnd) {
      for (let i = 0; i < nodes.length; i++) {
        const start = nodes[i].start;
        const len = nodes[i].node.nodeValue.length;
        const end = start + len;
        if (offset < end) return { node: nodes[i].node, offset: offset - start };
        if (offset === end && forEnd) return { node: nodes[i].node, offset: len };
      }
      if (nodes.length > 0) {
        const last = nodes[nodes.length - 1];
        return { node: last.node, offset: last.node.nodeValue.length };
      }
      return null;
    }
    function buildRange(start, end) {
      const startLoc = locate(start, false);
      const endLoc = locate(end, true);
      if (!startLoc || !endLoc) return null;
      const range = document.createRange();
      range.setStart(startLoc.node, startLoc.offset);
      range.setEnd(endLoc.node, endLoc.offset);
      return range;
    }

    // 1) Exakte Suche.
    const idx = fullText.indexOf(excerpt);
    if (idx !== -1) return buildRange(idx, idx + excerpt.length);

    // 2) Nachsichtige Suche als Rückfallebene: aus PDFs oder anderen Quellen
    // kopierter Text hat oft andere Anführungszeichen-Varianten oder
    // Leerzeichen-Arten (z. B. geschützte Leerzeichen) als das, was die KI
    // beim Zitieren zurückgibt - deshalb hier vor dem Vergleich vereinheitlichen.
    const normQuotes = (s) => s
      .replace(/[‘’‚‛]/g, "'")
      .replace(/[“”„«»]/g, '"');
    function collapseWhitespace(s) {
      let text = "", map = [], i = 0;
      while (i < s.length) {
        if (/\s/.test(s[i])) {
          map.push(i);
          text += " ";
          while (i < s.length && /\s/.test(s[i])) i++;
        } else {
          map.push(i);
          text += s[i];
          i++;
        }
      }
      return { text, map };
    }
    const { text: cwFull, map: mapFull } = collapseWhitespace(normQuotes(fullText));
    const { text: cwExcerpt } = collapseWhitespace(normQuotes(excerpt));
    const cIdx = cwFull.indexOf(cwExcerpt);
    if (cIdx === -1) return null;
    const startOrig = mapFull[cIdx];
    const lastNormIdx = cIdx + cwExcerpt.length - 1;
    const endOrig = (lastNormIdx + 1 < mapFull.length) ? mapFull[lastNormIdx + 1] : fullText.length;
    return buildRange(startOrig, endOrig);
  }

  // Ersetzt eine gefundene Textstelle durch neuen Text. Liegt die Stelle
  // komplett in einem einzelnen Textknoten (der Normalfall), wird der Text
  // dort direkt zugeschnitten - sicherer als deleteContents()+insertNode(),
  // das den neuen Text bei einer Stelle genau am Ende eines Absatzes
  // manchmal außerhalb des <p> statt darin einfügt.
  function replaceExcerptText(editorPage, excerpt, newText) {
    const range = findExcerptRange(editorPage, excerpt);
    if (!range) return false;
    if (range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
      const node = range.startContainer;
      const text = node.textContent;
      node.textContent = text.slice(0, range.startOffset) + newText + text.slice(range.endOffset);
    } else {
      range.deleteContents();
      range.insertNode(document.createTextNode(newText));
    }
    editorPage.normalize();
    return true;
  }

  // Scrollt eine Fundstelle in die Mitte des Bildschirms und lässt sie kurz
  // sichtbar aufleuchten, statt sie dauerhaft farbig zu markieren (das bliebe
  // sonst als Formatierung im gespeicherten Text zurück).
  function scrollAndFlashRange(range) {
    const scroller = document.querySelector("main.content") || document.scrollingElement || document.documentElement;
    const rect = range.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const targetTop = scroller.scrollTop + (rect.top - scrollerRect.top) - scroller.clientHeight / 2;
    scroller.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    try {
      const mark = document.createElement("mark");
      mark.className = "ai-locate-flash";
      range.surroundContents(mark);
      setTimeout(() => {
        const parent = mark.parentNode;
        if (!parent) return;
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        parent.removeChild(mark);
        parent.normalize();
      }, 1800);
    } catch (e) {
      // Bereich lässt sich nicht sauber umschließen (z. B. spannt über mehrere
      // Absätze hinweg) - dann eben ohne Aufleuchten, Scrollen reicht meist auch.
    }
  }

  // Zeigt an einem Button (bzw. dessen Desktop-/Handy-Zwillingen) ein kleines
  // Zahlen-Abzeichen mit der Anzahl offener Punkte, damit man beim Öffnen
  // einer Geschichte sofort sieht, ob noch etwas absteht - ohne scrollen
  // oder neu prüfen zu müssen.
  function setCountBadge(ids, count) {
    ids.forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      let badge = btn.querySelector(".count-badge");
      if (count > 0) {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "count-badge";
          btn.appendChild(badge);
        }
        badge.textContent = String(count);
      } else if (badge) {
        badge.remove();
      }
    });
  }

  // ---------- Rand-Marker (Desktop/Tablet quer) ----------
  // Am PC/Tablet gibt es genug Platz, um Vorschläge und Aufbau-Befunde als
  // kleine farbige Marker direkt neben der betroffenen Textstelle
  // anzuzeigen, statt in einer Liste weit unter dem Editor - Klick öffnet
  // ein kleines Feld mit der Einzelheit, ohne den Text-Kontext zu verlieren.
  // Auf dem Handy (kein Platz für einen Rand) bleibt es bei der Liste.
  let markerPopoverEl = null;
  let markerOutsideClickHandler = null;

  function closeMarkerPopover() {
    if (markerPopoverEl) markerPopoverEl.hidden = true;
    if (markerOutsideClickHandler) {
      document.removeEventListener("mousedown", markerOutsideClickHandler);
      markerOutsideClickHandler = null;
    }
  }

  // In eine eigene Funktion ausgelagert, damit die Position nicht nur beim
  // ersten Öffnen berechnet wird, sondern auch erneut, wenn sich die Höhe
  // des Feldes danach ändert (z. B. beim Aufklappen des Entwurfsfelds) -
  // sonst blieb das Feld starr an der ursprünglichen Stelle und konnte über
  // den unteren Bildschirmrand hinausragen, sodass man nicht mehr
  // hineinklicken/-schreiben konnte.
  function positionMarkerPopover(pop, markerEl) {
    const markerRect = markerEl.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    let left = markerRect.left - popRect.width - 12;
    if (left < 8) left = markerRect.right + 12;
    if (left + popRect.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - popRect.width - 8);
    let top = markerRect.top;
    if (top + popRect.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - popRect.height - 8);
    pop.style.left = left + "px";
    pop.style.top = top + "px";
  }

  function openMarkerPopover(markerEl, buildContent) {
    if (!markerPopoverEl) {
      markerPopoverEl = document.createElement("div");
      markerPopoverEl.className = "marker-popover";
      markerPopoverEl.hidden = true;
      document.body.appendChild(markerPopoverEl);
    }
    const pop = markerPopoverEl;
    pop.innerHTML = "";
    buildContent(pop);
    pop.hidden = false;
    positionMarkerPopover(pop, markerEl);

    markerOutsideClickHandler = (e) => {
      if (!pop.contains(e.target) && e.target !== markerEl) closeMarkerPopover();
    };
    setTimeout(() => document.addEventListener("mousedown", markerOutsideClickHandler), 0);
  }

  function showMarkerCard(item, markerEl, story, editorPage, scheduleSave, onResolved) {
    openMarkerPopover(markerEl, (pop) => {
      if (item.kind === "ai") {
        const sug = item.data;
        const canApply = !!findExcerptRange(editorPage, sug.excerpt);
        pop.innerHTML = aiSuggestionBodyHtml(sug, "ai-opt-" + uid()) + `
          ${!canApply ? '<div class="ai-suggestion-note">Konnte die Textstelle nicht genau wiederfinden – bitte von Hand anpassen.</div>' : ""}
          <div class="ai-suggestion-actions">
            <button class="btn btn-primary pop-apply-btn" ${canApply ? "" : "disabled"}>Übernehmen</button>
            <button class="btn btn-ghost pop-dismiss-btn">Ablehnen</button>
          </div>`;
        pop.querySelector(".pop-apply-btn").addEventListener("click", async () => {
          const chosen = getSelectedSuggestion(pop, sug);
          if (!replaceExcerptText(editorPage, sug.excerpt, chosen)) return;
          sug.done = true;
          await Storage.save(story);
          scheduleSave();
          closeMarkerPopover();
          onResolved();
        });
        pop.querySelector(".pop-dismiss-btn").addEventListener("click", async () => {
          sug.done = true;
          await Storage.save(story);
          closeMarkerPopover();
          onResolved();
        });
      } else {
        const f = item.data;
        pop.classList.toggle("positive", !!f.positive);
        pop.innerHTML = structureBodyHtml(f) + structureActionsHtml(f);
        wireStructureActions(pop, f, story, editorPage, scheduleSave, () => {
          closeMarkerPopover();
          onResolved();
        }, () => positionMarkerPopover(pop, markerEl));
      }
    });
  }

  function renderMarkerGutter(story, editorPage, scheduleSave, onResolved) {
    const gutter = document.getElementById("marginGutter");
    if (!gutter) return;
    gutter.innerHTML = "";
    closeMarkerPopover();

    const items = [];
    (story.aiCheck ? story.aiCheck.suggestions : []).forEach((sug) => {
      if (!sug.done) items.push({ kind: "ai", data: sug, excerpt: sug.excerpt, cat: sug.type || "korrektorat" });
    });
    (story.structureCheck ? story.structureCheck.findings : []).forEach((f) => {
      if (!f.done && f.excerpt) items.push({ kind: "structure", data: f, excerpt: f.excerpt, cat: f.positive ? "positive" : f.cat });
    });

    const gutterRect = gutter.getBoundingClientRect();
    items.forEach((item) => {
      const range = findExcerptRange(editorPage, item.excerpt);
      if (!range) return;
      const rect = range.getBoundingClientRect();
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = "margin-marker cat-" + item.cat;
      marker.style.top = Math.max(0, rect.top - gutterRect.top) + "px";
      marker.title = item.kind === "ai" ? (AI_TYPE_LABELS[item.data.type] || "Vorschlag") : item.data.label;
      marker.addEventListener("click", (e) => {
        e.stopPropagation();
        showMarkerCard(item, marker, story, editorPage, scheduleSave, onResolved);
      });
      gutter.appendChild(marker);
    });
  }

  // Ein Einstiegspunkt für beide Funktionen zusammen: entscheidet je nach
  // Bildschirmbreite, ob Marker (PC/Tablet quer) oder die Liste (Handy)
  // gezeigt werden, und hält beides synchron nach jeder Änderung.
  // Geschichten, deren KI-Vorschläge noch vor der Umstellung auf mehrere
  // Formulierungs-Alternativen gespeichert wurden, haben noch das alte Feld
  // "suggestion" (Text) statt "suggestions" (Liste) - hier auf das neue
  // Format anheben, damit sie nicht zum Absturz führen.
  function normalizeAiCheck(story) {
    if (!story.aiCheck || !Array.isArray(story.aiCheck.suggestions)) return;
    story.aiCheck.suggestions.forEach((sug) => {
      if (!Array.isArray(sug.suggestions)) {
        sug.suggestions = (typeof sug.suggestion === "string" && sug.suggestion.trim()) ? [sug.suggestion] : [""];
      }
    });
  }

  function refreshSuggestionUI(story, editorPage, scheduleSave) {
    normalizeAiCheck(story);
    const desktop = window.matchMedia("(min-width: 821px)").matches;
    renderAiSuggestions(document.getElementById("aiPanel"), story, editorPage, scheduleSave, { desktop });
    renderStructureResults(document.getElementById("structurePanel"), story, editorPage, scheduleSave, { desktop });
    if (desktop) {
      renderMarkerGutter(story, editorPage, scheduleSave, () => refreshSuggestionUI(story, editorPage, scheduleSave));
    } else {
      const gutter = document.getElementById("marginGutter");
      if (gutter) gutter.innerHTML = "";
      closeMarkerPopover();
    }
  }

  function upsertLocal(story) {
    const idx = stories.findIndex(s => s.id === story.id);
    if (idx >= 0) stories[idx] = story; else stories.push(story);
  }
  function removeLocal(id) { stories = stories.filter(s => s.id !== id); }

  // ---------- Navigation ----------
  function switchView(view) {
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.getElementById("view-" + view).classList.add("active");
    document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    if (view === "start") renderStart();
    if (view === "ideas") renderIdeas();
    if (view === "books") renderBooks();
    if (view === "settings") { renderDriveSettings(); renderAiSettings(); }
  }
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  // ---------- Suche mit Live-Vorschlägen ----------
  function wireSearch(inputEl, suggestionsEl, onSelect) {
    function renderSuggestions(query) {
      const q = query.trim().toLowerCase();
      if (!q) { suggestionsEl.hidden = true; suggestionsEl.innerHTML = ""; return; }
      const matches = stories
        .filter(s => (s.title || "").toLowerCase().includes(q))
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .slice(0, 8);
      suggestionsEl.innerHTML = "";
      if (matches.length === 0) {
        suggestionsEl.innerHTML = '<div class="empty-hint">Keine Geschichte gefunden.</div>';
      } else {
        matches.forEach(s => {
          const item = document.createElement("div");
          item.className = "story-item";
          item.innerHTML = `
            <div class="title">${escapeHtml(s.title || "Ohne Titel")}</div>
            <div class="meta"><span class="status-dot" style="background:${statusColor(s.status)}"></span>${statusLabel(s.status)} · ${relativeTime(s.updatedAt)}</div>`;
          item.addEventListener("click", () => {
            inputEl.value = "";
            suggestionsEl.hidden = true;
            onSelect(s.id);
          });
          suggestionsEl.appendChild(item);
        });
      }
      suggestionsEl.hidden = false;
    }
    inputEl.addEventListener("input", () => renderSuggestions(inputEl.value));
    inputEl.addEventListener("focus", () => { if (inputEl.value.trim()) renderSuggestions(inputEl.value); });
    document.addEventListener("click", (e) => {
      if (e.target !== inputEl && !suggestionsEl.contains(e.target)) suggestionsEl.hidden = true;
    });
  }

  wireSearch(document.getElementById("startSearchInput"), document.getElementById("startSearchSuggestions"), (id) => {
    switchView("write");
    openStory(id);
  });

  // ---------- Start view ----------
  function setGreeting() {
    const h = new Date().getHours();
    let g = "Guten Abend";
    if (h < 12) g = "Guten Morgen";
    else if (h < 18) g = "Guten Tag";
    document.getElementById("greetingText").textContent = g + "!";
  }

  function renderStart() {
    setGreeting();
    document.getElementById("statCount").textContent = stories.length;
    const totalWords = stories.reduce((sum, s) => sum + wordCount(s.content), 0);
    document.getElementById("statWords").textContent = totalWords.toLocaleString('de-DE');
    document.getElementById("statDrafts").textContent = stories.filter(s => s.status === "entwurf" || s.status === "idee").length;

    const sorted = [...stories].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const continueCard = document.getElementById("continueCard");

    if (sorted.length === 0) {
      continueCard.hidden = false;
      continueCard.innerHTML = '<div>Noch keine Geschichte begonnen. Nutze die Suche oder starte unten eine neue.</div>';
      return;
    }

    const latest = sorted[0];
    const isDone = latest.status === "fertig" || latest.status === "veroeffentlicht";
    continueCard.hidden = false;
    continueCard.innerHTML = `
      <div>
        <div class="eyebrow">${isDone ? "Zuletzt bearbeitet" : "Weiterschreiben an"}</div>
        <div class="title">${escapeHtml(latest.title || "Ohne Titel")}</div>
        <div class="meta">${statusLabel(latest.status)} · ${relativeTime(latest.updatedAt)}</div>
      </div>
      <button class="btn btn-primary" id="continueBtn">${isDone ? "Öffnen →" : "Weiterschreiben →"}</button>`;
    document.getElementById("continueBtn").addEventListener("click", () => { switchView("write"); openStory(latest.id); });
  }

  document.getElementById("startNewStoryBtn").addEventListener("click", async () => {
    switchView("write");
    await createStory();
  });

  // ---------- Schreiben view ----------
  async function createStory() {
    const story = {
      id: uid(),
      title: "",
      content: "",
      status: "idee",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    stories.push(story);
    await Storage.save(story);
    openStory(story.id);
  }

  function openStory(id) {
    activeStoryId = id;
    renderEditor();
  }

  function renderEditor() {
    if (suggestionResizeHandler) {
      window.removeEventListener("resize", suggestionResizeHandler);
      suggestionResizeHandler = null;
    }
    closeMarkerPopover();
    const panel = document.getElementById("editorPanel");
    const story = stories.find(s => s.id === activeStoryId);
    if (!story) {
      panel.innerHTML = '<div class="editor-empty">Wähle auf der Startseite eine Geschichte aus oder beginne dort eine neue.</div>';
      return;
    }
    panel.innerHTML = `
      <div class="editor-top">
        <input type="text" class="title-input" id="titleInput" placeholder="Titel der Geschichte" autocomplete="off" autocapitalize="sentences" value="${escapeAttr(story.title)}">
        <select class="status-select" id="statusSelect">
          ${STATUS_OPTIONS.map(o => `<option value="${o.value}" ${o.value === story.status ? "selected" : ""}>${o.label}</option>`).join("")}
        </select>
      </div>
      <div class="toolbar">
        <div class="toolbar-group toolbar-group-font">
          <select class="tool-select" id="fontSelect" title="Schriftart">
            ${FONT_OPTIONS.map(f => `<option value="${escapeAttr(f.stack)}">${f.label}</option>`).join("")}
          </select>
          <select class="tool-select tool-select-narrow" id="fontSizeSelect" title="Schriftgröße">
            ${FONT_SIZE_OPTIONS.map(pt => `<option value="${pt}" ${pt === 12 ? "selected" : ""}>${pt} pt</option>`).join("")}
          </select>
        </div>
        <div class="toolbar-group toolbar-group-format">
          <span class="toolbar-divider"></span>
          <button class="tool-btn" data-cmd="bold" title="Fett"><b>F</b></button>
          <button class="tool-btn" data-cmd="italic" title="Kursiv"><i>K</i></button>
          <button class="tool-btn" data-cmd="insertUnorderedList" title="Liste">• Liste</button>
          <button class="tool-btn" data-cmd="image" title="Bild einfügen">🖼 Bild</button>
          <input type="file" id="imageInput" accept="image/*" style="display:none;">
        </div>
        <div class="editor-actions-top">
          <button class="btn btn-outline" id="copyTextBtnTop" title="Text kopieren, um ihn z. B. in einem anderen KI-Chat einzufügen">📋 Text kopieren</button>
          <div class="btn-with-info">
            <button class="btn btn-outline" id="aiCheckBtnTop">✨ KI-Vorschläge</button>
            <button class="info-badge" id="aiCheckInfoBtnTop" title="Was macht das?" aria-label="Was macht das?">ⓘ</button>
          </div>
          <div class="btn-with-info">
            <button class="btn btn-outline" id="structureCheckBtnTop">📖 Aufbau prüfen</button>
            <button class="info-badge" id="structureInfoBtnTop" title="Was macht das?" aria-label="Was macht das?">ⓘ</button>
          </div>
          <button class="btn btn-danger" id="deleteStoryBtnTop">Löschen</button>
        </div>
      </div>
      <div class="editor-with-margin">
        <div class="editor-page" id="editorPage" contenteditable="true" spellcheck="true" lang="de">${story.content || ""}</div>
        <div class="margin-gutter" id="marginGutter"></div>
      </div>
      <div class="editor-footer">
        <div class="save-status"><span class="save-dot"></span><span id="saveStatusText">Automatisch gespeichert</span></div>
        <div class="editor-footer-actions">
          <button class="btn btn-outline" id="copyTextBtn" title="Text kopieren, um ihn z. B. in einem anderen KI-Chat einzufügen">📋 Text kopieren</button>
          <div class="btn-with-info">
            <button class="btn btn-outline" id="aiCheckBtn">✨ KI-Vorschläge</button>
            <button class="info-badge" id="aiCheckInfoBtn" title="Was macht das?" aria-label="Was macht das?">ⓘ</button>
          </div>
          <div class="btn-with-info">
            <button class="btn btn-outline" id="structureCheckBtn">📖 Aufbau prüfen</button>
            <button class="info-badge" id="structureInfoBtn" title="Was macht das?" aria-label="Was macht das?">ⓘ</button>
          </div>
          <button class="btn btn-danger" id="deleteStoryBtn">Löschen</button>
        </div>
      </div>
      <div id="aiPanel"></div>
      <div id="structurePanel"></div>`;

    const titleInput = document.getElementById("titleInput");
    const statusSelect = document.getElementById("statusSelect");
    const editorPage = document.getElementById("editorPage");
    const saveStatusText = document.getElementById("saveStatusText");
    document.execCommand("defaultParagraphSeparator", false, "p");

    function scheduleSave() {
      saveStatusText.textContent = "Ungespeicherte Änderung …";
      clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(async () => {
        story.title = titleInput.value;
        story.content = editorPage.innerHTML;
        story.status = statusSelect.value;
        story.updatedAt = new Date().toISOString();
        await Storage.save(story);
        const t = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        saveStatusText.textContent = "Automatisch gespeichert · " + t + " Uhr";
        if (DriveSync.isConnected()) updateSyncChip("pending", "Änderungen vorhanden");
      }, 700);
    }

    titleInput.addEventListener("input", scheduleSave);
    statusSelect.addEventListener("change", scheduleSave);
    editorPage.addEventListener("input", scheduleSave);

    // Eingefügter Text kommt oft mit Formatierungs-Ballast aus anderen
    // Programmen (Word, PDF, Google Docs) - u. a. mit einem Zeilenumbruch
    // pro sichtbarer Zeile statt echten Absätzen. Deshalb nur den reinen Text
    // übernehmen und selbst zu sauberen Absätzen zusammensetzen: eine Leerzeile
    // trennt Absätze, einzelne Zeilenumbrüche dazwischen werden zu einem
    // Leerzeichen (statt zu einer erzwungenen neuen Zeile).
    editorPage.addEventListener("paste", (e) => {
      const text = (e.clipboardData || window.clipboardData).getData("text/plain");
      if (!text) return;
      e.preventDefault();
      const paragraphs = text
        .replace(/\r\n?/g, "\n")
        .split(/\n{2,}/)
        .map(block => block.split("\n").map(line => line.trim()).filter(Boolean).join(" ").trim())
        .filter(Boolean);
      const html = paragraphs.length
        ? paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join("")
        : escapeHtml(text);
      document.execCommand("insertHTML", false, html);
      scheduleSave();
    });

    // contenteditable verliert die Textmarkierung, sobald man auf ein
    // Toolbar-Dropdown klickt (der Fokus wechselt kurz weg). Deshalb merken
    // wir uns die letzte gültige Markierung im Editor und stellen sie vor
    // jedem Formatierungsbefehl wieder her.
    let savedRange = null;
    function saveSelection() {
      const sel = window.getSelection();
      if (sel.rangeCount > 0 && editorPage.contains(sel.anchorNode)) {
        savedRange = sel.getRangeAt(0).cloneRange();
      }
    }
    function restoreSelection() {
      if (!savedRange) return;
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
    editorPage.addEventListener("keyup", saveSelection);
    editorPage.addEventListener("mouseup", saveSelection);

    panel.querySelectorAll(".tool-btn[data-cmd]").forEach(btn => {
      // mousedown statt nur click, mit preventDefault: verhindert, dass der
      // Button dem Editor überhaupt erst den Fokus (und damit die Textmarkierung)
      // wegnimmt. Dadurch ist beim Klick immer noch die richtige Stelle markiert -
      // vorher musste man oft ein zweites Mal klicken, damit es "einrastet".
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => {
        const cmd = btn.dataset.cmd;
        if (cmd === "image") { document.getElementById("imageInput").click(); return; }
        document.execCommand(cmd, false, null);
        scheduleSave();
      });
    });

    // Bei den Dropdowns (Schriftart/-größe) lässt sich der Fokuswechsel nicht
    // verhindern (das native Dropdown-Menü braucht ihn) - die Markierung wird
    // deshalb vorher gerettet und der eigentliche Befehl minimal verzögert
    // (setTimeout 0) ausgeführt, nachdem der Browser den Fokuswechsel selbst
    // abgeschlossen hat. Ohne diese Verzögerung hat der Browser die
    // Markierung manchmal im selben Moment schon wieder verworfen.
    document.getElementById("fontSelect").addEventListener("change", (e) => {
      const value = e.target.value;
      restoreSelection();
      editorPage.focus();
      setTimeout(() => {
        restoreSelection();
        document.execCommand("fontName", false, value);
        saveSelection();
        scheduleSave();
      }, 0);
    });
    document.getElementById("fontSizeSelect").addEventListener("change", (e) => {
      const value = e.target.value;
      restoreSelection();
      editorPage.focus();
      setTimeout(() => {
        restoreSelection();
        // execCommand kennt nur die Stufen 1-7, keine echten pt-Werte. Deshalb Stufe 7
        // als eindeutige Markierung nutzen und danach durch die echte pt-Größe ersetzen -
        // der gängige Trick, um in contenteditable echte Punktgrößen zu setzen.
        document.execCommand("fontSize", false, "7");
        editorPage.querySelectorAll('font[size="7"]').forEach(el => {
          el.removeAttribute("size");
          el.style.fontSize = value + "pt";
        });
        saveSelection();
        scheduleSave();
      }, 0);
    });

    document.getElementById("imageInput").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        editorPage.focus();
        document.execCommand("insertImage", false, reader.result);
        scheduleSave();
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    });

    // Diese drei Aktionen gibt es doppelt im Markup (einmal oben für den
    // Desktop, einmal im Footer für unterwegs/Handy - siehe CSS). Beide
    // Varianten bekommen dieselbe Funktion zugewiesen.
    function wireBoth(ids, handler) {
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("click", handler);
      });
    }

    wireBoth(["deleteStoryBtn", "deleteStoryBtnTop"], () => {
      showConfirm(
        `„${story.title || 'Ohne Titel'}" wirklich löschen? Das kann nicht rückgängig gemacht werden.`,
        "Löschen",
        async () => {
          await Storage.remove(story.id);
          DriveSync.markDeleted("stories", story.id);
          stories = stories.filter(s => s.id !== story.id);
          activeStoryId = null;
          renderEditor();
          renderStart();
          if (DriveSync.isConnected()) updateSyncChip("pending", "Änderungen vorhanden");
        }
      );
    });

    wireBoth(["aiCheckBtn", "aiCheckBtnTop"], () => runAiCheck(story, editorPage, scheduleSave));
    wireBoth(["aiCheckInfoBtn", "aiCheckInfoBtnTop"], () => showAlert(
      "Liest diese eine Geschichte durch und schlägt Verbesserungen bei Rechtschreibung, langen Sätzen und Wiederholungen vor - mit Begründung, du entscheidest selbst. " +
      "Offene Vorschläge bleiben an der Geschichte gespeichert, bis du sie einzeln übernimmst oder ablehnst. Am PC/Tablet quer erscheinen sie als farbige Marker direkt neben der Textstelle, auf dem Handy als Liste. Kostet eine Kleinigkeit (Bruchteile eines Cents) pro Klick, am besten einsetzen, wenn eine Geschichte fertig geschrieben ist - nicht nach jedem einzelnen Satz."
    ));

    wireBoth(["structureCheckBtn", "structureCheckBtnTop"], () => runStructureCheck(story, editorPage, scheduleSave));
    wireBoth(["structureInfoBtn", "structureInfoBtnTop"], () => showAlert(
      "Schaut sich die ganze Geschichte im Zusammenhang an (nicht einzelne Sätze), in der Reihenfolge, wie es Lektorate auch tun - vom Großen ins Detail: Aufbau & Spannungsbogen, ob der Schluss zum Weiterlesen einlädt, das Erzähltempo, und Show-don't-tell. " +
      "Reine Einschätzung zum Nachdenken, nichts wird automatisch verändert. Die Anmerkungen bleiben an der Geschichte gespeichert, bis du sie einzeln als erledigt markierst. Kostet eine Kleinigkeit pro Klick, am besten bei einer fertigen Geschichte nutzen."
    ));
    refreshSuggestionUI(story, editorPage, scheduleSave);
    {
      let resizeDebounce = null;
      suggestionResizeHandler = () => {
        clearTimeout(resizeDebounce);
        resizeDebounce = setTimeout(() => refreshSuggestionUI(story, editorPage, scheduleSave), 150);
      };
      window.addEventListener("resize", suggestionResizeHandler);
    }

    wireBoth(["copyTextBtn", "copyTextBtnTop"], async (e) => {
      const plain = htmlToPlainText(editorPage.innerHTML);
      const text = (titleInput.value ? titleInput.value + "\n\n" : "") + plain;
      const btn = e.currentTarget;
      try {
        await navigator.clipboard.writeText(text);
        const original = btn.textContent;
        btn.textContent = "✓ Kopiert";
        setTimeout(() => { btn.textContent = original; }, 1500);
      } catch (err) {
        showAlert("Kopieren hat nicht geklappt. Bitte den Text im Editor von Hand markieren und kopieren.");
      }
    });

    // Neue, leere Geschichte: direkt in den Titel springen
    if (!story.title && !story.content) {
      titleInput.focus();
    }
  }

  // ---------- KI-Vorschläge ----------
  const AI_TYPE_LABELS = { korrektorat: "Korrektorat", lektorat: "Lektorat", stil: "Stil" };

  // Baut den gemeinsamen Inhalt einer Vorschlags-Karte - wiederverwendet von
  // der Listen-Ansicht (Handy) und dem Marker-Popover (PC/Tablet), damit
  // beide immer gleich funktionieren. Bei nur einer Formulierung reicht ein
  // einfacher Pfeil, bei mehreren echten Alternativen gibt's Radiobuttons
  // zur Auswahl, welche übernommen werden soll.
  function aiSuggestionBodyHtml(sug, radioName) {
    const options = sug.suggestions.length > 1
      ? `<div class="ai-suggestion-options">${sug.suggestions.map((s, i) => `
          <label class="ai-suggestion-option">
            <input type="radio" name="${escapeAttr(radioName)}" value="${i}" ${i === 0 ? "checked" : ""}>
            <span>${escapeHtml(s)}</span>
          </label>`).join("")}</div>`
      : `<div class="ai-suggestion-arrow">→ ${escapeHtml(sug.suggestions[0])}</div>`;
    return `
      <div class="ai-suggestion-type">${escapeHtml(AI_TYPE_LABELS[sug.type] || "Vorschlag")}</div>
      <div class="ai-suggestion-excerpt is-problem">„${escapeHtml(sug.excerpt)}"</div>
      ${options}
      <div class="ai-suggestion-reason"><strong>Warum?</strong> ${highlightQuotedPhrases(escapeHtml(sug.reason))}</div>`;
  }

  function getSelectedSuggestion(container, sug) {
    if (sug.suggestions.length === 1) return sug.suggestions[0];
    const checked = container.querySelector('input[type="radio"]:checked');
    return checked ? sug.suggestions[Number(checked.value)] : sug.suggestions[0];
  }

  function structureBodyHtml(f) {
    // Zeigt bei Handlungsbedarf die Original-Textstelle rot als eigene Zeile,
    // damit "Problem" (rot) und "Vorschlag" (grün, siehe .ai-suggestion-arrow)
    // wie ein Vorher/Nachher nebeneinanderstehen, statt sich in der
    // Fließtext-Begründung zu verstecken.
    const excerptLine = f.excerpt
      ? `<div class="ai-suggestion-excerpt${f.positive ? "" : " is-problem"}">„${escapeHtml(f.excerpt)}"</div>`
      : "";
    const suggestionPreview = (!f.positive && f.suggestion)
      ? `<div class="ai-suggestion-arrow">→ ${escapeHtml(f.suggestion)}</div>`
      : "";
    return `
      <div class="ai-suggestion-type">${escapeHtml(f.label)}</div>
      ${excerptLine}
      <div class="ai-suggestion-reason">${highlightQuotedPhrases(escapeHtml(f.text), f.positive)}</div>
      ${suggestionPreview}`;
  }

  // "Aufbau & Wirkung" liefert keine fertige Alternative wie KI-Vorschläge,
  // sondern nur eine Einschätzung - hier bekommt die Autorin stattdessen ein
  // Entwurfsfeld: eine Kopie der Textstelle (oder, falls vorhanden, gleich der
  // KI-Formulierungsvorschlag als Ausgangspunkt), die sie in Ruhe selbst
  // umschreiben kann, ohne den Originaltext direkt zu verändern. Der
  // Entwurf wird zwischengespeichert, damit nichts verloren geht, falls sie
  // das Feld zwischendurch schließt.
  function structureActionsHtml(f, opts) {
    const canLocate = !!(opts && opts.canLocate);
    const locateBtn = canLocate ? '<button class="btn btn-ghost locate-btn">→ Zur Stelle springen</button>' : "";
    const editBtn = f.excerpt ? '<button class="btn btn-ghost edit-draft-btn">✎ Text bearbeiten</button>' : "";
    const draftBox = f.excerpt ? `
      <div class="draft-editor" hidden>
        <textarea class="draft-textarea" rows="4">${escapeHtml(f.draft || f.suggestion || f.excerpt)}</textarea>
        <div class="ai-suggestion-actions">
          <button class="btn btn-primary draft-insert-btn">Einfügen</button>
          <button class="btn btn-ghost draft-cancel-btn">Abbrechen</button>
        </div>
      </div>` : "";
    return `
      <div class="ai-suggestion-actions">
        ${locateBtn}
        ${editBtn}
        <button class="btn btn-ghost done-btn">✓ Erledigt</button>
      </div>
      ${draftBox}`;
  }

  function wireStructureActions(container, f, story, editorPage, scheduleSave, onResolved, onToggleDraft) {
    const locateBtn = container.querySelector(".locate-btn");
    if (locateBtn) {
      locateBtn.addEventListener("click", () => {
        const range = findExcerptRange(editorPage, f.excerpt);
        if (range) scrollAndFlashRange(range);
      });
    }
    container.querySelector(".done-btn").addEventListener("click", async () => {
      f.done = true;
      await Storage.save(story);
      onResolved();
    });

    const editBtn = container.querySelector(".edit-draft-btn");
    if (!editBtn) return;
    const draftBox = container.querySelector(".draft-editor");
    const textarea = container.querySelector(".draft-textarea");

    editBtn.addEventListener("click", () => {
      draftBox.hidden = !draftBox.hidden;
      if (onToggleDraft) onToggleDraft();
    });

    let draftSaveTimer = null;
    textarea.addEventListener("input", () => {
      clearTimeout(draftSaveTimer);
      draftSaveTimer = setTimeout(async () => {
        f.draft = textarea.value;
        await Storage.save(story);
      }, 500);
    });

    container.querySelector(".draft-insert-btn").addEventListener("click", async () => {
      if (!replaceExcerptText(editorPage, f.excerpt, textarea.value)) return;
      f.done = true;
      delete f.draft;
      await Storage.save(story);
      scheduleSave();
      onResolved();
    });
    container.querySelector(".draft-cancel-btn").addEventListener("click", () => {
      draftBox.hidden = true;
    });
  }

  async function runAiCheck(story, editorPage, scheduleSave) {
    const panel = document.getElementById("aiPanel");
    if (!AIProvider.isConfigured()) {
      switchView("settings");
      showAlert("Bitte zuerst unter Einstellungen die Worker-Adresse und den Zugriffsschlüssel für die KI-Vorschläge hinterlegen.");
      return;
    }
    panel.innerHTML = '<div class="ai-panel-status">✨ Wird geprüft …</div>';
    try {
      const plainText = htmlToPlainText(editorPage.innerHTML);
      const suggestions = await AIProvider.analyzeStory(plainText);
      story.aiCheck = {
        checkedAt: new Date().toISOString(),
        suggestions: suggestions.map(s => ({ ...s, done: false }))
      };
      await Storage.save(story);
      refreshSuggestionUI(story, editorPage, scheduleSave);
    } catch (err) {
      console.error("KI-Fehler", err);
      const msg = err && err.message === "NOT_CONFIGURED"
        ? "Bitte zuerst unter Einstellungen die KI-Vorschläge einrichten."
        : "Prüfung fehlgeschlagen: " + (err && err.message ? err.message : String(err));
      panel.innerHTML = `<div class="ai-panel-status ai-panel-error">${escapeHtml(msg)}</div>`;
    }
  }

  // Baut eine einzelne KI-Vorschlag-Karte inkl. Verdrahtung (Zur-Stelle-
  // springen/Übernehmen/Ablehnen) - wird sowohl für die normale Liste (PC)
  // als auch für die Schritt-für-Schritt-Ansicht (Handy) verwendet.
  function buildAiSuggestionCard(sug, story, check, editorPage, scheduleSave, onResolved) {
    const canApply = !!findExcerptRange(editorPage, sug.excerpt);
    const card = document.createElement("div");
    card.className = "ai-suggestion-card";
    card.innerHTML = aiSuggestionBodyHtml(sug, "ai-opt-" + uid()) + `
      ${!canApply ? '<div class="ai-suggestion-note">Konnte die Textstelle nicht genau wiederfinden – bitte von Hand anpassen.</div>' : ""}
      <div class="ai-suggestion-actions">
        <button class="btn btn-ghost ai-locate-btn" ${canApply ? "" : "disabled"}>→ Zur Stelle springen</button>
        <button class="btn btn-primary ai-apply-btn" ${canApply ? "" : "disabled"}>Übernehmen</button>
        <button class="btn btn-ghost ai-dismiss-btn">Ablehnen</button>
      </div>`;

    card.querySelector(".ai-locate-btn").addEventListener("click", () => {
      const range = findExcerptRange(editorPage, sug.excerpt);
      if (range) scrollAndFlashRange(range);
    });
    card.querySelector(".ai-apply-btn").addEventListener("click", async () => {
      const chosen = getSelectedSuggestion(card, sug);
      if (!replaceExcerptText(editorPage, sug.excerpt, chosen)) return;
      sug.done = true;
      await Storage.save(story);
      scheduleSave();
      setCountBadge(["aiCheckBtn", "aiCheckBtnTop"], check.suggestions.filter(s => !s.done).length);
      onResolved();
    });
    card.querySelector(".ai-dismiss-btn").addEventListener("click", async () => {
      sug.done = true;
      await Storage.save(story);
      setCountBadge(["aiCheckBtn", "aiCheckBtnTop"], check.suggestions.filter(s => !s.done).length);
      onResolved();
    });
    return card;
  }

  // Zeigt offene Punkte auf dem Handy einzeln nacheinander an (statt einer
  // langen Liste zum Durchscrollen), mit Zähler "X von Y" sowie Weiter/
  // Zurück - erleichtert das schrittweise Abarbeiten unterwegs, ohne den
  // Überblick zu verlieren. "items" wird beim Erledigen eines Punktes direkt
  // verkürzt, sodass automatisch der nächste offene Punkt erscheint.
  function renderStepper(panel, topHtml, doneHtml, items, buildCard) {
    let index = 0;
    function renderCard() {
      if (items.length === 0) {
        panel.innerHTML = doneHtml;
        return;
      }
      if (index > items.length - 1) index = items.length - 1;
      if (index < 0) index = 0;
      panel.innerHTML = `
        ${topHtml}
        <div class="stepper-nav">
          <button class="btn btn-ghost stepper-prev" ${index === 0 ? "disabled" : ""}>← Zurück</button>
          <span class="stepper-count">${index + 1} von ${items.length}</span>
          <button class="btn btn-ghost stepper-next" ${index === items.length - 1 ? "disabled" : ""}>Weiter →</button>
        </div>
        <div id="stepperCard" class="ai-suggestion-list"></div>`;
      const list = panel.querySelector("#stepperCard");
      list.appendChild(buildCard(items[index], () => {
        items.splice(index, 1);
        renderCard();
      }));
      panel.querySelector(".stepper-prev").addEventListener("click", () => { index--; renderCard(); });
      panel.querySelector(".stepper-next").addEventListener("click", () => { index++; renderCard(); });
    }
    renderCard();
  }

  // Bleibt wie "Aufbau & Wirkung" an der Geschichte gespeichert - beim
  // erneuten Öffnen erscheinen offene Vorschläge automatisch wieder, statt
  // nach jedem Verlassen der Seite zu verschwinden.
  function renderAiSuggestions(panel, story, editorPage, scheduleSave, opts) {
    const desktop = !!(opts && opts.desktop);
    const check = story.aiCheck;
    const open = check ? check.suggestions.filter(s => !s.done) : [];
    setCountBadge(["aiCheckBtn", "aiCheckBtnTop"], open.length);
    if (!check) { panel.innerHTML = ""; return; }

    if (open.length === 0) {
      panel.innerHTML = '<div class="ai-panel-status">✓ Sieht gut aus – die KI hat gerade keine Vorschläge.</div>';
      return;
    }
    // Am PC/Tablet-quer bekommt jeder auffindbare Vorschlag stattdessen einen
    // Marker im Rand neben dem Text - nur Vorschläge, deren Textstelle nicht
    // mehr gefunden wird, bleiben hier in der Liste, statt spurlos zu
    // verschwinden.
    const listItems = desktop ? open.filter(s => !findExcerptRange(editorPage, s.excerpt)) : open;
    if (listItems.length === 0) {
      panel.innerHTML = '<div class="ai-panel-status">Siehe die farbigen Marker rechts neben dem Text →</div>';
      return;
    }
    const stale = new Date(story.updatedAt) > new Date(check.checkedAt);
    const topHtml = `
      <p class="section-label" style="margin-top:20px;">✨ KI-Vorschläge</p>
      ${stale ? '<div class="ai-suggestion-note" style="margin-bottom:10px;">Die Geschichte wurde seit dieser Prüfung verändert - manche Textstellen werden dadurch eventuell nicht mehr gefunden.</div>' : ""}`;

    if (!desktop) {
      renderStepper(
        panel, topHtml,
        '<div class="ai-panel-status">✓ Alle Vorschläge bearbeitet.</div>',
        listItems.slice(),
        (sug, onResolved) => buildAiSuggestionCard(sug, story, check, editorPage, scheduleSave, onResolved)
      );
      return;
    }

    panel.innerHTML = `${topHtml}<div id="aiSuggestionList" class="ai-suggestion-list"></div>`;
    const list = panel.querySelector("#aiSuggestionList");

    function checkEmpty() {
      if (list.children.length === 0) {
        panel.innerHTML = '<div class="ai-panel-status">Siehe die farbigen Marker rechts neben dem Text →</div>';
      }
    }

    listItems.forEach((sug) => {
      const card = buildAiSuggestionCard(sug, story, check, editorPage, scheduleSave, () => {
        card.remove();
        checkEmpty();
      });
      list.appendChild(card);
    });
  }

  // ---------- Aufbau & Wirkung (professionelle Lektorats-Reihenfolge) ----------
  // Vom Großen ins Detail: Makro (Aufbau) -> Szenen-Dynamik -> Mikro (Tempo) ->
  // Stil (Show/Tell). Jede Ebene bekommt eine eigene Farbe (siehe CSS
  // .ai-suggestion-card[data-cat]), angelehnt an die Farbidee für Highlights,
  // hier als Liste statt als Markierungen direkt im Text.
  const STRUCTURE_FIELDS = [
    { key: "aufbauSpannungsbogen", label: "Aufbau & Spannungsbogen (Makro)", cat: "makro" },
    { key: "einladungZumWeiterlesen", label: "Einladung zum Weiterlesen (Szene)", cat: "szene" },
    { key: "erzaehltempo", label: "Erzähltempo (Mikro)", cat: "mikro" },
    { key: "showDontTell", label: "Show, don't tell (Stil)", cat: "stil" },
    { key: "kapitelTrennung", label: "Mögliche Kapitel-Trennung", cat: "makro" }
  ];

  async function runStructureCheck(story, editorPage, scheduleSave) {
    const panel = document.getElementById("structurePanel");
    if (!AIProvider.isConfigured()) {
      switchView("settings");
      showAlert("Bitte zuerst unter Einstellungen die KI-Vorschläge einrichten.");
      return;
    }
    panel.innerHTML = '<div class="ai-panel-status">📖 Wird geprüft …</div>';
    try {
      const plainText = htmlToPlainText(editorPage.innerHTML);
      const result = await AIProvider.analyzeStructure(plainText);
      const findings = STRUCTURE_FIELDS
        .map(f => {
          const r = result && result[f.key];
          return {
            key: f.key, label: f.label, cat: f.cat,
            text: ((r && r.text) || "").trim(),
            excerpt: ((r && r.excerpt) || "").trim(),
            positive: !!(r && r.positive),
            suggestion: ((r && r.suggestion) || "").trim(),
            done: false
          };
        })
        .filter(f => f.text);
      story.structureCheck = { checkedAt: new Date().toISOString(), findings };
      await Storage.save(story);
      refreshSuggestionUI(story, editorPage, scheduleSave);
    } catch (err) {
      console.error("Aufbau-Prüfung-Fehler", err);
      const msg = err && err.message === "NOT_CONFIGURED"
        ? "Bitte zuerst unter Einstellungen die KI-Vorschläge einrichten."
        : "Prüfung fehlgeschlagen: " + (err && err.message ? err.message : String(err));
      panel.innerHTML = `<div class="ai-panel-status ai-panel-error">${escapeHtml(msg)}</div>`;
    }
  }

  // Der letzte Aufbau-Check bleibt an der Geschichte selbst gespeichert (nicht
  // im Ideenparkplatz) - beim erneuten Öffnen sieht man wieder, was zuletzt
  // gefunden wurde, bis man einen Punkt einzeln als erledigt markiert.
  // Baut eine einzelne "Aufbau & Wirkung"-Karte inkl. Verdrahtung - wird
  // sowohl für die normale Liste (PC) als auch für die Schritt-für-Schritt-
  // Ansicht (Handy) verwendet.
  function buildStructureCard(f, story, check, editorPage, scheduleSave, onResolved) {
    const canLocate = !!(f.excerpt && editorPage && findExcerptRange(editorPage, f.excerpt));
    const card = document.createElement("div");
    card.className = "ai-suggestion-card" + (f.positive ? " positive" : "");
    card.dataset.cat = f.cat;
    card.innerHTML = structureBodyHtml(f) + structureActionsHtml(f, { canLocate });
    wireStructureActions(card, f, story, editorPage, scheduleSave, () => {
      setCountBadge(["structureCheckBtn", "structureCheckBtnTop"], check.findings.filter(x => !x.done).length);
      onResolved();
    });
    return card;
  }

  function renderStructureResults(panel, story, editorPage, scheduleSave, opts) {
    const desktop = !!(opts && opts.desktop);
    const check = story.structureCheck;
    const allOpen = check ? check.findings.filter(f => !f.done) : [];
    setCountBadge(["structureCheckBtn", "structureCheckBtnTop"], allOpen.length);

    if (!check) { panel.innerHTML = ""; return; }
    if (allOpen.length === 0) {
      panel.innerHTML = '<div class="ai-panel-status">✓ Wirkt schon rund – keine besonderen Anmerkungen.</div>';
      return;
    }
    // Am PC/Tablet-quer bekommen Funde mit Textstelle stattdessen einen
    // Marker im Rand - hier bleiben nur die, die sich auf keine bestimmte
    // Stelle festlegen lassen (z. B. allgemeines Tempo-Feedback).
    const open = desktop ? allOpen.filter(f => !f.excerpt) : allOpen;
    if (open.length === 0) {
      panel.innerHTML = desktop
        ? '<div class="ai-panel-status">Siehe die farbigen Marker rechts neben dem Text →</div>'
        : '<div class="ai-panel-status">✓ Alle Anmerkungen bearbeitet.</div>';
      return;
    }

    const stale = new Date(story.updatedAt) > new Date(check.checkedAt);
    const topHtml = `
      <p class="section-label" style="margin-top:20px;">📖 Aufbau & Wirkung</p>
      ${stale ? '<div class="ai-suggestion-note" style="margin-bottom:10px;">Die Geschichte wurde seit dieser Prüfung verändert - die Anmerkungen könnten nicht mehr ganz aktuell sein.</div>' : ""}`;

    if (!desktop) {
      renderStepper(
        panel, topHtml,
        '<div class="ai-panel-status">✓ Alle Anmerkungen bearbeitet.</div>',
        open.slice(),
        (f, onResolved) => buildStructureCard(f, story, check, editorPage, scheduleSave, onResolved)
      );
      return;
    }

    panel.innerHTML = `${topHtml}<div id="structureList" class="ai-suggestion-list"></div>`;
    const list = panel.querySelector("#structureList");

    function checkEmpty() {
      if (list.children.length === 0) panel.innerHTML = '<div class="ai-panel-status">✓ Alle Anmerkungen bearbeitet.</div>';
    }

    open.forEach((f) => {
      const card = buildStructureCard(f, story, check, editorPage, scheduleSave, () => {
        card.remove();
        checkEmpty();
      });
      list.appendChild(card);
    });
  }

  function renderAiSettings() {
    const urlInput = document.getElementById("aiWorkerUrlInput");
    const keyInput = document.getElementById("aiWorkerKeyInput");
    const statusLine = document.getElementById("aiStatusLine");
    if (!urlInput) return;
    urlInput.value = AIProvider.getWorkerUrl();
    keyInput.value = AIProvider.getWorkerKey();
    const configured = AIProvider.isConfigured();
    statusLine.className = "settings-status-line " + (configured ? "state-ok" : "");
    statusLine.innerHTML = `<span class="dot"></span><span>${configured ? "Eingerichtet – „✨ KI-Vorschläge“ ist im Schreiben-Bereich verfügbar." : "Noch nicht eingerichtet."}</span>`;
  }

  document.getElementById("aiSettingsSaveBtn").addEventListener("click", () => {
    AIProvider.setWorkerUrl(document.getElementById("aiWorkerUrlInput").value);
    AIProvider.setWorkerKey(document.getElementById("aiWorkerKeyInput").value);
    renderAiSettings();
    showAlert("Gespeichert.");
  });

  // ---------- Konsistenzprüfung ----------
  // Zweistufig, um Kosten klein zu halten: Namen/Orte werden pro Geschichte
  // höchstens einmal von der KI erkannt (Ergebnis lokal zwischengespeichert,
  // nur bei Änderung der Geschichte neu abgefragt). Der eigentliche Abgleich
  // zwischen den Geschichten passiert danach komplett lokal, ohne weitere
  // KI-Kosten.
  const LS_ENTITY_CACHE = "sw_entity_cache"; // { storyId: { updatedAt, entities: [{name,type}] } }

  function getEntityCache() {
    try { return JSON.parse(localStorage.getItem(LS_ENTITY_CACHE) || "{}"); }
    catch (e) { return {}; }
  }
  function setEntityCache(cache) { localStorage.setItem(LS_ENTITY_CACHE, JSON.stringify(cache)); }

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = [];
    for (let i = 0; i <= m; i++) { dp.push([i]); }
    for (let j = 1; j <= n; j++) { dp[0][j] = j; }
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[m][n];
  }

  function findSimilarNamePairs(cache) {
    const byName = new Map();
    Object.entries(cache).forEach(([storyId, entry]) => {
      (entry.entities || []).forEach((e) => {
        const key = e.type + "::" + e.name;
        if (!byName.has(key)) byName.set(key, { name: e.name, type: e.type, storyIds: new Set() });
        byName.get(key).storyIds.add(storyId);
      });
    });

    const names = Array.from(byName.values());
    const pairs = [];
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = names[i], b = names[j];
        if (a.type !== b.type) continue;
        const aLower = a.name.toLowerCase(), bLower = b.name.toLowerCase();
        if (aLower === bLower) continue; // identisch (ggf. bis auf Groß-/Kleinschreibung) -> konsistent
        if (aLower[0] !== bLower[0]) continue; // anderer Anfangsbuchstabe -> vermutlich andere Sache
        const dist = levenshtein(aLower, bLower);
        const threshold = Math.max(a.name.length, b.name.length) <= 5 ? 1 : 2;
        if (dist <= threshold) {
          pairs.push({
            type: a.type,
            nameA: a.name, storyIdsA: Array.from(a.storyIds),
            nameB: b.name, storyIdsB: Array.from(b.storyIds)
          });
        }
      }
    }
    return pairs;
  }

  function storyTitleById(id) {
    const s = stories.find((x) => x.id === id);
    return s ? (s.title || "Ohne Titel") : "gelöschte Geschichte";
  }

  async function runConsistencyCheck() {
    const panel = document.getElementById("consistencyPanel");
    if (!panel) return;
    if (!AIProvider.isConfigured()) {
      switchView("settings");
      showAlert("Bitte zuerst unter Einstellungen die KI-Vorschläge einrichten - die Namens-/Orte-Erkennung nutzt dieselbe Anbindung.");
      return;
    }
    if (stories.length === 0) {
      panel.innerHTML = '<div class="ai-panel-status">Noch keine Geschichten vorhanden.</div>';
      return;
    }

    const cache = getEntityCache();
    const toExtract = stories.filter((s) => !cache[s.id] || cache[s.id].updatedAt !== s.updatedAt);

    panel.innerHTML = '<div class="ai-panel-status">🔍 Wird geprüft … <span id="consistencyProgress"></span></div>';
    const progressEl = document.getElementById("consistencyProgress");

    try {
      for (let i = 0; i < toExtract.length; i++) {
        if (progressEl) progressEl.textContent = `(neue/geänderte Geschichte ${i + 1} von ${toExtract.length})`;
        const story = toExtract[i];
        const entities = await AIProvider.extractEntities(htmlToPlainText(story.content));
        cache[story.id] = { updatedAt: story.updatedAt, entities };
        setEntityCache(cache);
      }

      // Cache um gelöschte Geschichten bereinigen
      const validIds = new Set(stories.map((s) => s.id));
      Object.keys(cache).forEach((id) => { if (!validIds.has(id)) delete cache[id]; });
      setEntityCache(cache);

      renderConsistencyResults(panel, findSimilarNamePairs(cache));
    } catch (err) {
      console.error("Konsistenzprüfung-Fehler", err);
      panel.innerHTML = `<div class="ai-panel-status ai-panel-error">Prüfung fehlgeschlagen: ${escapeHtml(err && err.message ? err.message : String(err))}</div>`;
    }
  }

  function renderConsistencyResults(panel, pairs) {
    if (pairs.length === 0) {
      panel.innerHTML = '<div class="ai-panel-status">✓ Keine möglichen Unstimmigkeiten bei Namen oder Orten gefunden.</div>';
      return;
    }
    const rows = pairs.map((p) => {
      const typeLabel = p.type === "ort" ? "Ort" : "Person/Tier";
      const storiesA = p.storyIdsA.map(storyTitleById).map(escapeHtml).join(", ");
      const storiesB = p.storyIdsB.map(storyTitleById).map(escapeHtml).join(", ");
      return `
        <div class="ai-suggestion-card">
          <div class="ai-suggestion-type">${escapeHtml(typeLabel)}</div>
          <div class="ai-suggestion-arrow">„${escapeHtml(p.nameA)}" (${storiesA}) &nbsp;↔&nbsp; „${escapeHtml(p.nameB)}" (${storiesB})</div>
          <div class="ai-suggestion-reason"><strong>Warum?</strong> Die Schreibweisen sind sich sehr ähnlich - könnte dieselbe ${p.type === "ort" ? "Sache" : "Figur"} sein, nur unterschiedlich geschrieben. Falls ja, lohnt sich eine einheitliche Schreibweise. Du entscheidest, ob und wo du das anpasst.</div>
        </div>`;
    }).join("");
    panel.innerHTML = `<p class="section-label" style="margin-top:8px;">🔍 Mögliche Unstimmigkeiten (${pairs.length})</p><div class="ai-suggestion-list">${rows}</div>`;
  }

  // ---------- Ideenparkplatz ----------
  function renderIdeas() {
    const list = document.getElementById("ideaList");
    const sorted = [...ideas].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    list.innerHTML = "";
    if (sorted.length === 0) {
      list.innerHTML = '<div class="empty-hint">Noch keine Idee gesammelt. Trage oben einen Gedanken, einen Satz oder eine Beobachtung ein.</div>';
      return;
    }
    sorted.forEach(idea => {
      const card = document.createElement("div");
      card.className = "idea-item";
      card.innerHTML = `
        <div class="idea-card">
          <div class="idea-text-wrap">
            <div class="text">${escapeHtml(idea.text)}</div>
            <div class="meta">${relativeTime(idea.updatedAt || idea.createdAt)}</div>
          </div>
        </div>
        <div class="idea-actions">
          <button class="btn btn-outline edit-idea-btn">✎ Bearbeiten</button>
          <button class="btn btn-outline make-story-btn">✎ Geschichte machen</button>
          <button class="btn btn-danger delete-idea-btn">Löschen</button>
        </div>`;

      card.querySelector(".edit-idea-btn").addEventListener("click", () => {
        card.querySelector(".idea-actions").style.display = "none";
        const textWrap = card.querySelector(".text").parentElement;
        textWrap.innerHTML = `
          <textarea class="idea-textarea idea-edit-textarea" rows="2">${escapeHtml(idea.text)}</textarea>
          <div style="display:flex;gap:8px;margin-top:8px;">
            <button class="btn btn-primary idea-edit-save">Speichern</button>
            <button class="btn btn-ghost idea-edit-cancel">Abbrechen</button>
          </div>`;
        const editTextarea = textWrap.querySelector(".idea-edit-textarea");
        editTextarea.focus();
        editTextarea.setSelectionRange(editTextarea.value.length, editTextarea.value.length);
        textWrap.querySelector(".idea-edit-save").addEventListener("click", async () => {
          const newText = editTextarea.value.trim();
          if (!newText) return;
          idea.text = newText;
          idea.updatedAt = new Date().toISOString();
          await IdeaStorage.save(idea);
          renderIdeas();
          if (DriveSync.isConnected()) updateSyncChip("pending", "Änderungen vorhanden");
        });
        textWrap.querySelector(".idea-edit-cancel").addEventListener("click", () => renderIdeas());
      });

      card.querySelector(".make-story-btn").addEventListener("click", () => {
        showConfirm(
          "Aus dieser Idee eine neue Geschichte erstellen? Die Idee wird dabei aus dem Ideenparkplatz entfernt.",
          "Geschichte erstellen",
          async () => {
            const story = {
              id: uid(),
              title: "",
              content: textToHtml(idea.text),
              status: "idee",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            stories.push(story);
            await Storage.save(story);
            await IdeaStorage.remove(idea.id);
            DriveSync.markDeleted("ideas", idea.id);
            ideas = ideas.filter(i => i.id !== idea.id);
            switchView("write");
            openStory(story.id);
            if (DriveSync.isConnected()) updateSyncChip("pending", "Änderungen vorhanden");
          }
        );
      });

      card.querySelector(".delete-idea-btn").addEventListener("click", () => {
        showConfirm("Diese Idee wirklich löschen?", "Löschen", async () => {
          await IdeaStorage.remove(idea.id);
          DriveSync.markDeleted("ideas", idea.id);
          ideas = ideas.filter(i => i.id !== idea.id);
          renderIdeas();
          if (DriveSync.isConnected()) updateSyncChip("pending", "Änderungen vorhanden");
        });
      });

      list.appendChild(card);
    });
  }

  document.getElementById("ideaSaveBtn").addEventListener("click", async () => {
    const textarea = document.getElementById("ideaInput");
    const text = textarea.value.trim();
    if (!text) return;
    const now = new Date().toISOString();
    const idea = { id: uid(), text, createdAt: now, updatedAt: now };
    ideas.push(idea);
    await IdeaStorage.save(idea);
    textarea.value = "";
    renderIdeas();
    if (DriveSync.isConnected()) updateSyncChip("pending", "Änderungen vorhanden");
  });

  // ---------- Bücher ----------
  function bookStats(book) {
    const ids = new Set();
    (book.chapters || []).forEach(ch => (ch.storyIds || []).forEach(id => ids.add(id)));
    const bookStories = stories.filter(s => ids.has(s.id));
    const words = bookStories.reduce((sum, s) => sum + wordCount(s.content), 0);
    const pages = words > 0 ? Math.max(1, Math.round(words / 290)) : 0;
    const doneCount = bookStories.filter(s => s.status === "fertig" || s.status === "veroeffentlicht").length;
    const percent = bookStories.length ? Math.round((doneCount / bookStories.length) * 100) : 0;
    return { count: bookStories.length, words, pages, percent };
  }

  function allUsedStoryIds(book) {
    const ids = [];
    (book.chapters || []).forEach(ch => (ch.storyIds || []).forEach(id => ids.push(id)));
    return ids;
  }

  async function saveBook(book) {
    book.updatedAt = new Date().toISOString();
    await BookStorage.save(book);
    if (DriveSync.isConnected()) updateSyncChip("pending", "Änderungen vorhanden");
  }

  function scheduleBookSave(book) {
    clearTimeout(bookSaveTimer);
    bookSaveTimer = setTimeout(() => { saveBook(book); }, 500);
  }

  function renderBooks() {
    const book = books.find(b => b.id === activeBookId);
    if (book) renderBookDetail(book);
    else { activeBookId = null; renderBookList(); }
  }

  function renderBookList() {
    const panel = document.getElementById("booksPanel");
    const sorted = [...books].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px;">
        <div>
          <h1 style="margin:0 0 4px;">Bücher</h1>
          <p class="greeting-sub" style="margin:0;">Stelle aus deinen Geschichten ein oder mehrere Bücher zusammen.</p>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
          <div class="btn-with-info">
            <button class="btn btn-outline" id="consistencyCheckBtn">🔍 Konsistenz prüfen</button>
            <button class="info-badge" id="consistencyInfoBtn" title="Was macht das?" aria-label="Was macht das?">ⓘ</button>
          </div>
          <button class="btn btn-primary" id="newBookBtn">+ Neues Buch</button>
        </div>
      </div>`;

    const wrap = document.createElement("div");
    if (sorted.length === 0) {
      wrap.innerHTML = '<div class="empty-hint">Noch kein Buch angelegt. Klicke oben auf „+ Neues Buch", um zu starten.</div>';
    } else {
      wrap.className = "book-grid";
      sorted.forEach(book => {
        const stats = bookStats(book);
        const card = document.createElement("div");
        card.className = "book-card";
        card.innerHTML = `
          ${book.cover ? `<img class="cover-thumb" src="${book.cover}" alt="">` : `<div class="cover-placeholder">📖</div>`}
          <div class="title">${escapeHtml(book.title || "Ohne Titel")}</div>
          ${book.subtitle ? `<div class="subtitle">${escapeHtml(book.subtitle)}</div>` : ""}
          <div class="meta">${stats.count} Geschichte(n) · ${stats.words.toLocaleString('de-DE')} Wörter · ${stats.percent}% fertig</div>`;
        card.addEventListener("click", () => { activeBookId = book.id; renderBookDetail(book); });
        wrap.appendChild(card);
      });
    }
    panel.appendChild(wrap);

    const consistencyPanel = document.createElement("div");
    consistencyPanel.id = "consistencyPanel";
    consistencyPanel.style.marginTop = "24px";
    panel.appendChild(consistencyPanel);

    document.getElementById("newBookBtn").addEventListener("click", async () => {
      const book = {
        id: uid(), title: "", subtitle: "", description: "", cover: "", chapters: [],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      };
      books.push(book);
      await BookStorage.save(book);
      activeBookId = book.id;
      renderBookDetail(book);
    });

    document.getElementById("consistencyCheckBtn").addEventListener("click", runConsistencyCheck);
    document.getElementById("consistencyInfoBtn").addEventListener("click", () => showAlert(
      "Vergleicht Namen und Orte über alle deine Geschichten hinweg, z. B. ob ein Hund immer gleich geschrieben wird („Balu“ vs. „Balou“). " +
      "Neue oder seit dem letzten Mal geänderte Geschichten kosten beim Prüfen eine Kleinigkeit; unveränderte Geschichten werden beim nächsten Mal wiederverwendet und kosten dann nichts mehr. " +
      "Am besten hin und wieder nutzen, z. B. bevor du ein Buch zusammenstellst - nicht nach jeder einzelnen Geschichte."
    ));
  }

  function renderBookDetail(book) {
    const panel = document.getElementById("booksPanel");
    const stats = bookStats(book);
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px;">
        <button class="btn btn-ghost" id="backToBooksBtn">← Alle Bücher</button>
        <button class="btn btn-primary" id="previewBookBtn">📖 Vorschau ansehen</button>
      </div>
      <div class="book-detail-top">
        <div class="book-cover-col">
          ${book.cover ? `<img class="cover-thumb" src="${book.cover}" alt="">` : `<div class="cover-placeholder">📖</div>`}
          <button class="btn btn-ghost" id="coverBtn" style="width:100%;">Cover ${book.cover ? "ändern" : "hinzufügen"}</button>
          <input type="file" id="coverInput" accept="image/*" style="display:none;">
        </div>
        <div class="book-fields">
          <input type="text" class="book-title-input" id="bookTitleInput" placeholder="Buchtitel" value="${escapeAttr(book.title)}">
          <input type="text" class="book-subtitle-input" id="bookSubtitleInput" placeholder="Untertitel (optional)" value="${escapeAttr(book.subtitle)}">
          <textarea class="book-description" id="bookDescInput" placeholder="Kurze Beschreibung (optional)">${escapeHtml(book.description || "")}</textarea>
        </div>
      </div>

      <div class="book-stat-row">
        <div class="stat-card"><div class="num">${stats.count}</div><div class="label">Geschichten</div></div>
        <div class="stat-card"><div class="num">${stats.words.toLocaleString('de-DE')}</div><div class="label">Wörter</div></div>
        <div class="stat-card"><div class="num">${stats.pages}</div><div class="label">Seiten (geschätzt)</div></div>
        <div class="stat-card"><div class="num">${stats.percent}%</div><div class="label">fertig</div></div>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
        <p class="section-label" style="margin:0;">Kapitel</p>
        <div class="btn-with-info">
          <button class="btn btn-outline" id="chapterTitlesBtn">✨ Kapitel-Titel vorschlagen</button>
          <button class="info-badge" id="chapterTitlesInfoBtn" title="Was macht das?" aria-label="Was macht das?">ⓘ</button>
        </div>
      </div>
      <div id="chapterList"></div>
      <div id="chapterAssistantPanel"></div>
      <button class="btn btn-outline" id="addChapterBtn">+ Kapitel hinzufügen</button>

      <div style="margin-top:28px;">
        <button class="btn btn-danger" id="deleteBookBtn">Löschen</button>
      </div>`;

    document.getElementById("backToBooksBtn").addEventListener("click", () => { activeBookId = null; renderBookList(); });
    document.getElementById("previewBookBtn").addEventListener("click", () => renderBookPreview(book));

    const titleInput = document.getElementById("bookTitleInput");
    const subtitleInput = document.getElementById("bookSubtitleInput");
    const descInput = document.getElementById("bookDescInput");
    [titleInput, subtitleInput, descInput].forEach(el => {
      el.addEventListener("input", () => {
        book.title = titleInput.value;
        book.subtitle = subtitleInput.value;
        book.description = descInput.value;
        scheduleBookSave(book);
      });
    });

    document.getElementById("coverBtn").addEventListener("click", () => document.getElementById("coverInput").click());
    document.getElementById("coverInput").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        book.cover = reader.result;
        await saveBook(book);
        renderBookDetail(book);
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    });

    renderChapters(book);

    document.getElementById("addChapterBtn").addEventListener("click", async () => {
      book.chapters = book.chapters || [];
      book.chapters.push({ id: uid(), title: "Kapitel " + (book.chapters.length + 1), storyIds: [] });
      await saveBook(book);
      renderBookDetail(book);
    });

    document.getElementById("chapterTitlesBtn").addEventListener("click", () => runChapterTitleSuggestions(book));
    document.getElementById("chapterTitlesInfoBtn").addEventListener("click", () => showAlert(
      "Schaut sich die Geschichten in deinen Kapiteln an und schlägt dazu passende, stimmungsvolle Titel vor - statt nur \"Kapitel 1, 2, 3\". " +
      "Übernimmt nie automatisch, du entscheidest bei jedem Vorschlag selbst. Am besten nutzen, wenn die Kapitel-Einteilung schon steht, nicht nach jeder kleinen Änderung."
    ));

    document.getElementById("deleteBookBtn").addEventListener("click", () => {
      showConfirm(
        `„${book.title || 'Ohne Titel'}" wirklich löschen? Die enthaltenen Geschichten bleiben erhalten, nur das Buch selbst wird entfernt.`,
        "Löschen",
        async () => {
          await BookStorage.remove(book.id);
          DriveSync.markDeleted("books", book.id);
          books = books.filter(b => b.id !== book.id);
          activeBookId = null;
          renderBookList();
          if (DriveSync.isConnected()) updateSyncChip("pending", "Änderungen vorhanden");
        }
      );
    });
  }

  function renderChapters(book) {
    const container = document.getElementById("chapterList");
    container.innerHTML = "";
    const chapters = book.chapters || [];

    if (chapters.length === 0) {
      container.innerHTML = '<div class="empty-hint" style="margin-bottom:14px;">Noch kein Kapitel angelegt.</div>';
    }

    chapters.forEach((chapter, chapterIndex) => {
      const block = document.createElement("div");
      block.className = "chapter-block";
      block.innerHTML = `
        <div class="chapter-header">
          <input type="text" class="chapter-title-input" value="${escapeAttr(chapter.title)}">
          <div class="reorder-btns">
            <button class="chapter-up" title="Kapitel nach oben" ${chapterIndex === 0 ? "disabled" : ""}>↑</button>
            <button class="chapter-down" title="Kapitel nach unten" ${chapterIndex === chapters.length - 1 ? "disabled" : ""}>↓</button>
          </div>
          <button class="btn-danger-text chapter-delete" title="Kapitel löschen">✕</button>
        </div>
        <div class="chapter-stories"></div>
        <div class="chapter-actions">
          <button class="btn btn-outline add-story-btn" style="font-size:0.82rem;padding:6px 12px;">+ Geschichte hinzufügen</button>
        </div>`;

      const titleInput = block.querySelector(".chapter-title-input");
      titleInput.addEventListener("input", () => {
        chapter.title = titleInput.value;
        scheduleBookSave(book);
      });

      block.querySelector(".chapter-up").addEventListener("click", async () => {
        if (chapterIndex === 0) return;
        [book.chapters[chapterIndex - 1], book.chapters[chapterIndex]] = [book.chapters[chapterIndex], book.chapters[chapterIndex - 1]];
        await saveBook(book);
        renderBookDetail(book);
      });
      block.querySelector(".chapter-down").addEventListener("click", async () => {
        if (chapterIndex === chapters.length - 1) return;
        [book.chapters[chapterIndex + 1], book.chapters[chapterIndex]] = [book.chapters[chapterIndex], book.chapters[chapterIndex + 1]];
        await saveBook(book);
        renderBookDetail(book);
      });
      block.querySelector(".chapter-delete").addEventListener("click", () => {
        showConfirm(
          `Kapitel „${chapter.title || 'Ohne Titel'}" wirklich löschen? Die enthaltenen Geschichten bleiben erhalten, werden aber aus diesem Kapitel entfernt.`,
          "Löschen",
          async () => {
            book.chapters = book.chapters.filter(c => c.id !== chapter.id);
            await saveBook(book);
            renderBookDetail(book);
          }
        );
      });

      const storiesWrap = block.querySelector(".chapter-stories");
      const storyIds = chapter.storyIds || [];
      if (storyIds.length === 0) {
        storiesWrap.innerHTML = '<div class="chapter-empty">Noch keine Geschichte in diesem Kapitel.</div>';
      } else {
        storyIds.forEach((storyId, idx) => {
          const story = stories.find(s => s.id === storyId);
          const row = document.createElement("div");
          row.className = "chapter-story-row";
          row.innerHTML = `
            <span class="status-dot" style="background:${story ? statusColor(story.status) : '#A79E8C'}"></span>
            <span class="title">${escapeHtml(story ? (story.title || "Ohne Titel") : "(Geschichte nicht gefunden)")}</span>
            <div class="reorder-btns">
              <button class="story-up" title="Nach oben" ${idx === 0 ? "disabled" : ""}>↑</button>
              <button class="story-down" title="Nach unten" ${idx === storyIds.length - 1 ? "disabled" : ""}>↓</button>
            </div>
            <button class="remove-btn" title="Aus Kapitel entfernen">✕</button>`;

          row.querySelector(".story-up").addEventListener("click", async () => {
            if (idx === 0) return;
            [chapter.storyIds[idx - 1], chapter.storyIds[idx]] = [chapter.storyIds[idx], chapter.storyIds[idx - 1]];
            await saveBook(book);
            renderBookDetail(book);
          });
          row.querySelector(".story-down").addEventListener("click", async () => {
            if (idx === storyIds.length - 1) return;
            [chapter.storyIds[idx + 1], chapter.storyIds[idx]] = [chapter.storyIds[idx], chapter.storyIds[idx + 1]];
            await saveBook(book);
            renderBookDetail(book);
          });
          row.querySelector(".remove-btn").addEventListener("click", async () => {
            chapter.storyIds.splice(idx, 1);
            await saveBook(book);
            renderBookDetail(book);
          });

          storiesWrap.appendChild(row);
        });
      }

      block.querySelector(".add-story-btn").addEventListener("click", async () => {
        const excludeIds = allUsedStoryIds(book);
        const storyId = await pickStoryModal(excludeIds);
        if (!storyId) return;
        chapter.storyIds = chapter.storyIds || [];
        chapter.storyIds.push(storyId);
        await saveBook(book);
        renderBookDetail(book);
      });

      container.appendChild(block);
    });
  }

  // ---------- Buch-Assistent: Kapitel-Titel-Vorschläge ----------
  async function runChapterTitleSuggestions(book) {
    const panel = document.getElementById("chapterAssistantPanel");
    if (!panel) return;
    if (!AIProvider.isConfigured()) {
      switchView("settings");
      showAlert("Bitte zuerst unter Einstellungen die KI-Vorschläge einrichten - die Kapitel-Titel-Vorschläge nutzen dieselbe Anbindung.");
      return;
    }

    const chaptersData = (book.chapters || [])
      .filter(ch => (ch.storyIds || []).length > 0)
      .map(ch => ({
        chapterId: ch.id,
        currentTitle: ch.title || "",
        stories: ch.storyIds.map(id => {
          const story = stories.find(s => s.id === id);
          return story ? { title: story.title || "Ohne Titel", snippet: plainSnippet(story.content, 160) } : null;
        }).filter(Boolean)
      }));

    if (chaptersData.length === 0) {
      panel.innerHTML = '<div class="ai-panel-status">Noch keine Kapitel mit Geschichten vorhanden.</div>';
      return;
    }

    panel.innerHTML = '<div class="ai-panel-status">✨ Wird geprüft …</div>';
    try {
      const suggestions = await AIProvider.suggestChapterTitles(chaptersData);
      renderChapterTitleSuggestions(panel, book, suggestions);
    } catch (err) {
      console.error("Kapitel-Titel-Fehler", err);
      const msg = err && err.message === "NOT_CONFIGURED"
        ? "Bitte zuerst unter Einstellungen die KI-Vorschläge einrichten."
        : "Prüfung fehlgeschlagen: " + (err && err.message ? err.message : String(err));
      panel.innerHTML = `<div class="ai-panel-status ai-panel-error">${escapeHtml(msg)}</div>`;
    }
  }

  function renderChapterTitleSuggestions(panel, book, suggestions) {
    if (suggestions.length === 0) {
      panel.innerHTML = '<div class="ai-panel-status">✓ Die aktuellen Kapitel-Titel passen schon gut.</div>';
      return;
    }
    panel.innerHTML = `
      <p class="section-label" style="margin-top:8px;">✨ Kapitel-Titel-Vorschläge</p>
      <div id="chapterTitleList" class="ai-suggestion-list"></div>`;
    const list = panel.querySelector("#chapterTitleList");

    function checkEmpty() {
      if (list.children.length === 0) panel.innerHTML = '<div class="ai-panel-status">✓ Alle Vorschläge bearbeitet.</div>';
    }

    suggestions.forEach((sug) => {
      const chapter = (book.chapters || []).find(ch => ch.id === sug.chapterId);
      if (!chapter) return;
      const card = document.createElement("div");
      card.className = "ai-suggestion-card";
      card.innerHTML = `
        <div class="ai-suggestion-type">Kapitel-Titel</div>
        <div class="ai-suggestion-arrow">„${escapeHtml(chapter.title || "Ohne Titel")}" → „${escapeHtml(sug.title)}"</div>
        <div class="ai-suggestion-reason"><strong>Warum?</strong> ${escapeHtml(sug.reason)}</div>
        <div class="ai-suggestion-actions">
          <button class="btn btn-primary ai-apply-btn">Übernehmen</button>
          <button class="btn btn-ghost ai-dismiss-btn">Ablehnen</button>
        </div>`;

      card.querySelector(".ai-apply-btn").addEventListener("click", async () => {
        chapter.title = sug.title;
        await saveBook(book);
        renderChapters(book);
        card.remove();
        checkEmpty();
      });
      card.querySelector(".ai-dismiss-btn").addEventListener("click", () => {
        card.remove();
        checkEmpty();
      });

      list.appendChild(card);
    });
  }

  function renderBookPreview(book) {
    const panel = document.getElementById("booksPanel");
    const chapters = book.chapters || [];

    const chaptersHtml = chapters.map(chapter => {
      const storyIds = chapter.storyIds || [];
      const storiesHtml = storyIds.map(id => {
        const story = stories.find(s => s.id === id);
        if (!story) return "";
        return `
          <div class="preview-story">
            <h3 class="preview-story-title">${escapeHtml(story.title || "Ohne Titel")}</h3>
            <div class="preview-story-content">${story.content || ""}</div>
          </div>`;
      }).join("");
      return `
        <div class="preview-chapter">
          <h2 class="preview-chapter-title">${escapeHtml(chapter.title || "Ohne Titel")}</h2>
          ${storiesHtml || '<p class="preview-empty">Dieses Kapitel ist noch leer.</p>'}
        </div>`;
    }).join("");

    panel.innerHTML = `
      <button class="btn btn-ghost" id="backToBookDetailBtn" style="margin-bottom:16px;">← Zurück zur Bearbeitung</button>
      <div class="book-preview">
        <div class="preview-titlepage">
          ${book.cover ? `<img class="preview-cover" src="${book.cover}" alt="">` : ""}
          <h1 class="preview-title">${escapeHtml(book.title || "Ohne Titel")}</h1>
          ${book.subtitle ? `<p class="preview-subtitle">${escapeHtml(book.subtitle)}</p>` : ""}
          ${book.description ? `<p class="preview-description">${escapeHtml(book.description)}</p>` : ""}
        </div>
        ${chapters.length === 0 ? '<p class="preview-empty">Noch keine Kapitel angelegt – lege in der Bearbeitung ein Kapitel an und füge Geschichten hinzu.</p>' : chaptersHtml}
      </div>`;

    document.getElementById("backToBookDetailBtn").addEventListener("click", () => renderBookDetail(book));
  }

  function pickStoryModal(excludeIds) {
    return new Promise((resolve) => {
      const available = stories.filter(s => !excludeIds.includes(s.id));

      modalBody.innerHTML = `
        <p style="font-weight:600;margin:0 0 12px;">Geschichte zum Kapitel hinzufügen</p>
        <input type="text" id="pickerSearch" class="search-input" placeholder="Titel suchen …" autocomplete="off" style="width:100%;margin-bottom:12px;">
        <div class="story-picker-list" id="pickerList"></div>`;
      modalActions.innerHTML = "";
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "btn btn-ghost";
      cancelBtn.textContent = "Abbrechen";
      cancelBtn.addEventListener("click", () => { closeModal(); resolve(null); });
      modalActions.append(cancelBtn);

      const listEl = document.getElementById("pickerList");
      const searchEl = document.getElementById("pickerSearch");

      function renderList(query) {
        const q = (query || "").trim().toLowerCase();
        listEl.innerHTML = "";
        if (available.length === 0) {
          listEl.innerHTML = '<div class="empty-hint">Alle Geschichten sind bereits in diesem Buch enthalten.</div>';
          return;
        }
        const filtered = available
          .filter(s => !q || (s.title || "").toLowerCase().includes(q))
          .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        if (filtered.length === 0) {
          listEl.innerHTML = '<div class="empty-hint">Keine Geschichte gefunden.</div>';
          return;
        }
        filtered.forEach(s => {
          const item = document.createElement("div");
          item.className = "story-item";
          item.innerHTML = `
            <div class="title">${escapeHtml(s.title || "Ohne Titel")}</div>
            <div class="meta"><span class="status-dot" style="background:${statusColor(s.status)}"></span>${statusLabel(s.status)} · ${wordCount(s.content)} Wörter</div>`;
          item.addEventListener("click", () => { closeModal(); resolve(s.id); });
          listEl.appendChild(item);
        });
      }

      searchEl.addEventListener("input", () => renderList(searchEl.value));
      renderList("");
      modalOverlay.hidden = false;
    });
  }

  // ---------- Settings: Backup ----------
  document.getElementById("backupBtn").addEventListener("click", () => {
    const payload = {
      app: "Meine Schreibwerkstatt",
      backupVersion: 2,
      createdAt: new Date().toISOString(),
      stories: stories,
      ideas: ideas,
      books: books
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `schreibwerkstatt-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  document.getElementById("restoreBtnTrigger").addEventListener("click", () => {
    document.getElementById("restoreInput").click();
  });

  document.getElementById("restoreInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        const incomingStories = Array.isArray(data.stories) ? data.stories : [];
        const incomingIdeas = Array.isArray(data.ideas) ? data.ideas : [];
        const incomingBooks = Array.isArray(data.books) ? data.books : [];
        const total = incomingStories.length + incomingIdeas.length + incomingBooks.length;
        if (total === 0) { showAlert("In dieser Datei wurden keine Inhalte gefunden."); return; }
        showConfirm(
          `${incomingStories.length} Geschichte(n), ${incomingIdeas.length} Idee(n) und ${incomingBooks.length} Buch/Bücher aus dem Backup wiederherstellen? Neuere Versionen auf diesem Gerät bleiben erhalten.`,
          "Wiederherstellen",
          async () => {
            for (const inc of incomingStories) {
              const existing = stories.find(s => s.id === inc.id);
              if (!existing || new Date(inc.updatedAt) > new Date(existing.updatedAt)) {
                await Storage.save(inc);
              }
            }
            for (const inc of incomingIdeas) {
              const existing = ideas.find(i => i.id === inc.id);
              if (!existing) await IdeaStorage.save(inc);
            }
            for (const inc of incomingBooks) {
              const existing = books.find(b => b.id === inc.id);
              if (!existing || new Date(inc.updatedAt) > new Date(existing.updatedAt)) {
                await BookStorage.save(inc);
              }
            }
            stories = await Storage.getAll();
            ideas = await IdeaStorage.getAll();
            books = await BookStorage.getAll();
            renderStart();
            showAlert("Backup wurde wiederhergestellt.");
          }
        );
      } catch (err) {
        showAlert("Diese Datei konnte nicht gelesen werden. Ist es eine gültige Backup-Datei?");
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  // ---------- Settings: Google Drive ----------
  function renderDriveSettings() {
    const clientIdInput = document.getElementById("clientIdInput");
    const driveActions = document.getElementById("driveActions");
    const statusLine = document.getElementById("driveStatusLine");
    if (!clientIdInput) return;

    clientIdInput.value = DriveSync.getClientId();
    driveActions.innerHTML = "";

    const saveBtn = document.createElement("button");
    saveBtn.className = "btn btn-ghost";
    saveBtn.textContent = "Client-ID speichern";
    saveBtn.addEventListener("click", () => {
      DriveSync.setClientId(clientIdInput.value);
      showAlert("Client-ID gespeichert.");
      renderDriveSettings();
    });
    driveActions.appendChild(saveBtn);

    if (DriveSync.hasClientId()) {
      if (!DriveSync.isConnected()) {
        const connectBtn = document.createElement("button");
        connectBtn.className = "btn btn-primary";
        connectBtn.textContent = "☁️ Mit Google Drive verbinden";
        connectBtn.addEventListener("click", async () => {
          try {
            await DriveSync.connect();
            updateSyncChip("pending", "Verbunden · noch nicht synchronisiert");
            renderDriveSettings();
          } catch (err) {
            showAlert("Verbindung fehlgeschlagen: " + (err && err.message ? err.message : err));
          }
        });
        driveActions.appendChild(connectBtn);
      } else {
        const syncBtn = document.createElement("button");
        syncBtn.className = "btn btn-primary";
        syncBtn.textContent = "☁️ Jetzt synchronisieren";
        syncBtn.addEventListener("click", performSync);
        driveActions.appendChild(syncBtn);

        const disconnectBtn = document.createElement("button");
        disconnectBtn.className = "btn btn-ghost";
        disconnectBtn.textContent = "Verbindung trennen";
        disconnectBtn.addEventListener("click", () => {
          DriveSync.disconnect();
          updateSyncChip("default", "Nur auf diesem Gerät");
          renderDriveSettings();
        });
        driveActions.appendChild(disconnectBtn);
      }
    }

    let stateClass = "";
    let text;
    if (DriveSync.isConnected()) {
      const last = DriveSync.getLastSync();
      stateClass = "state-ok";
      text = last ? "Verbunden · Letzte Synchronisierung: " + relativeTime(last) : "Verbunden · noch nicht synchronisiert.";
    } else if (DriveSync.hasClientId()) {
      stateClass = "state-warn";
      text = "Client-ID gespeichert, aber noch nicht verbunden.";
    } else {
      text = "Noch keine Client-ID hinterlegt.";
    }
    statusLine.className = "settings-status-line " + stateClass;
    statusLine.innerHTML = `<span class="dot"></span><span>${escapeHtml(text)}</span>`;
  }

  // ---------- Synchronisierung ----------
  function updateSyncChip(state, label) {
    const chip = document.getElementById("syncChip");
    const chipLabel = document.getElementById("syncChipLabel");
    if (!chip) return;
    chip.className = "sync-chip" + (state ? " state-" + state : "");
    chipLabel.textContent = label;
  }

  function initSyncChip() {
    if (DriveSync.isConnected()) {
      const last = DriveSync.getLastSync();
      updateSyncChip("ok", last ? "Alles aktuell · " + relativeTime(last) : "Verbunden · Sync erforderlich");
    } else if (DriveSync.hasClientId()) {
      updateSyncChip("warn", "Sync erforderlich");
    } else {
      updateSyncChip("default", "Nur auf diesem Gerät");
    }
  }

  document.getElementById("syncChip").addEventListener("click", () => {
    if (!DriveSync.hasClientId()) {
      switchView("settings");
      showAlert("Bitte zuerst in den Einstellungen eine Google-Client-ID hinterlegen und Google Drive verbinden.");
      return;
    }
    performSync();
  });

  const SYNC_KINDS = ["stories", "ideas", "books"];

  function storageFor(kind) { return kind === "stories" ? Storage : kind === "ideas" ? IdeaStorage : BookStorage; }
  function localArrayFor(kind) { return kind === "stories" ? stories : kind === "ideas" ? ideas : books; }
  function upsertItem(kind, item) {
    if (kind === "stories") upsertLocal(item);
    else if (kind === "ideas") { const i = ideas.findIndex(x => x.id === item.id); if (i >= 0) ideas[i] = item; else ideas.push(item); }
    else { const i = books.findIndex(x => x.id === item.id); if (i >= 0) books[i] = item; else books.push(item); }
  }
  function removeItem(kind, id) {
    if (kind === "stories") removeLocal(id);
    else if (kind === "ideas") ideas = ideas.filter(x => x.id !== id);
    else books = books.filter(x => x.id !== id);
  }

  async function performSync() {
    if (!navigator.onLine) {
      showAlert("Du bist gerade offline. Sobald wieder Internet da ist, kannst du synchronisieren.");
      return;
    }
    updateSyncChip("busy", "Synchronisiere …");
    try {
      if (!DriveSync.isConnected()) {
        await DriveSync.connect();
      }
      const remoteData = await DriveSync.downloadRemote();

      const perKind = {};
      const allConflicts = [];

      for (const kind of SYNC_KINDS) {
        const plan = DriveSync.buildSyncPlan(kind, localArrayFor(kind), remoteData[kind] || []);
        const autoActions = plan.filter(a => a.type !== "conflict");
        const conflicts = plan.filter(a => a.type === "conflict").map(c => ({ ...c, entityKind: kind }));
        const resolvedIds = [];
        const clearedTombstoneIds = [];

        for (const action of autoActions) {
          if (action.type === "upload-local") {
            resolvedIds.push(action.item.id);
          } else if (action.type === "adopt-remote") {
            await storageFor(kind).save(action.item);
            upsertItem(kind, action.item);
            resolvedIds.push(action.item.id);
          } else if (action.type === "delete-local") {
            await storageFor(kind).remove(action.id);
            removeItem(kind, action.id);
            resolvedIds.push(action.id);
          } else if (action.type === "delete-remote") {
            clearedTombstoneIds.push(action.id);
            resolvedIds.push(action.id);
          } else if (action.type === "clear-tombstone") {
            clearedTombstoneIds.push(action.id);
          } else if (action.type === "align-timestamp") {
            await storageFor(kind).save(action.item);
            upsertItem(kind, action.item);
            resolvedIds.push(action.item.id);
          }
        }

        perKind[kind] = { resolvedIds, clearedTombstoneIds };
        allConflicts.push(...conflicts);
      }

      for (let i = 0; i < allConflicts.length; i++) {
        const c = allConflicts[i];
        const kind = c.entityKind;
        const bucket = perKind[kind];
        const decision = await askConflict(c, i + 1, allConflicts.length);
        if (decision === "later") continue;

        if (c.kind === "edit-edit") {
          const winner = decision === "local" ? c.local : c.remote;
          winner.updatedAt = new Date().toISOString();
          await storageFor(kind).save(winner);
          upsertItem(kind, winner);
          bucket.resolvedIds.push(c.id);
        } else if (c.kind === "edit-delete") {
          if (decision === "local") {
            bucket.resolvedIds.push(c.id);
          } else {
            await storageFor(kind).remove(c.id);
            removeItem(kind, c.id);
            bucket.resolvedIds.push(c.id);
          }
        } else if (c.kind === "delete-edit") {
          if (decision === "local") {
            bucket.resolvedIds.push(c.id);
            bucket.clearedTombstoneIds.push(c.id);
          } else {
            await storageFor(kind).save(c.remote);
            upsertItem(kind, c.remote);
            bucket.resolvedIds.push(c.id);
            bucket.clearedTombstoneIds.push(c.id);
          }
        }
      }

      await DriveSync.finishSync({
        stories: { items: stories, resolvedIds: perKind.stories.resolvedIds, clearedTombstoneIds: perKind.stories.clearedTombstoneIds },
        ideas: { items: ideas, resolvedIds: perKind.ideas.resolvedIds, clearedTombstoneIds: perKind.ideas.clearedTombstoneIds },
        books: { items: books, resolvedIds: perKind.books.resolvedIds, clearedTombstoneIds: perKind.books.clearedTombstoneIds }
      });

      renderStart();
      if (activeStoryId) renderEditor();
      if (document.getElementById("view-ideas").classList.contains("active")) renderIdeas();
      if (document.getElementById("view-books").classList.contains("active")) renderBooks();
      renderDriveSettings();
      updateSyncChip("ok", "Alles aktuell · " + relativeTime(new Date().toISOString()));
    } catch (err) {
      console.error("Sync-Fehler", err);
      if (err && err.message === "NO_CLIENT_ID") {
        updateSyncChip("warn", "Keine Client-ID hinterlegt");
        switchView("settings");
        showAlert("Bitte zuerst in den Einstellungen eine Google-Client-ID hinterlegen.");
      } else {
        updateSyncChip("error", "Synchronisierung fehlgeschlagen");
        showAlert("Synchronisierung fehlgeschlagen: " + (err && err.message ? err.message : err));
      }
    }
  }

  // ---------- In-App-Dialoge ----------
  const modalOverlay = document.getElementById("modalOverlay");
  const modalBody = document.getElementById("modalBody");
  const modalActions = document.getElementById("modalActions");

  function closeModal() { modalOverlay.hidden = true; }

  function showConfirm(message, confirmLabel, onConfirm) {
    const p = document.createElement("p");
    p.textContent = message;
    modalBody.innerHTML = "";
    modalBody.appendChild(p);
    modalActions.innerHTML = "";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-ghost";
    cancelBtn.textContent = "Abbrechen";
    cancelBtn.addEventListener("click", closeModal);
    const okBtn = document.createElement("button");
    okBtn.className = "btn btn-primary";
    okBtn.textContent = confirmLabel || "OK";
    okBtn.addEventListener("click", () => { closeModal(); onConfirm(); });
    modalActions.append(cancelBtn, okBtn);
    modalOverlay.hidden = false;
  }

  function showAlert(message) {
    const p = document.createElement("p");
    p.textContent = message;
    modalBody.innerHTML = "";
    modalBody.appendChild(p);
    modalActions.innerHTML = "";
    const okBtn = document.createElement("button");
    okBtn.className = "btn btn-primary";
    okBtn.textContent = "OK";
    okBtn.addEventListener("click", closeModal);
    modalActions.append(okBtn);
    modalOverlay.hidden = false;
  }

  function conflictItemTitle(entityKind, item) {
    if (!item) return "";
    if (entityKind === "ideas") return plainSnippet(item.text || "", 50);
    return item.title || "Ohne Titel";
  }

  function conflictTypeLabel(entityKind) {
    return entityKind === "books" ? "Das Buch" : entityKind === "ideas" ? "Die Idee" : "Die Geschichte";
  }

  function askConflict(conflict, index, total) {
    return new Promise((resolve) => {
      const { kind, local, remote, entityKind } = conflict;
      const titleText = conflictItemTitle(entityKind, local) || conflictItemTitle(entityKind, remote) || "Ohne Titel";
      let leftLabel, rightLabel, leftItem, rightItem, leftBtnLabel, rightBtnLabel;

      if (kind === "edit-edit") {
        leftLabel = "Version auf diesem Gerät"; rightLabel = "Version von einem anderen Gerät";
        leftItem = local; rightItem = remote;
        leftBtnLabel = "Diese Version behalten"; rightBtnLabel = "Andere Version übernehmen";
      } else if (kind === "edit-delete") {
        leftLabel = "Bearbeitet auf diesem Gerät"; rightLabel = "Auf einem anderen Gerät gelöscht";
        leftItem = local; rightItem = null;
        leftBtnLabel = "Meine Änderung behalten"; rightBtnLabel = "Löschung übernehmen";
      } else {
        leftLabel = "Auf diesem Gerät gelöscht"; rightLabel = "Auf einem anderen Gerät bearbeitet";
        leftItem = null; rightItem = remote;
        leftBtnLabel = "Löschung übernehmen"; rightBtnLabel = "Andere Version behalten";
      }

      function versionBox(label, item) {
        if (!item) {
          return `<div class="conflict-version"><h4>${escapeHtml(label)}</h4><div class="snippet" style="color:var(--ink-faint);">(gelöscht)</div></div>`;
        }
        if (entityKind === "books") {
          const stats = bookStats(item);
          return `<div class="conflict-version"><h4>${escapeHtml(label)}</h4><div class="snippet">${escapeHtml(item.title || "Ohne Titel")}${item.subtitle ? " – " + escapeHtml(item.subtitle) : ""}</div><div class="meta">${stats.count} Geschichte(n) · ${relativeTime(item.updatedAt)}</div></div>`;
        }
        if (entityKind === "ideas") {
          const snippet = escapeHtml(plainSnippet(item.text || "", 140)) || '<span style="color:var(--ink-faint);">(leer)</span>';
          return `<div class="conflict-version"><h4>${escapeHtml(label)}</h4><div class="snippet">${snippet}</div><div class="meta">${relativeTime(item.updatedAt || item.createdAt)}</div></div>`;
        }
        const snippet = escapeHtml(plainSnippet(item.content, 140)) || '<span style="color:var(--ink-faint);">(leer)</span>';
        return `<div class="conflict-version"><h4>${escapeHtml(label)}</h4><div class="snippet">${snippet}</div><div class="meta">${statusLabel(item.status)} · ${relativeTime(item.updatedAt)}</div></div>`;
      }

      modalBody.innerHTML = `
        <div class="conflict-progress">Konflikt ${index} von ${total}</div>
        <p class="conflict-story">${conflictTypeLabel(entityKind)} „${escapeHtml(titleText)}" wurde auf zwei Geräten unterschiedlich geändert.</p>
        <div class="conflict-versions">${versionBox(leftLabel, leftItem)}${versionBox(rightLabel, rightItem)}</div>
      `;
      modalActions.innerHTML = "";

      const laterBtn = document.createElement("button");
      laterBtn.className = "btn btn-ghost";
      laterBtn.textContent = "Später entscheiden";
      laterBtn.addEventListener("click", () => { closeModal(); resolve("later"); });

      const rightBtn = document.createElement("button");
      rightBtn.className = "btn btn-ghost";
      rightBtn.textContent = rightBtnLabel;
      rightBtn.addEventListener("click", () => { closeModal(); resolve("remote"); });

      const leftBtn = document.createElement("button");
      leftBtn.className = "btn btn-primary";
      leftBtn.textContent = leftBtnLabel;
      leftBtn.addEventListener("click", () => { closeModal(); resolve("local"); });

      modalActions.append(laterBtn, rightBtn, leftBtn);
      modalOverlay.hidden = false;
    });
  }

  modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) closeModal(); });

  // ---------- Init ----------
  async function init() {
    try {
      stories = await Storage.getAll();
      ideas = await IdeaStorage.getAll();
      books = await BookStorage.getAll();
    } catch (err) {
      stories = []; ideas = []; books = [];
      console.error("Speicher konnte nicht geladen werden", err);
    }
    renderStart();
    renderDriveSettings();
    renderAiSettings();
    initSyncChip();
  }
  init();
})();
