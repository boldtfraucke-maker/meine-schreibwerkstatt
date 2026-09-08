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
        pop.dataset.cat = f.cat;
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
  const LS_CONSISTENCY_RESULT = "sw_consistency_result"; // { checkedAt, pairs: [{type,nameA,storyIdsA,nameB,storyIdsB,done}] }

  function getEntityCache() {
    try { return JSON.parse(localStorage.getItem(LS_ENTITY_CACHE) || "{}"); }
    catch (e) { return {}; }
  }
  function setEntityCache(cache) { localStorage.setItem(LS_ENTITY_CACHE, JSON.stringify(cache)); }

  // Bleibt wie KI-Vorschläge/Aufbau & Wirkung gespeichert, statt bei jedem
  // Verlassen der Bücher-Seite zu verschwinden - jeder Punkt lässt sich
  // einzeln als erledigt markieren (Abgleich über pairKey, damit das auch
  // nach einer erneuten Prüfung erhalten bleibt).
  function getConsistencyResult() {
    try { return JSON.parse(localStorage.getItem(LS_CONSISTENCY_RESULT) || "null"); }
    catch (e) { return null; }
  }
  function setConsistencyResult(result) { localStorage.setItem(LS_CONSISTENCY_RESULT, JSON.stringify(result)); }
  function pairKey(p) { return p.type + "::" + p.nameA + "::" + p.nameB; }

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

      // Bereits als erledigt markierte Punkte bleiben es auch nach einer
      // erneuten Prüfung, solange derselbe Namens-/Orte-Vergleich wieder
      // auftaucht (Abgleich über pairKey).
      const prevDone = new Set((getConsistencyResult()?.pairs || []).filter(p => p.done).map(pairKey));
      const pairs = findSimilarNamePairs(cache).map(p => ({ ...p, done: prevDone.has(pairKey(p)) }));
      const result = { checkedAt: new Date().toISOString(), pairs };
      setConsistencyResult(result);
      renderConsistencyResults(panel, result);
    } catch (err) {
      console.error("Konsistenzprüfung-Fehler", err);
      panel.innerHTML = `<div class="ai-panel-status ai-panel-error">Prüfung fehlgeschlagen: ${escapeHtml(err && err.message ? err.message : String(err))}</div>`;
    }
  }

  // Öffnet die Geschichte im Schreiben-Bereich und springt direkt zur
  // ersten Fundstelle des Namens - sonst müsste man bei mehreren Seiten
  // pro Buch die Stelle selbst suchen. Bewusst kein Marker/Schritt-Ansicht
  // wie bei KI-Vorschläge/Aufbau & Wirkung: Die Konsistenzprüfung
  // vergleicht mehrere Geschichten auf einmal, es gibt keinen einzelnen
  // Text, neben dem ein Marker sitzen könnte - und laut Rückmeldung wird
  // diese Prüfung ohnehin nur am PC genutzt, nie am Handy.
  function jumpToStoryOccurrence(storyId, name) {
    switchView("write");
    openStory(storyId);
    const editorPage = document.getElementById("editorPage");
    if (!editorPage) return;
    const range = findExcerptRange(editorPage, name);
    if (range) scrollAndFlashRange(range);
  }

  function renderConsistencyResults(panel, result) {
    const pairs = result ? result.pairs : [];
    const open = pairs.filter(p => !p.done);
    setCountBadge(["consistencyCheckBtn"], open.length);

    if (!result) { panel.innerHTML = ""; return; }
    if (open.length === 0) {
      panel.innerHTML = pairs.length === 0
        ? '<div class="ai-panel-status">✓ Keine möglichen Unstimmigkeiten bei Namen oder Orten gefunden.</div>'
        : '<div class="ai-panel-status">✓ Alle Punkte bearbeitet.</div>';
      return;
    }

    const stale = stories.some(s => new Date(s.updatedAt) > new Date(result.checkedAt));
    panel.innerHTML = `
      <p class="section-label" style="margin-top:8px;">🔍 Mögliche Unstimmigkeiten (${open.length})</p>
      ${stale ? '<div class="ai-suggestion-note" style="margin-bottom:10px;">Seit dieser Prüfung wurden Geschichten geändert - das Ergebnis könnte nicht mehr ganz aktuell sein. Am besten einmal neu prüfen.</div>' : ""}
      <div id="consistencyList" class="ai-suggestion-list"></div>`;
    const list = panel.querySelector("#consistencyList");

    function storyLinksHtml(ids, name) {
      return ids.map(id => `<button type="button" class="link-btn consistency-jump" data-story="${escapeAttr(id)}" data-name="${escapeAttr(name)}">${escapeHtml(storyTitleById(id))}</button>`).join(", ");
    }

    open.forEach((p) => {
      const typeLabel = p.type === "ort" ? "Ort" : "Person/Tier";
      const card = document.createElement("div");
      card.className = "ai-suggestion-card";
      card.innerHTML = `
        <div class="ai-suggestion-type">${escapeHtml(typeLabel)}</div>
        <div class="ai-suggestion-arrow">„${escapeHtml(p.nameA)}" (${storyLinksHtml(p.storyIdsA, p.nameA)}) &nbsp;↔&nbsp; „${escapeHtml(p.nameB)}" (${storyLinksHtml(p.storyIdsB, p.nameB)})</div>
        <div class="ai-suggestion-reason"><strong>Warum?</strong> Die Schreibweisen sind sich sehr ähnlich - könnte dieselbe ${p.type === "ort" ? "Sache" : "Figur"} sein, nur unterschiedlich geschrieben. Falls ja, lohnt sich eine einheitliche Schreibweise. Du entscheidest, ob und wo du das anpasst.</div>
        <div class="ai-suggestion-actions">
          <button class="btn btn-ghost consistency-done-btn">✓ Erledigt</button>
        </div>`;
      card.querySelectorAll(".consistency-jump").forEach(btn => {
        btn.addEventListener("click", () => jumpToStoryOccurrence(btn.dataset.story, btn.dataset.name));
      });
      card.querySelector(".consistency-done-btn").addEventListener("click", () => {
        const stored = getConsistencyResult();
        const match = stored.pairs.find(x => pairKey(x) === pairKey(p));
        if (match) match.done = true;
        setConsistencyResult(stored);
        renderConsistencyResults(panel, stored);
      });
      list.appendChild(card);
    });
  }

  // ---------- Ideenparkplatz ----------
  const IDEA_COLORS = ["yellow", "orange", "violet", "blue", "green"];

  // Fest eingepflegte Kategorie-Vorschläge als Schnellauswahl - klickt man
  // eine an, wird nur Titel und Farbe im bestehenden Formular vorausgefüllt
  // (keine eigene Datenstruktur nötig). Wer eine andere/weitere Kategorie
  // möchte, tippt einfach einen eigenen Titel und wählt eine Farbe - das
  // bleibt weiterhin frei möglich, die Vorschläge sind nur eine Abkürzung.
  const IDEA_CATEGORY_PRESETS = [
    { label: "Blitzgedanke", icon: "💡", color: "yellow" },
    { label: "Cooler Satz", icon: "💬", color: "orange" },
    { label: "Bildsprache", icon: "🖼️", color: "blue" },
    { label: "Metaphern", icon: "🌉", color: "violet" },
    { label: "Emotionen & Bewegung", icon: "💓", color: "green" }
  ];

  function ideaCategoryPickerHtml() {
    return `<div class="idea-category-picker">${IDEA_CATEGORY_PRESETS.map((p, i) => `
      <button type="button" class="idea-category-chip" data-preset="${i}">
        <span class="swatch" style="background:var(--idea-${p.color})"></span>${p.icon} ${escapeHtml(p.label)}
      </button>`).join("")}</div>`;
  }

  // Wendet einen Kategorie-Vorschlag auf Titel-Feld + Farbauswahl an. Da
  // buildColorPicker() bei jedem Aufruf eine neue Instanz erzeugt (das
  // Container-innerHTML wird neu aufgebaut), meldet setColorPicker die neue
  // Instanz an den Aufrufer zurück (newIdeaColorPicker bzw. die lokale
  // Variable im Bearbeiten-Formular).
  function wireCategoryPresets(container, titleInput, colorContainer, setColorPicker) {
    container.querySelectorAll(".idea-category-chip").forEach((btn, i) => {
      btn.addEventListener("click", () => {
        const preset = IDEA_CATEGORY_PRESETS[i];
        titleInput.value = `${preset.icon} ${preset.label}`;
        setColorPicker(buildColorPicker(colorContainer, preset.color, () => {}));
      });
    });
  }

  // Baut eine Reihe farbiger Kreise zur Auswahl einer Karten-Farbe - "keine"
  // (grauer Rand, erste Option) ist immer möglich. onChange(color) wird bei
  // jedem Klick aufgerufen ("" für "keine"); .value liest den aktuellen Stand.
  function buildColorPicker(container, initial, onChange) {
    let current = initial || "";
    function render() {
      container.innerHTML = ["", ...IDEA_COLORS].map(c => `
        <button type="button" class="idea-color-swatch${c === current ? " selected" : ""}" data-color="${c}"
          style="${c ? `background:var(--idea-${c})` : ""}" title="${c ? "" : "Keine Farbe"}"></button>`).join("");
      container.querySelectorAll(".idea-color-swatch").forEach(btn => {
        btn.addEventListener("click", () => {
          current = btn.dataset.color;
          render();
          onChange(current);
        });
      });
    }
    render();
    return { get value() { return current; } };
  }

  let newIdeaColorPicker = buildColorPicker(document.getElementById("ideaColorPicker"), "", () => {});
  document.getElementById("ideaCategoryPicker").innerHTML = ideaCategoryPickerHtml();
  wireCategoryPresets(
    document.getElementById("ideaCategoryPicker"),
    document.getElementById("ideaTitleInput"),
    document.getElementById("ideaColorPicker"),
    (picker) => { newIdeaColorPicker = picker; }
  );

  // Diktier-Button neben einem Ideen-Textfeld: nutzt die im Browser
  // eingebaute Spracherkennung (Web Speech API) - keine KI-Anfrage, keine
  // Kosten. Läuft nicht in jedem Browser (v. a. nicht in Firefox) - der
  // Button verschwindet dann einfach, Tippen geht immer weiter. Der
  // erkannte Text bleibt danach ganz normal bearbeitbar, bevor man
  // speichert - genau wie manuell eingetippter Text.
  function attachDictation(button, textarea) {
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) { button.hidden = true; return; }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "de-DE";
    recognition.continuous = true;
    recognition.interimResults = true;

    let listening = false;
    let baseText = "";
    let finalText = "";

    function stopUi() {
      listening = false;
      button.classList.remove("recording");
      button.textContent = "🎤";
      button.title = "Diktieren";
    }

    recognition.addEventListener("result", (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += transcript;
        else interim += transcript;
      }
      textarea.value = [baseText, finalText, interim].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    });
    recognition.addEventListener("end", stopUi);
    recognition.addEventListener("error", (event) => {
      stopUi();
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        showAlert("Der Zugriff aufs Mikrofon wurde nicht erlaubt. Bitte in den Browser-/Website-Einstellungen freigeben, falls du diktieren möchtest.");
      }
    });

    button.addEventListener("click", () => {
      if (listening) { recognition.stop(); return; }
      baseText = textarea.value.trim();
      finalText = "";
      listening = true;
      button.classList.add("recording");
      button.textContent = "⏹";
      button.title = "Aufnahme stoppen";
      try { recognition.start(); }
      catch (e) { stopUi(); }
    });
  }

  attachDictation(document.getElementById("ideaMicBtn"), document.getElementById("ideaInput"));

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
        <div class="idea-card" data-color="${idea.color || ""}">
          <div class="idea-text-wrap">
            ${idea.title ? `<div class="idea-title">${escapeHtml(idea.title)}</div>` : ""}
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
          ${ideaCategoryPickerHtml()}
          <input type="text" class="idea-title-input idea-edit-title" placeholder="Titel (optional)" value="${escapeAttr(idea.title || "")}">
          <div class="idea-textarea-wrap">
            <textarea class="idea-textarea idea-edit-textarea" rows="2">${escapeHtml(idea.text)}</textarea>
            <button type="button" class="idea-mic-btn idea-edit-mic" title="Diktieren" aria-label="Diktieren">🎤</button>
          </div>
          <div class="idea-color-picker idea-edit-color-picker"></div>
          <div style="display:flex;gap:8px;margin-top:8px;">
            <button class="btn btn-primary idea-edit-save">Speichern</button>
            <button class="btn btn-ghost idea-edit-cancel">Abbrechen</button>
          </div>`;
        const editTextarea = textWrap.querySelector(".idea-edit-textarea");
        const editTitleInput = textWrap.querySelector(".idea-edit-title");
        let editColorPicker = buildColorPicker(textWrap.querySelector(".idea-edit-color-picker"), idea.color || "", () => {});
        wireCategoryPresets(
          textWrap.querySelector(".idea-category-picker"),
          editTitleInput,
          textWrap.querySelector(".idea-edit-color-picker"),
          (picker) => { editColorPicker = picker; }
        );
        attachDictation(textWrap.querySelector(".idea-edit-mic"), editTextarea);
        editTextarea.focus();
        editTextarea.setSelectionRange(editTextarea.value.length, editTextarea.value.length);
        textWrap.querySelector(".idea-edit-save").addEventListener("click", async () => {
          const newText = editTextarea.value.trim();
          if (!newText) return;
          idea.text = newText;
          idea.title = editTitleInput.value.trim();
          idea.color = editColorPicker.value;
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
    const titleInput = document.getElementById("ideaTitleInput");
    const text = textarea.value.trim();
    if (!text) return;
    const now = new Date().toISOString();
    const idea = { id: uid(), title: titleInput.value.trim(), color: newIdeaColorPicker.value, text, createdAt: now, updatedAt: now };
    ideas.push(idea);
    await IdeaStorage.save(idea);
    textarea.value = "";
    titleInput.value = "";
    newIdeaColorPicker = buildColorPicker(document.getElementById("ideaColorPicker"), "", () => {});
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
    removePrintPageStyle();
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
    renderConsistencyResults(consistencyPanel, getConsistencyResult());

    document.getElementById("newBookBtn").addEventListener("click", async () => {
      const book = {
        id: uid(), title: "", subtitle: "", description: "", cover: "", chapters: [],
        printProvider: "", printFormat: "", author: "", imprintText: "",
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

  // ---------- Phase 6: Für den Druck (nur am PC, siehe CSS) ----------
  // Nur Formate, deren Maße wir bei den jeweiligen Anbietern direkt bestätigt
  // gefunden haben (Stand: eigene Recherche 2026) - bewusst keine geschätzten
  // oder aus anderen Quellen übernommenen Werte, weil ein falsches Maß bei
  // einer echten Druckbestellung teuer werden kann. Bei epubli und BoD sind
  // die veröffentlichten Rand-/Beschnittwerte lückenhaft (epubli: kein
  // öffentlicher Beschnitt-Wert gefunden; BoD: keine öffentlichen
  // Rand-Werte) - "bleedMm: null" markiert das, die Autorin sollte vor einer
  // echten Bestellung trotzdem einmal die eigene Vorlage des Anbieters
  // gegenchecken.
  const PRINT_PROVIDERS = {
    kdp: {
      label: "Amazon KDP",
      bleedMm: 3.2,
      formats: [
        { key: "5x8", label: "12,7 × 20,3 cm (5″ × 8″)", widthMm: 127, heightMm: 203 },
        { key: "5.25x8", label: "13,3 × 20,3 cm (5,25″ × 8″)", widthMm: 133, heightMm: 203 },
        { key: "5.5x8.5", label: "14 × 21,6 cm (5,5″ × 8,5″)", widthMm: 140, heightMm: 216 },
        { key: "6x9", label: "15,2 × 22,9 cm (6″ × 9″ – beliebtestes Format)", widthMm: 152, heightMm: 229 }
      ]
    },
    epubli: {
      label: "epubli",
      bleedMm: null,
      formats: [
        { key: "taschenbuch", label: "12,5 × 19 cm (Taschenbuch)", widthMm: 125, heightMm: 190 },
        { key: "a5", label: "14,8 × 21 cm (DIN A5)", widthMm: 148, heightMm: 210 },
        { key: "sachbuch", label: "13,5 × 20,5 cm (Sachbuch)", widthMm: 135, heightMm: 205 }
      ]
    },
    bod: {
      label: "BoD (Books on Demand)",
      bleedMm: 5,
      formats: [
        { key: "12x19", label: "12 × 19 cm (Taschenbuch)", widthMm: 120, heightMm: 190 }
      ]
    }
  };

  // ---------- Phase 7: Umschlag (Cover) für den Druck ----------
  // Rückenbreite = Seitenzahl × Papierstärke-Faktor - bei KDP offiziell
  // bestätigte Werte (unterschiedlich je Papierart, siehe README/Quellen).
  // Bei BoD/epubli gibt es keine öffentlich exakte Formel, nur eine
  // allgemeine Branchen-Faustformel als grober Schätzwert - dort immer mit
  // Hinweis, den anbietereigenen Cover-Rechner vor der Bestellung zu nutzen.
  const KDP_PAPER_TYPES = [
    { key: "white_bw", label: "Weiß (Schwarz-Weiß-Innenteil)", inPerPage: 0.002252 },
    { key: "cream_bw", label: "Cream (Schwarz-Weiß-Innenteil)", inPerPage: 0.0025 },
    { key: "color_standard", label: "Farbe Standard", inPerPage: 0.0032 },
    { key: "color_premium", label: "Farbe Premium", inPerPage: 0.002252 }
  ];
  const GENERIC_SPINE_GRAMMAGE = 90; // g/m², typischer Richtwert für Taschenbuch-Innenpapier

  function spineWidthSpec(providerKey, pages, paperTypeKey) {
    if (!pages || pages <= 0) return null;
    if (providerKey === "kdp") {
      const paper = KDP_PAPER_TYPES.find(p => p.key === paperTypeKey) || KDP_PAPER_TYPES[0];
      return { widthMm: pages * paper.inPerPage * 25.4, confirmed: true };
    }
    // Allgemeine Branchen-Faustformel: Seitenzahl/2 (= Blattzahl) × Grammatur/1000.
    const sheets = pages / 2;
    return { widthMm: sheets * GENERIC_SPINE_GRAMMAGE / 1000, confirmed: false };
  }

  // Gesamtmaß des durchgehenden Umschlags (Rückseite + Rücken + Vorderseite
  // + Beschnitt ringsum) - genau die Größe, die man in Canva als "Eigene
  // Größe" anlegen würde.
  function coverWrapSpec(book) {
    const spec = bookPrintSpec(book);
    if (!spec) return null;
    const pages = bookStats(book).pages;
    const spine = spineWidthSpec(book.printProvider, pages, book.paperType);
    if (!spine) return null;
    const bleedMm = spec.provider.bleedMm != null ? spec.provider.bleedMm : 3; // Fallback nur falls Anbieter-Beschnitt unbestätigt
    const bleedConfirmed = spec.provider.bleedMm != null;
    const widthMm = spec.format.widthMm * 2 + spine.widthMm + bleedMm * 2;
    const heightMm = spec.format.heightMm + bleedMm * 2;
    const dpi = 300;
    const mmToPx = (mm) => Math.round((mm / 25.4) * dpi);
    return {
      spineWidthMm: spine.widthMm,
      spineConfirmed: spine.confirmed,
      bleedMm, bleedConfirmed,
      widthMm, heightMm,
      widthPx: mmToPx(widthMm), heightPx: mmToPx(heightMm),
      formatWidthMm: spec.format.widthMm,
      pages, dpi
    };
  }

  // Zeigt die fertig berechnete Umschlag-Größe (für Canva "Eigene Größe")
  // an - reagiert auf Änderungen bei Anbieter/Format/Papierart, deshalb als
  // eigene, wiederholt aufrufbare Funktion statt Teil des einmaligen
  // renderBookDetail-Aufbaus.
  function renderCoverWrapPanel(book) {
    const panel = document.getElementById("coverWrapPanel");
    if (!panel) return;
    const wrap = coverWrapSpec(book);
    if (!wrap) {
      panel.innerHTML = book.printProvider && book.printFormat
        ? '<p class="print-format-note" style="text-align:left;margin:0;">Für den Umschlag wird mindestens 1 Geschichte im Buch benötigt (für die Seitenzahl-Schätzung).</p>'
        : '<p class="print-format-note" style="text-align:left;margin:0;">Anbieter und Format oben wählen, um die Umschlag-Größe zu berechnen.</p>';
      return;
    }
    const providerLabel = PRINT_PROVIDERS[book.printProvider].label;
    const paperSelectHtml = book.printProvider === "kdp"
      ? `<div class="print-settings-row" style="margin-bottom:10px;">
          <div class="settings-field">
            <label for="coverPaperSelect">Papierart (für Rückenbreite)</label>
            <select id="coverPaperSelect">
              ${KDP_PAPER_TYPES.map(p => `<option value="${p.key}" ${p.key === (book.paperType || KDP_PAPER_TYPES[0].key) ? "selected" : ""}>${escapeHtml(p.label)}</option>`).join("")}
            </select>
          </div>
        </div>`
      : "";
    const spineNote = wrap.spineConfirmed
      ? ""
      : ` – Formel nicht offiziell bestätigt, bitte im Cover-Rechner von ${escapeHtml(providerLabel)} gegenchecken.`;
    const bleedNote = wrap.bleedConfirmed ? "" : " (Beschnitt nicht offiziell bestätigt, sicherer Richtwert)";
    const spineTextNote = (book.printProvider === "kdp" && wrap.pages < 100)
      ? '<div class="ai-suggestion-note">Bei so wenigen Seiten druckt Amazon evtl. keinen Text auf den schmalen Rücken (KDP verlangt dafür meist mindestens ca. 100 Seiten).</div>'
      : "";
    const isbnNote = book.printProvider === "kdp"
      ? "eine Fläche von 5,1 × 3,1 cm unten rechts auf der Rückseite hell und frei von wichtigen Inhalten lassen (druckt Amazon automatisch den Barcode hinein) - unten in der Vorschau markiert."
      : "unten rechts auf der Rückseite eine helle, unwichtige Fläche freihalten (Größe je nach Anbieter unterschiedlich - siehe deren Cover-Vorlage).";
    // Canva hat für "Eigene Größe" getrennte Felder für Breite und Höhe -
    // ein gemeinsamer "1234 x 5678 px"-Text lässt sich dort nirgends
    // sinnvoll einfügen. Deshalb zwei eigene Kopieren-Knöpfe, jeder mit nur
    // der reinen Zahl (ohne Einheit), passend zum jeweiligen Eingabefeld.
    //
    // Statt zu verlangen, dass das hochgeladene Bild pixelgenau stimmt,
    // füllt die App es per object-fit:cover randlos in die Umschlagfläche
    // ein (wie z. B. bei Instagram) - überschüssiges wird automatisch
    // weggeschnitten, kein Verzerren, keine Lücken/"Blitzer". Die Autorin
    // muss dafür in Canva nicht pixelgenau arbeiten, nur ungefähr in der
    // richtigen Größe/Seitenverhältnis gestalten. Die Vorschau markiert
    // zusätzlich, wo der schmale Buchrücken liegt, damit nichts Wichtiges
    // (z. B. ein Gesicht) genau dort landet.
    const spineLeftPercent = (wrap.bleedMm + wrap.formatWidthMm) / wrap.widthMm * 100;
    const spineWidthPercent = wrap.spineWidthMm / wrap.widthMm * 100;
    // ISBN/Barcode-Fläche (Phase 7, Stufe 4) - nur bei KDP mit offiziell
    // bestätigter Größe (5,1 × 3,1 cm) visuell markiert; bei anderen
    // Anbietern gibt es keinen öffentlich bestätigten Wert, deshalb dort
    // bewusst kein Kästchen (nur der allgemeine Text-Hinweis oben), um keine
    // falsche Genauigkeit vorzugaukeln. Sitzt unten rechts auf der
    // Rückseite (rechter Rand = linker Rand des Buchrückens), mit
    // Bodenabstand = Beschnitt, damit die Fläche ab der Schnittkante
    // (nicht ab der Bild-Außenkante) gemessen ist.
    const ISBN_WIDTH_MM = 51;
    const ISBN_HEIGHT_MM = 31;
    const isbnBoxHtml = book.printProvider === "kdp"
      ? `<div class="cover-wrap-isbn-marker" style="width:${(ISBN_WIDTH_MM / wrap.widthMm * 100)}%;height:${(ISBN_HEIGHT_MM / wrap.heightMm * 100)}%;right:${(100 - spineLeftPercent)}%;bottom:${(wrap.bleedMm / wrap.heightMm * 100)}%;" title="ISBN/Barcode-Fläche (5,1 × 3,1 cm, KDP)">ISBN</div>`
      : "";
    // Titel/Autor auf dem Rücken setzt die App selbst (nicht Canva) - lesbar
    // und hochwertig wirkt das erst ab einer gewissen Rückenbreite. KDP
    // druckt technisch schon ab ca. 100 Seiten (siehe spineTextNote unten),
    // wirkt dabei aber noch gedrängt/unprofessionell - deshalb hier bewusst
    // eine höhere, optische Schwelle von 200 Seiten für die Vorschau.
    const canShowSpineText = book.printProvider === "kdp" ? wrap.pages >= 200 : wrap.spineWidthMm >= 8;
    // Reihenfolge Autor/in vor Titel, weil nach der Drehung der Anfang des
    // Texts unten landet - bei deutschen Taschenbüchern steht unten meist
    // der Name, darüber der Titel (siehe Vorlage/Foto der Autorin).
    const spineText = book.title ? (book.author ? `${book.author} · ${book.title}` : book.title) : "";
    const spineTextColor = book.coverWrapSpineTextColor || "#FFFFFF";
    // Läuft von unten nach oben (Kopf zum Lesen nach links neigen) - so wie
    // bei den meisten deutschen Taschenbüchern im Regal üblich, nicht von
    // oben nach unten (wirkt sonst amateurhaft). Die Breitenbegrenzung (wird
    // durch die Drehung zur sichtbaren Höhe) rechnet direkt in Prozent vom
    // eigenen (schmalen) Rücken-Streifen statt sie per JS aus der
    // gerenderten Höhe zu messen - eine DOM-Messung wäre 0, solange der
    // "Für den Druck"-Reiter gerade nicht aktiv/sichtbar ist.
    const spineTextWidthPercent = Math.min(3000, (wrap.heightMm / wrap.spineWidthMm) * 90);
    const spineTextHtml = (canShowSpineText && spineText)
      ? `<div class="cover-wrap-spine-text" style="color:${escapeAttr(spineTextColor)};width:${spineTextWidthPercent}%;">${escapeHtml(spineText)}</div>`
      : "";
    const spineColorPickerHtml = (canShowSpineText && spineText)
      ? `<div class="settings-field" style="max-width:260px;margin-top:10px;">
          <label for="coverSpineTextColorHex">Textfarbe auf dem Rücken</label>
          <div style="display:flex;gap:8px;align-items:center;">
            <input type="color" id="coverSpineTextColorSwatch" value="${escapeAttr(spineTextColor)}" style="width:40px;height:36px;padding:2px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);cursor:pointer;">
            <input type="text" id="coverSpineTextColorHex" value="${escapeAttr(spineTextColor)}" placeholder="#FFFFFF" style="flex:1;">
          </div>
        </div>`
      : "";
    const previewHtml = book.coverWrapImage
      ? `<div class="cover-wrap-preview" id="coverWrapPreviewBox" style="aspect-ratio:${wrap.widthMm}/${wrap.heightMm};" title="Zum Vergrößern anklicken">
          <img src="${book.coverWrapImage}" alt="">
          <div class="cover-wrap-spine-marker" style="left:${spineLeftPercent}%;width:${spineWidthPercent}%;" title="Buchrücken">${spineTextHtml}</div>
          ${isbnBoxHtml}
          <div class="cover-wrap-zoom-hint">🔍</div>
        </div>
        <p class="ai-suggestion-note">So wird dein Bild randlos eingepasst (Vorschau, zum Vergrößern anklicken) - der markierte, schmale Streifen ist der Buchrücken, dort später möglichst nichts Wichtiges wie Gesichter platzieren.${canShowSpineText && spineText ? " Titel/Autor setzt die App automatisch dort hin." : ""}${book.printProvider === "kdp" ? " Das gestrichelte Feld unten rechts ist die ISBN/Barcode-Fläche." : ""}</p>`
      : "";
    panel.innerHTML = `
      ${paperSelectHtml}
      <div class="cover-wrap-result">
        <div><strong>Rückenbreite:</strong> ${wrap.spineWidthMm.toFixed(1)} mm${spineNote}</div>
        <div style="margin-top:6px;"><strong>Gesamtgröße Umschlag</strong> (Rückseite + Rücken + Vorderseite, inkl. Beschnitt${bleedNote}):<br>
          ${wrap.widthMm.toFixed(0)} × ${wrap.heightMm.toFixed(0)} mm bei ${wrap.dpi}dpi
        </div>
        <div class="copy-value-row">
          <span>Breite: <strong>${wrap.widthPx} px</strong></span>
          <button class="btn btn-ghost copy-value-btn" type="button" data-value="${wrap.widthPx}">📋 Kopieren</button>
        </div>
        <div class="copy-value-row">
          <span>Höhe: <strong>${wrap.heightPx} px</strong></span>
          <button class="btn btn-ghost copy-value-btn" type="button" data-value="${wrap.heightPx}">📋 Kopieren</button>
        </div>
      </div>
      ${spineTextNote}
      <div class="ai-suggestion-note">Für den Barcode/ISBN ${isbnNote}</div>
      ${spineColorPickerHtml}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
        <button class="btn btn-ghost" id="coverWrapImageBtn" type="button">🖼️ ${book.coverWrapImage ? "Umschlagbild ändern" : "Umschlagbild hochladen"}</button>
        <input type="file" id="coverWrapImageInput" accept="image/*" style="display:none;">
        ${book.coverWrapImage ? '<button class="btn btn-ghost" id="coverWrapImageRemoveBtn" type="button">Bild entfernen</button>' : ""}
        ${book.coverWrapImage ? '<button class="btn btn-primary" id="coverWrapDownloadBtn" type="button">⬇️ Umschlag herunterladen</button>' : ""}
      </div>
      ${book.coverWrapImage ? '<p class="ai-suggestion-note">Lädt Hintergrundbild + Rücken-Text als eine fertige Bilddatei in der berechneten Zielgröße herunter (ohne die Buchrücken-/ISBN-Markierungen - die sind nur zur Orientierung in der Vorschau).</p>' : ""}
      ${previewHtml}`;

    document.getElementById("coverSpineTextColorSwatch")?.addEventListener("input", (e) => {
      document.getElementById("coverSpineTextColorHex").value = e.target.value;
      book.coverWrapSpineTextColor = e.target.value;
      scheduleBookSave(book);
      renderCoverWrapPanel(book);
    });
    document.getElementById("coverSpineTextColorHex")?.addEventListener("change", (e) => {
      let value = e.target.value.trim();
      if (value && !value.startsWith("#")) value = "#" + value;
      if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
        book.coverWrapSpineTextColor = value;
        scheduleBookSave(book);
        renderCoverWrapPanel(book);
      } else {
        e.target.value = book.coverWrapSpineTextColor || "#FFFFFF";
      }
    });

    document.getElementById("coverPaperSelect")?.addEventListener("change", (e) => {
      book.paperType = e.target.value;
      scheduleBookSave(book);
      renderCoverWrapPanel(book);
    });
    panel.querySelectorAll(".copy-value-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(btn.dataset.value);
          const original = btn.textContent;
          btn.textContent = "✓ Kopiert";
          setTimeout(() => { btn.textContent = original; }, 1500);
        } catch (e) { /* Zwischenablage evtl. ohne Berechtigung - Wert steht ja trotzdem da */ }
      });
    });
    document.getElementById("coverWrapImageBtn").addEventListener("click", () => document.getElementById("coverWrapImageInput").click());
    document.getElementById("coverWrapImageInput").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        book.coverWrapImage = reader.result;
        await saveBook(book);
        renderCoverWrapPanel(book);
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    });
    document.getElementById("coverWrapImageRemoveBtn")?.addEventListener("click", async () => {
      delete book.coverWrapImage;
      await saveBook(book);
      renderCoverWrapPanel(book);
    });
    document.getElementById("coverWrapPreviewBox")?.addEventListener("click", () => {
      const clone = document.getElementById("coverWrapPreviewBox").cloneNode(true);
      clone.removeAttribute("id");
      clone.classList.add("lightbox-cover-preview");
      clone.querySelector(".cover-wrap-zoom-hint")?.remove();
      showLightboxHtml(clone.outerHTML);
    });
    document.getElementById("coverWrapDownloadBtn")?.addEventListener("click", (e) => downloadCoverWrap(book, e.target));
  }

  // Setzt Hintergrundbild (randlos zugeschnitten, wie in der Vorschau) und
  // - falls vorhanden - den Rücken-Text zu einer fertigen Bilddatei in der
  // berechneten Zielgröße zusammen. Bewusst OHNE die Buchrücken-/ISBN-
  // Markierungen aus der Vorschau, die sind nur zur Orientierung gedacht
  // und sollen nicht mitgedruckt werden.
  async function downloadCoverWrap(book, triggerBtn) {
    const wrap = coverWrapSpec(book);
    if (!wrap || !book.coverWrapImage) return;
    const originalLabel = triggerBtn ? triggerBtn.textContent : "";
    if (triggerBtn) { triggerBtn.disabled = true; triggerBtn.textContent = "Wird erstellt …"; }
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = book.coverWrapImage;
      });
      await (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve());

      const canvas = document.createElement("canvas");
      canvas.width = wrap.widthPx;
      canvas.height = wrap.heightPx;
      const ctx = canvas.getContext("2d");

      // object-fit:cover von Hand nachgebaut - randlos einpassen, egal
      // welches Seitenverhältnis das hochgeladene Bild hat.
      const canvasRatio = canvas.width / canvas.height;
      const imgRatio = img.width / img.height;
      let sx, sy, sw, sh;
      if (imgRatio > canvasRatio) {
        sh = img.height; sw = sh * canvasRatio; sx = (img.width - sw) / 2; sy = 0;
      } else {
        sw = img.width; sh = sw / canvasRatio; sx = 0; sy = (img.height - sh) / 2;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

      const canShowSpineText = book.printProvider === "kdp" ? wrap.pages >= 200 : wrap.spineWidthMm >= 8;
      const spineText = book.title ? (book.author ? `${book.author} · ${book.title}` : book.title) : "";
      if (canShowSpineText && spineText) {
        const spineLeftPx = (wrap.bleedMm + wrap.formatWidthMm) / wrap.widthMm * canvas.width;
        const spineWidthPx = wrap.spineWidthMm / wrap.widthMm * canvas.width;
        const centerX = spineLeftPx + spineWidthPx / 2;
        const centerY = canvas.height / 2;
        const fontSizePx = Math.max(24, Math.round(canvas.height * 0.022));
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = book.coverWrapSpineTextColor || "#FFFFFF";
        ctx.font = `600 ${fontSizePx}px Georgia, 'Times New Roman', serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0,0,0,0.6)";
        ctx.shadowBlur = fontSizePx * 0.3;
        let text = spineText;
        const maxTextWidth = canvas.height * 0.92;
        while (text.length > 1 && ctx.measureText(text).width > maxTextWidth) {
          text = text.slice(0, -1);
        }
        if (text !== spineText) text = text.replace(/\s+$/, "") + "…";
        ctx.fillText(text, 0, 0);
        ctx.restore();
      }

      const dataUrl = canvas.toDataURL("image/png");
      const safeTitle = (book.title || "Umschlag").replace(/[\\/:*?"<>|]+/g, "").trim() || "Umschlag";
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${safeTitle}-Umschlag.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      if (triggerBtn) { triggerBtn.disabled = false; triggerBtn.textContent = originalLabel; }
    }
  }

  function populatePrintFormatSelect(providerKey, selectedFormatKey) {
    const formatSelect = document.getElementById("printFormatSelect");
    const provider = PRINT_PROVIDERS[providerKey];
    if (!provider) {
      formatSelect.innerHTML = '<option value="">– erst Anbieter wählen –</option>';
      formatSelect.disabled = true;
      return;
    }
    formatSelect.disabled = false;
    formatSelect.innerHTML = provider.formats
      .map(f => `<option value="${escapeAttr(f.key)}" ${f.key === selectedFormatKey ? "selected" : ""}>${escapeHtml(f.label)}</option>`)
      .join("");
  }

  // Innenrand (Bundsteg) bei KDP wächst mit der Seitenzahl, damit der Text
  // nahe der Bindung nicht "verschluckt" wird - offiziell bestätigte
  // Tabelle (siehe README/Quellen).
  function kdpGutterMm(pages) {
    if (pages <= 150) return 9.6;
    if (pages <= 300) return 12.7;
    if (pages <= 500) return 15.9;
    if (pages <= 700) return 19.1;
    return 22.3;
  }

  // Rand-Werte fürs Druck-Layout. KDP: offiziell bestätigte, seitenzahl-
  // abhängige Werte. epubli: veröffentlichte Empfehlungswerte (fix, ohne
  // Seitenzahl-Staffelung). BoD veröffentlicht keine Randwerte öffentlich -
  // "confirmed:false" markiert das, die Vorschau zeigt dazu einen Hinweis.
  function printMarginsFor(providerKey, estimatedPages) {
    if (providerKey === "kdp") {
      return { top: 6.4, bottom: 6.4, outer: 6.4, inner: kdpGutterMm(estimatedPages), confirmed: true };
    }
    if (providerKey === "epubli") {
      return { top: 13, bottom: 20, outer: 17, inner: 15, confirmed: true };
    }
    return { top: 15, bottom: 15, outer: 15, inner: 20, confirmed: false };
  }

  // Seitengröße nutzt bewusst das reine Trimm-Maß (ohne Beschnittzugabe) -
  // Beschnitt ist nur relevant, wenn Bilder bis an den Seitenrand reichen
  // sollen, was beim aktuellen reinen Text-/Einzelbild-Layout nicht der
  // Fall ist.
  function bookPrintSpec(book) {
    const provider = PRINT_PROVIDERS[book.printProvider];
    if (!provider) return null;
    const format = provider.formats.find(f => f.key === book.printFormat);
    if (!format) return null;
    const margins = printMarginsFor(book.printProvider, bookStats(book).pages);
    return { provider, format, margins };
  }

  function removePrintPageStyle() {
    const el = document.getElementById("bookPrintPageStyle");
    if (el) el.remove();
  }

  // Cover bleibt bewusst außerhalb der Innentext-Datei (siehe oben) - beim
  // Anbieter wird es als eigene Bilddatei hochgeladen. Lädt das Cover in
  // seiner tatsächlich hochgeladenen Auflösung/Format herunter (kein
  // erneutes Umkodieren, kein Qualitätsverlust).
  function downloadCover(book) {
    if (!book.cover) return;
    const match = /^data:image\/(\w+);/.exec(book.cover);
    const ext = match ? (match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase()) : "png";
    const safeTitle = (book.title || "Cover").replace(/[\\/:*?"<>|]+/g, "").trim() || "Cover";
    const a = document.createElement("a");
    a.href = book.cover;
    a.download = `${safeTitle}-Cover.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function renderBookDetail(book) {
    removePrintPageStyle();
    const panel = document.getElementById("booksPanel");
    const stats = bookStats(book);
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px;">
        <button class="btn btn-ghost" id="backToBooksBtn">← Alle Bücher</button>
        <button class="btn btn-primary" id="previewBookBtn">📖 Vorschau ansehen</button>
      </div>

      <div class="book-detail-tabs pc-only-flex">
        <button type="button" class="book-detail-tab active" id="tabInhaltBtn">📝 Inhalt</button>
        <button type="button" class="book-detail-tab" id="tabDruckBtn">🖨️ Für den Druck</button>
      </div>

      <div id="bookTabInhalt">
        <div class="book-detail-top">
          <div class="book-cover-col">
            ${book.cover ? `<img class="cover-thumb" src="${book.cover}" alt="">` : `<div class="cover-placeholder">📖</div>`}
            <button class="btn btn-ghost" id="coverBtn" style="width:100%;">Cover ${book.cover ? "ändern" : "hinzufügen"}</button>
            <input type="file" id="coverInput" accept="image/*" style="display:none;">
            ${book.cover ? `<div class="pc-only-block"><button class="btn btn-ghost" id="coverDownloadBtn" style="width:100%;margin-top:8px;">⬇️ Cover herunterladen</button></div>` : ""}
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
        </div>
      </div>

      <div class="book-print-settings tab-panel-hidden" id="bookPrintSettings">
        <div class="print-settings-row">
          <div class="settings-field">
            <label for="printProviderSelect">Anbieter</label>
            <select id="printProviderSelect">
              <option value="">– wählen –</option>
              ${Object.entries(PRINT_PROVIDERS).map(([key, p]) => `<option value="${key}" ${key === book.printProvider ? "selected" : ""}>${escapeHtml(p.label)}</option>`).join("")}
            </select>
          </div>
          <div class="settings-field">
            <label for="printFormatSelect">Format</label>
            <select id="printFormatSelect"><option value="">– erst Anbieter wählen –</option></select>
          </div>
        </div>
        <div class="print-settings-row">
          <div class="settings-field">
            <label for="bookAuthorInput">Autor/in (für Titelseite, optional)</label>
            <input type="text" id="bookAuthorInput" placeholder="z. B. Helga Boldt" value="${escapeAttr(book.author || "")}">
          </div>
        </div>
        <div class="settings-field">
          <label for="bookImprintInput">Impressum-/Copyright-Seite (optional)</label>
          <textarea id="bookImprintInput" rows="2" placeholder="${escapeAttr(`Leer lassen für automatisches „© ${new Date().getFullYear()} [Autor/in]“ – oder eigenen Text eintragen.`)}">${escapeHtml(book.imprintText || "")}</textarea>
        </div>

        <p class="section-label">🎨 Umschlag (Cover) für den Druck</p>
        <div id="coverWrapPanel"></div>
      </div>`;

    document.getElementById("backToBooksBtn").addEventListener("click", () => { activeBookId = null; renderBookList(); });
    document.getElementById("previewBookBtn").addEventListener("click", () => renderBookPreview(book));

    const tabInhaltBtn = document.getElementById("tabInhaltBtn");
    const tabDruckBtn = document.getElementById("tabDruckBtn");
    const bookTabInhalt = document.getElementById("bookTabInhalt");
    const bookTabDruck = document.getElementById("bookPrintSettings");
    tabInhaltBtn.addEventListener("click", () => {
      bookTabInhalt.classList.remove("tab-panel-hidden");
      bookTabDruck.classList.add("tab-panel-hidden");
      tabInhaltBtn.classList.add("active");
      tabDruckBtn.classList.remove("active");
    });
    tabDruckBtn.addEventListener("click", () => {
      bookTabDruck.classList.remove("tab-panel-hidden");
      bookTabInhalt.classList.add("tab-panel-hidden");
      tabDruckBtn.classList.add("active");
      tabInhaltBtn.classList.remove("active");
    });

    populatePrintFormatSelect(book.printProvider, book.printFormat);
    // Selbstheilung für Bücher, die den oben behobenen Bug schon
    // gespeichert haben: Anbieter gesetzt, aber Format leer, obwohl das
    // Dropdown (Browser-Standardverhalten) trotzdem eine Option zeigt.
    if (book.printProvider && !book.printFormat) {
      const currentFormat = document.getElementById("printFormatSelect").value;
      if (currentFormat) { book.printFormat = currentFormat; scheduleBookSave(book); }
    }
    document.getElementById("printProviderSelect").addEventListener("change", (e) => {
      book.printProvider = e.target.value;
      populatePrintFormatSelect(book.printProvider, "");
      // Ein <select> ohne "selected"-Option zeigt automatisch die erste
      // Option an (Browser-Standardverhalten) - book.printFormat muss das
      // widerspiegeln, sonst zeigt das Dropdown z. B. bei BoD (nur ein
      // Format) scheinbar eine Auswahl, obwohl intern noch nichts gewählt
      // ist und die Vorschau fälschlich "kein Format gewählt" meldet.
      book.printFormat = document.getElementById("printFormatSelect").value;
      scheduleBookSave(book);
      renderCoverWrapPanel(book);
    });
    document.getElementById("printFormatSelect").addEventListener("change", (e) => {
      book.printFormat = e.target.value;
      scheduleBookSave(book);
      renderCoverWrapPanel(book);
    });
    renderCoverWrapPanel(book);

    const authorInput = document.getElementById("bookAuthorInput");
    const imprintInput = document.getElementById("bookImprintInput");
    [authorInput, imprintInput].forEach(el => {
      el.addEventListener("input", () => {
        book.author = authorInput.value;
        book.imprintText = imprintInput.value;
        scheduleBookSave(book);
      });
    });

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
    document.getElementById("coverDownloadBtn")?.addEventListener("click", () => downloadCover(book));

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
    const spec = bookPrintSpec(book);

    const chaptersHtml = chapters.map((chapter) => {
      const storyIds = chapter.storyIds || [];
      // Der Geschichtentitel erscheint hier nur, wenn ein Kapitel mehrere
      // Geschichten bündelt (dann braucht man ihn, um sie auseinander zu
      // halten) - bei genau einer Geschichte pro Kapitel reicht der
      // Kapiteltitel allein, sonst gäbe es (wie im Cover-Beispiel) dieselbe
      // Überschrift doppelt.
      const showStoryTitle = storyIds.length > 1;
      const storiesHtml = storyIds.map(id => {
        const story = stories.find(s => s.id === id);
        if (!story) return "";
        return `
          <div class="preview-story">
            ${showStoryTitle ? `<h3 class="preview-story-title">${escapeHtml(story.title || "Ohne Titel")}</h3>` : ""}
            <div class="preview-story-content">${story.content || ""}</div>
          </div>`;
      }).join("");
      // Jedes Kapitel beginnt beim Druck auf einer neuen Seite (auch das
      // erste - davor stehen ja noch die Titelseite und ggf. die
      // Impressum-Seite).
      const pageBreak = spec ? "break-before:page;" : "";
      return `
        <div class="preview-chapter" style="${pageBreak}">
          <h2 class="preview-chapter-title">${escapeHtml(chapter.title || "Ohne Titel")}</h2>
          ${storiesHtml || '<p class="preview-empty">Dieses Kapitel ist noch leer.</p>'}
        </div>`;
    }).join("");

    // Seitengröße/Ränder hängen vom gewählten Anbieter+Format ab - @page
    // unterstützt dafür keine CSS-Variablen zuverlässig, deshalb ein
    // eigenes <style>-Tag mit den konkreten Werten. @page :left/:right
    // sorgt dafür, dass der Bundsteg beim echten Druck/PDF-Export korrekt
    // zwischen linker und rechter Seite wechselt (das kann die
    // Bildschirm-Vorschau unten nicht nachbilden, da HTML sich erst beim
    // Drucken selbst in Seiten aufteilt). @bottom-center zeigt die
    // laufende Seitenzahl - auf der Titelseite bewusst nicht (wie bei
    // gedruckten Büchern üblich).
    removePrintPageStyle();
    if (spec) {
      const styleTag = document.createElement("style");
      styleTag.id = "bookPrintPageStyle";
      styleTag.textContent = `
        @media print {
          @page {
            size: ${spec.format.widthMm}mm ${spec.format.heightMm}mm;
            margin-top: ${spec.margins.top}mm;
            margin-bottom: ${spec.margins.bottom}mm;
            @bottom-center {
              content: counter(page);
              font-family: Georgia, 'Times New Roman', serif;
              font-size: 9pt;
              color: #555;
            }
          }
          @page :left { margin-left: ${spec.margins.outer}mm; margin-right: ${spec.margins.inner}mm; }
          @page :right { margin-left: ${spec.margins.inner}mm; margin-right: ${spec.margins.outer}mm; }
          @page :first { @bottom-center { content: normal; } }
        }`;
      document.head.appendChild(styleTag);
    }

    const formatNote = spec
      ? `<div class="print-format-note${spec.margins.confirmed ? "" : " unconfirmed"}">
          📐 ${escapeHtml(spec.provider.label)} · ${escapeHtml(spec.format.label)}
          ${!spec.margins.confirmed ? ` – Rand-Werte sind für ${escapeHtml(spec.provider.label)} nicht öffentlich bestätigt, hier ein sicherer Richtwert. Vor dem Bestellen bitte die eigene Vorlage von ${escapeHtml(spec.provider.label)} gegenchecken.` : ""}
          <br>Die Bildschirm-Vorschau zeigt eine vereinfachte Einzelseite - beim echten Druck/PDF-Export wechselt der Bundsteg korrekt zwischen linker und rechter Seite.
        </div>`
      : `<div class="print-format-note">Noch kein Anbieter/Format gewählt - die Vorschau zeigt eine allgemeine Ansicht ohne feste Seitengröße. Format in der Bearbeitung wählen für eine druckgenaue Vorschau.</div>`;

    const pageStyle = spec
      ? ` style="width:${spec.format.widthMm}mm;padding:${spec.margins.top}mm ${spec.margins.outer}mm ${spec.margins.bottom}mm ${spec.margins.inner}mm;"`
      : "";

    // Die Impressum-Seite gehört nur zum Druck-Layout (nicht zur
    // allgemeinen Bildschirm-Vorschau) und erscheint nur, wenn tatsächlich
    // etwas draufstehen würde - sonst gäbe es eine fast leere Seite.
    const imprintText = (book.imprintText || "").trim()
      || (book.author ? `© ${new Date().getFullYear()} ${book.author}` : "");
    const imprintHtml = (spec && imprintText)
      ? `<div class="preview-imprint" style="break-before:page;">${escapeHtml(imprintText).split("\n").map(line => `<p>${line}</p>`).join("")}</div>`
      : "";

    panel.innerHTML = `
      <div class="book-preview-toolbar">
        <button class="btn btn-ghost" id="backToBookDetailBtn">← Zurück zur Bearbeitung</button>
        ${spec ? '<button class="btn btn-primary" id="printExportBtn">🖨️ Drucken / Als PDF speichern</button>' : ""}
      </div>
      ${formatNote}
      <div class="book-preview${spec ? " print-mode" : ""}"${pageStyle}>
        <div class="preview-titlepage">
          <h1 class="preview-title">${escapeHtml(book.title || "Ohne Titel")}</h1>
          ${book.subtitle ? `<p class="preview-subtitle">${escapeHtml(book.subtitle)}</p>` : ""}
          ${book.author ? `<p class="preview-author">${escapeHtml(book.author)}</p>` : ""}
          ${book.description ? `<p class="preview-description">${escapeHtml(book.description)}</p>` : ""}
        </div>
        ${imprintHtml}
        ${chapters.length === 0 ? '<p class="preview-empty">Noch keine Kapitel angelegt – lege in der Bearbeitung ein Kapitel an und füge Geschichten hinzu.</p>' : chaptersHtml}
      </div>`;

    document.getElementById("backToBookDetailBtn").addEventListener("click", () => { removePrintPageStyle(); renderBookDetail(book); });
    document.getElementById("printExportBtn")?.addEventListener("click", () => window.print());
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
  const modalCard = document.getElementById("modalCard");
  const modalBody = document.getElementById("modalBody");
  const modalActions = document.getElementById("modalActions");

  function closeModal() { modalOverlay.hidden = true; modalCard.classList.remove("modal-card-image"); }

  // Vergrößerte Ansicht z. B. für die Umschlag-Vorschau - nutzt denselben
  // Modal-Rahmen wie Bestätigungsdialoge, aber mit eigener, breiterer
  // Kartenbreite (modal-card-image), damit das Bild groß genug wird. Nimmt
  // fertiges HTML entgegen (statt nur eine Bild-URL), damit sich z. B. die
  // Umschlag-Vorschau mitsamt Buchrücken-Markierung/-Text unverändert groß
  // anzeigen lässt.
  function showLightboxHtml(html) {
    modalCard.classList.add("modal-card-image");
    modalBody.innerHTML = html;
    modalActions.innerHTML = "";
    const okBtn = document.createElement("button");
    okBtn.className = "btn btn-ghost";
    okBtn.textContent = "Schließen";
    okBtn.addEventListener("click", closeModal);
    modalActions.append(okBtn);
    modalOverlay.hidden = false;
  }

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
