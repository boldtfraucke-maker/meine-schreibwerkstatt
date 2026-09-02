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

  const STATUS_OPTIONS = [
    { value: "idee", label: "Idee", color: "#A79E8C" },
    { value: "entwurf", label: "Entwurf", color: "#5D7E8F" },
    { value: "in_arbeit", label: "In Arbeit", color: "#8B5E3C" },
    { value: "ueberarbeitung", label: "Überarbeitung", color: "#C08A2E" },
    { value: "fertig", label: "Fertig", color: "#2F4B3C" },
    { value: "veroeffentlicht", label: "Veröffentlicht", color: "#5C4A9C" }
  ];

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
  function textToHtml(text) {
    return text.split(/\n+/).filter(Boolean).map(line => `<p>${escapeHtml(line)}</p>`).join("");
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
    if (view === "settings") renderDriveSettings();
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
        <select class="tool-select" id="headingSelect" title="Textformat">
          <option value="P">Normaler Text</option>
          <option value="H1">Überschrift 1</option>
          <option value="H2">Überschrift 2</option>
          <option value="H3">Überschrift 3</option>
        </select>
        <select class="tool-select" id="fontSelect" title="Schriftart">
          <option value="Inter, sans-serif">Standard</option>
          <option value="'Fraunces', serif">Serif</option>
          <option value="Georgia, serif">Klassisch</option>
          <option value="'Courier New', monospace">Schreibmaschine</option>
        </select>
        <select class="tool-select" id="fontSizeSelect" title="Schriftgröße">
          <option value="2">Klein</option>
          <option value="3" selected>Normal</option>
          <option value="5">Groß</option>
          <option value="7">Sehr groß</option>
        </select>
        <span class="toolbar-divider"></span>
        <button class="tool-btn" data-cmd="bold" title="Fett"><b>F</b></button>
        <button class="tool-btn" data-cmd="italic" title="Kursiv"><i>K</i></button>
        <button class="tool-btn" data-cmd="insertUnorderedList" title="Liste">• Liste</button>
        <button class="tool-btn" data-cmd="image" title="Bild einfügen">🖼 Bild</button>
        <input type="file" id="imageInput" accept="image/*" style="display:none;">
      </div>
      <div class="editor-page" id="editorPage" contenteditable="true">${story.content || ""}</div>
      <div class="editor-footer">
        <div class="save-status"><span class="save-dot"></span><span id="saveStatusText">Automatisch gespeichert</span></div>
        <button class="btn-danger-text" id="deleteStoryBtn">Geschichte löschen</button>
      </div>`;

    const titleInput = document.getElementById("titleInput");
    const statusSelect = document.getElementById("statusSelect");
    const editorPage = document.getElementById("editorPage");
    const saveStatusText = document.getElementById("saveStatusText");

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

    panel.querySelectorAll(".tool-btn[data-cmd]").forEach(btn => {
      btn.addEventListener("click", () => {
        editorPage.focus();
        const cmd = btn.dataset.cmd;
        if (cmd === "image") { document.getElementById("imageInput").click(); return; }
        document.execCommand(cmd, false, null);
        scheduleSave();
      });
    });

    document.getElementById("headingSelect").addEventListener("change", (e) => {
      editorPage.focus();
      document.execCommand("formatBlock", false, e.target.value);
      scheduleSave();
    });
    document.getElementById("fontSelect").addEventListener("change", (e) => {
      editorPage.focus();
      document.execCommand("fontName", false, e.target.value);
      scheduleSave();
    });
    document.getElementById("fontSizeSelect").addEventListener("change", (e) => {
      editorPage.focus();
      document.execCommand("fontSize", false, e.target.value);
      scheduleSave();
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

    document.getElementById("deleteStoryBtn").addEventListener("click", () => {
      showConfirm(
        `„${story.title || 'Ohne Titel'}" wirklich löschen? Das kann nicht rückgängig gemacht werden.`,
        "Löschen",
        async () => {
          await Storage.remove(story.id);
          DriveSync.markDeleted(story.id);
          stories = stories.filter(s => s.id !== story.id);
          activeStoryId = null;
          renderEditor();
          renderStart();
          if (DriveSync.isConnected()) updateSyncChip("pending", "Änderungen vorhanden");
        }
      );
    });

    // Neue, leere Geschichte: direkt in den Titel springen
    if (!story.title && !story.content) {
      titleInput.focus();
    }
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
      card.className = "idea-card";
      card.innerHTML = `
        <div>
          <div class="text">${escapeHtml(idea.text)}</div>
          <div class="meta">${relativeTime(idea.createdAt)}</div>
        </div>
        <div class="idea-actions">
          <button class="btn btn-ghost make-story-btn">✎ Geschichte daraus machen</button>
          <button class="btn-danger-text delete-idea-btn">Löschen</button>
        </div>`;

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
            ideas = ideas.filter(i => i.id !== idea.id);
            switchView("write");
            openStory(story.id);
          }
        );
      });

      card.querySelector(".delete-idea-btn").addEventListener("click", () => {
        showConfirm("Diese Idee wirklich löschen?", "Löschen", async () => {
          await IdeaStorage.remove(idea.id);
          ideas = ideas.filter(i => i.id !== idea.id);
          renderIdeas();
        });
      });

      list.appendChild(card);
    });
  }

  document.getElementById("ideaSaveBtn").addEventListener("click", async () => {
    const textarea = document.getElementById("ideaInput");
    const text = textarea.value.trim();
    if (!text) return;
    const idea = { id: uid(), text, createdAt: new Date().toISOString() };
    ideas.push(idea);
    await IdeaStorage.save(idea);
    textarea.value = "";
    renderIdeas();
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

  function scheduleBookSave(book) {
    clearTimeout(bookSaveTimer);
    bookSaveTimer = setTimeout(async () => {
      book.updatedAt = new Date().toISOString();
      await BookStorage.save(book);
    }, 500);
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
        <button class="btn btn-primary" id="newBookBtn">+ Neues Buch</button>
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

      <p class="section-label">Kapitel</p>
      <div id="chapterList"></div>
      <button class="btn btn-ghost" id="addChapterBtn">+ Kapitel hinzufügen</button>

      <div style="margin-top:28px;">
        <button class="btn-danger-text" id="deleteBookBtn">Buch löschen</button>
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
        book.updatedAt = new Date().toISOString();
        await BookStorage.save(book);
        renderBookDetail(book);
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    });

    renderChapters(book);

    document.getElementById("addChapterBtn").addEventListener("click", async () => {
      book.chapters = book.chapters || [];
      book.chapters.push({ id: uid(), title: "Kapitel " + (book.chapters.length + 1), storyIds: [] });
      book.updatedAt = new Date().toISOString();
      await BookStorage.save(book);
      renderBookDetail(book);
    });

    document.getElementById("deleteBookBtn").addEventListener("click", () => {
      showConfirm(
        `„${book.title || 'Ohne Titel'}" wirklich löschen? Die enthaltenen Geschichten bleiben erhalten, nur das Buch selbst wird entfernt.`,
        "Löschen",
        async () => {
          await BookStorage.remove(book.id);
          books = books.filter(b => b.id !== book.id);
          activeBookId = null;
          renderBookList();
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
          <button class="btn btn-ghost add-story-btn" style="font-size:0.82rem;padding:6px 12px;">+ Geschichte hinzufügen</button>
        </div>`;

      const titleInput = block.querySelector(".chapter-title-input");
      titleInput.addEventListener("input", () => {
        chapter.title = titleInput.value;
        scheduleBookSave(book);
      });

      block.querySelector(".chapter-up").addEventListener("click", async () => {
        if (chapterIndex === 0) return;
        [book.chapters[chapterIndex - 1], book.chapters[chapterIndex]] = [book.chapters[chapterIndex], book.chapters[chapterIndex - 1]];
        book.updatedAt = new Date().toISOString();
        await BookStorage.save(book);
        renderBookDetail(book);
      });
      block.querySelector(".chapter-down").addEventListener("click", async () => {
        if (chapterIndex === chapters.length - 1) return;
        [book.chapters[chapterIndex + 1], book.chapters[chapterIndex]] = [book.chapters[chapterIndex], book.chapters[chapterIndex + 1]];
        book.updatedAt = new Date().toISOString();
        await BookStorage.save(book);
        renderBookDetail(book);
      });
      block.querySelector(".chapter-delete").addEventListener("click", () => {
        showConfirm(
          `Kapitel „${chapter.title || 'Ohne Titel'}" wirklich löschen? Die enthaltenen Geschichten bleiben erhalten, werden aber aus diesem Kapitel entfernt.`,
          "Löschen",
          async () => {
            book.chapters = book.chapters.filter(c => c.id !== chapter.id);
            book.updatedAt = new Date().toISOString();
            await BookStorage.save(book);
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
            book.updatedAt = new Date().toISOString();
            await BookStorage.save(book);
            renderBookDetail(book);
          });
          row.querySelector(".story-down").addEventListener("click", async () => {
            if (idx === storyIds.length - 1) return;
            [chapter.storyIds[idx + 1], chapter.storyIds[idx]] = [chapter.storyIds[idx], chapter.storyIds[idx + 1]];
            book.updatedAt = new Date().toISOString();
            await BookStorage.save(book);
            renderBookDetail(book);
          });
          row.querySelector(".remove-btn").addEventListener("click", async () => {
            chapter.storyIds.splice(idx, 1);
            book.updatedAt = new Date().toISOString();
            await BookStorage.save(book);
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
        book.updatedAt = new Date().toISOString();
        await BookStorage.save(book);
        renderBookDetail(book);
      });

      container.appendChild(block);
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
      const plan = DriveSync.buildSyncPlan(stories, remoteData.stories || []);

      const conflicts = plan.filter(a => a.type === "conflict");
      const autoActions = plan.filter(a => a.type !== "conflict");
      const resolvedIds = [];
      const clearedTombstoneIds = [];

      for (const action of autoActions) {
        if (action.type === "upload-local") {
          resolvedIds.push(action.story.id);
        } else if (action.type === "adopt-remote") {
          await Storage.save(action.story);
          upsertLocal(action.story);
          resolvedIds.push(action.story.id);
        } else if (action.type === "delete-local") {
          await Storage.remove(action.id);
          removeLocal(action.id);
          resolvedIds.push(action.id);
        } else if (action.type === "delete-remote") {
          clearedTombstoneIds.push(action.id);
          resolvedIds.push(action.id);
        } else if (action.type === "clear-tombstone") {
          clearedTombstoneIds.push(action.id);
        } else if (action.type === "align-timestamp") {
          await Storage.save(action.story);
          upsertLocal(action.story);
          resolvedIds.push(action.story.id);
        }
      }

      for (let i = 0; i < conflicts.length; i++) {
        const c = conflicts[i];
        const decision = await askConflict(c, i + 1, conflicts.length);
        if (decision === "later") continue;

        if (c.kind === "edit-edit") {
          const winner = decision === "local" ? c.local : c.remote;
          winner.updatedAt = new Date().toISOString();
          await Storage.save(winner);
          upsertLocal(winner);
          resolvedIds.push(c.id);
        } else if (c.kind === "edit-delete") {
          if (decision === "local") {
            resolvedIds.push(c.id);
          } else {
            await Storage.remove(c.id);
            removeLocal(c.id);
            resolvedIds.push(c.id);
          }
        } else if (c.kind === "delete-edit") {
          if (decision === "local") {
            resolvedIds.push(c.id);
            clearedTombstoneIds.push(c.id);
          } else {
            await Storage.save(c.remote);
            upsertLocal(c.remote);
            resolvedIds.push(c.id);
            clearedTombstoneIds.push(c.id);
          }
        }
      }

      await DriveSync.finishSync(stories, resolvedIds, clearedTombstoneIds);

      renderStart();
      if (activeStoryId) renderEditor();
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

  function askConflict(conflict, index, total) {
    return new Promise((resolve) => {
      const { kind, local, remote } = conflict;
      const titleText = (local && local.title) || (remote && remote.title) || "Ohne Titel";
      let leftLabel, rightLabel, leftStory, rightStory, leftBtnLabel, rightBtnLabel;

      if (kind === "edit-edit") {
        leftLabel = "Version auf diesem Gerät"; rightLabel = "Version von einem anderen Gerät";
        leftStory = local; rightStory = remote;
        leftBtnLabel = "Diese Version behalten"; rightBtnLabel = "Andere Version übernehmen";
      } else if (kind === "edit-delete") {
        leftLabel = "Bearbeitet auf diesem Gerät"; rightLabel = "Auf einem anderen Gerät gelöscht";
        leftStory = local; rightStory = null;
        leftBtnLabel = "Meine Änderung behalten"; rightBtnLabel = "Löschung übernehmen";
      } else {
        leftLabel = "Auf diesem Gerät gelöscht"; rightLabel = "Auf einem anderen Gerät bearbeitet";
        leftStory = null; rightStory = remote;
        leftBtnLabel = "Löschung übernehmen"; rightBtnLabel = "Andere Version behalten";
      }

      function versionBox(label, story) {
        if (!story) {
          return `<div class="conflict-version"><h4>${escapeHtml(label)}</h4><div class="snippet" style="color:var(--ink-faint);">(gelöscht)</div></div>`;
        }
        const snippet = escapeHtml(plainSnippet(story.content, 140)) || '<span style="color:var(--ink-faint);">(leer)</span>';
        return `<div class="conflict-version"><h4>${escapeHtml(label)}</h4><div class="snippet">${snippet}</div><div class="meta">${statusLabel(story.status)} · ${relativeTime(story.updatedAt)}</div></div>`;
      }

      modalBody.innerHTML = `
        <div class="conflict-progress">Konflikt ${index} von ${total}</div>
        <p class="conflict-story">„${escapeHtml(titleText)}" wurde auf zwei Geräten unterschiedlich geändert.</p>
        <div class="conflict-versions">${versionBox(leftLabel, leftStory)}${versionBox(rightLabel, rightStory)}</div>
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
    initSyncChip();
  }
  init();
})();
