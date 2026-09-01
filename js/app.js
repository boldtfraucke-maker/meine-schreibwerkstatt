(function () {
  "use strict";

  // ---------- State ----------
  let stories = [];
  let activeStoryId = null;
  let autosaveTimer = null;

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
    const recentLabel = document.getElementById("recentLabel");
    const list = document.getElementById("recentList");
    list.innerHTML = "";

    if (sorted.length === 0) {
      continueCard.hidden = true;
      continueCard.innerHTML = "";
      recentLabel.style.display = "none";
      list.innerHTML = '<div class="empty-hint">Noch keine Geschichte begonnen. Klicke unten auf „Neue Geschichte beginnen", um loszulegen.</div>';
      return;
    }

    const latest = sorted[0];
    continueCard.hidden = false;
    continueCard.innerHTML = `
      <div>
        <div class="eyebrow">Weiterschreiben an</div>
        <div class="title">${escapeHtml(latest.title || "Ohne Titel")}</div>
        <div class="meta">${statusLabel(latest.status)} · ${relativeTime(latest.updatedAt)}</div>
      </div>
      <button class="btn btn-primary" id="continueBtn">Weiterschreiben →</button>`;
    document.getElementById("continueBtn").addEventListener("click", () => { switchView("write"); openStory(latest.id); });

    const rest = sorted.slice(1, 5);
    if (rest.length === 0) {
      recentLabel.style.display = "none";
      return;
    }
    recentLabel.style.display = "";
    rest.forEach(s => {
      const card = document.createElement("div");
      card.className = "recent-card";
      card.innerHTML = `
        <div>
          <div class="title">${escapeHtml(s.title || "Ohne Titel")}</div>
          <div class="meta">${statusLabel(s.status)} · ${relativeTime(s.updatedAt)}</div>
        </div>
        <div style="color:var(--ink-faint);">›</div>`;
      card.addEventListener("click", () => { switchView("write"); openStory(s.id); });
      list.appendChild(card);
    });
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
        <button class="tool-btn" data-cmd="bold" title="Fett"><b>F</b></button>
        <button class="tool-btn" data-cmd="italic" title="Kursiv"><i>K</i></button>
        <button class="tool-btn" data-cmd="h2" title="Überschrift">Überschrift</button>
        <button class="tool-btn" data-cmd="p" title="Absatz">Absatz</button>
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
        if (cmd === "h2") document.execCommand("formatBlock", false, "H2");
        else if (cmd === "p") document.execCommand("formatBlock", false, "P");
        else if (cmd === "image") { document.getElementById("imageInput").click(); return; }
        else document.execCommand(cmd, false, null);
        scheduleSave();
      });
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

  // ---------- Settings: Backup ----------
  document.getElementById("backupBtn").addEventListener("click", () => {
    const payload = {
      app: "Meine Schreibwerkstatt",
      backupVersion: 1,
      createdAt: new Date().toISOString(),
      stories: stories
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
        const incoming = Array.isArray(data.stories) ? data.stories : [];
        if (incoming.length === 0) { showAlert("In dieser Datei wurden keine Geschichten gefunden."); return; }
        showConfirm(
          `${incoming.length} Geschichte(n) aus dem Backup wiederherstellen? Neuere Versionen auf diesem Gerät bleiben erhalten.`,
          "Wiederherstellen",
          async () => {
            for (const inc of incoming) {
              const existing = stories.find(s => s.id === inc.id);
              if (!existing || new Date(inc.updatedAt) > new Date(existing.updatedAt)) {
                await Storage.save(inc);
              }
            }
            stories = await Storage.getAll();
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
    } catch (err) {
      stories = [];
      console.error("Speicher konnte nicht geladen werden", err);
    }
    renderStart();
    renderDriveSettings();
    initSyncChip();
  }
  init();
})();
