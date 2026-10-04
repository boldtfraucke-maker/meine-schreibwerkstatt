// Google-Drive-Synchronisation.
//
// Geschichten, Ideen und Bücher werden zusammen als eine JSON-Datei im
// privaten "App-Ordner" der Nutzerin auf Google Drive abgelegt (Scope
// drive.appdata). Diesen Ordner sieht die Nutzerin nicht in ihrem normalen
// Drive – sie muss also nie Dateien oder Ordner selbst verwalten.
//
// Diese Datei kennt nichts von der Benutzeroberfläche. app.js ruft für
// jede der drei Sammlungen DriveSync.buildSyncPlan(kind, ...) auf, wendet
// automatische Aktionen an, fragt bei Konflikten die Nutzerin und ruft
// danach einmalig DriveSync.finishSync(...) mit den Ergebnissen aller drei
// Sammlungen auf.
const DriveSync = (function () {
  "use strict";

  const SYNC_FILE_NAME = "schreibwerkstatt-sync.json";
  const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
  const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
  const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
  const LS_CLIENT_ID = "sw_google_client_id";
  const LS_CONNECTED = "sw_drive_connected";
  const LS_FILE_ID = "sw_drive_file_id";
  const LS_LAST_SYNC = "sw_drive_last_sync";
  const LS_TOKEN = "sw_drive_token";           // { token, expiresAt }
  const LS_OAUTH_PENDING = "sw_oauth_pending"; // { state, action, startedAt }
  const LS_META = "sw_drive_sync_meta";       // { stories: { id: lastSyncedTimestamp }, ideas: {...}, books: {...} }
  const LS_TOMBSTONES = "sw_drive_tombstones"; // { stories: { id: deletedAtISO }, ideas: {...}, books: {...} }
  const KINDS = ["stories", "ideas", "books"];
  const PENDING_MAX_AGE_MS = 15 * 60 * 1000;

  // Der Google-Login läuft als volle Weiterleitung (kein Popup): Die Seite
  // wechselt zu Google, Google leitet nach dem "Zulassen" zurück zur App und
  // hängt das Zugriffs-Token an die Adresse an (#access_token=…). Ein
  // Popup bricht im installierten Icon-Modus (Standalone/PWA) ab, weil dort
  // die Verbindung zwischen Popup und App-Fenster verloren geht - eine
  // Weiterleitung im selben Fenster funktioniert dagegen überall.
  //
  // Bewusst das implizite Token-Verfahren statt Autorisierungs-Code: Google
  // verlangt beim Eintauschen eines Codes für "Webanwendung"-Clients das
  // Client-Secret, das in einer reinen Browser-App ohne eigenen Server nicht
  // geheim bleiben könnte.
  let beforeRedirectHook = null;
  let redirectResult = null;

  function getClientId() { return localStorage.getItem(LS_CLIENT_ID) || ""; }
  function setClientId(id) {
    const clean = (id || "").trim();
    if (clean !== getClientId()) clearStoredToken(); // Token gehört zur alten Client-ID
    localStorage.setItem(LS_CLIENT_ID, clean);
  }
  function hasClientId() { return !!getClientId(); }

  // Genau diese Adresse muss in der Google Cloud Console unter "Autorisierte
  // Weiterleitungs-URIs" eingetragen sein. "index.html" wird weggelassen, weil
  // die App meist über die Ordner-Adresse (auch per Icon-Start) geöffnet wird.
  function getRedirectUri() {
    const path = location.pathname.replace(/index\.html$/, "");
    return location.origin + path;
  }

  function readStoredToken() {
    const t = readJson(LS_TOKEN, null);
    if (t && t.token && Date.now() < t.expiresAt) return t.token;
    return null;
  }
  function clearStoredToken() { localStorage.removeItem(LS_TOKEN); }

  // Läuft einmalig beim Laden dieser Datei, noch bevor die App etwas anderes
  // tut: wertet die Rückkehr von Google aus und entfernt Token/Fehler sofort
  // wieder aus der Adresszeile.
  function parseRedirectReturn() {
    const fromHash = new URLSearchParams(location.hash.replace(/^#/, ""));
    const fromQuery = new URLSearchParams(location.search);
    const get = (k) => fromHash.get(k) || fromQuery.get(k);
    const hasToken = fromHash.has("access_token");
    const error = get("error");
    if (!hasToken && !error) return null;

    const pending = readJson(LS_OAUTH_PENDING, null);
    localStorage.removeItem(LS_OAUTH_PENDING);
    history.replaceState(null, "", location.pathname);

    if (!pending || !get("state") || get("state") !== pending.state
        || Date.now() - pending.startedAt > PENDING_MAX_AGE_MS) {
      return { ok: false, error: "STATE_MISMATCH", action: pending ? pending.action : null };
    }
    if (error || !hasToken) {
      return { ok: false, error: error || "NO_TOKEN", action: pending.action };
    }
    const expiresIn = Number(fromHash.get("expires_in")) || 3600;
    writeJson(LS_TOKEN, {
      token: fromHash.get("access_token"),
      expiresAt: Date.now() + (expiresIn - 60) * 1000
    });
    localStorage.setItem(LS_CONNECTED, "1");
    // Ließe der Browser das Speichern nicht zu, würde jeder Sync erneut zu
    // Google weiterleiten - dann lieber ehrlich abbrechen statt endlos zu kreisen.
    if (!readStoredToken()) return { ok: false, error: "NO_STORAGE", action: pending.action };
    return { ok: true, action: pending.action };
  }

  // Wird von app.js genau einmal beim Start abgeholt.
  function takeRedirectResult() {
    const r = redirectResult;
    redirectResult = null;
    return r;
  }

  // app.js trägt hier eine Funktion ein, die noch ungespeicherte Eingaben
  // sichert - die Seite wird gleich verlassen.
  function setBeforeRedirectHook(fn) { beforeRedirectHook = fn; }

  function randomState() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function buildAuthUrl(state, interactive) {
    const params = new URLSearchParams({
      client_id: getClientId(),
      redirect_uri: getRedirectUri(),
      response_type: "token",
      scope: SCOPE,
      state
    });
    // Erste Verbindung: Zustimmung ausdrücklich zeigen. Danach (Token abgelaufen)
    // ohne Zusatz - Google fragt dann nur, wenn wirklich nötig, und leitet
    // sonst sofort zurück.
    if (interactive) params.set("prompt", "consent");
    return AUTH_ENDPOINT + "?" + params.toString();
  }

  // action: was nach der Rückkehr passieren soll ("connect" | "sync").
  async function startLogin(action, interactive) {
    if (!hasClientId()) throw new Error("NO_CLIENT_ID");
    const state = randomState();
    writeJson(LS_OAUTH_PENDING, { state, action, startedAt: Date.now() });
    if (beforeRedirectHook) {
      try { await beforeRedirectHook(); } catch (e) { console.error("Vor-Weiterleitung-Sicherung fehlgeschlagen", e); }
    }
    location.assign(buildAuthUrl(state, interactive));
  }

  function isConnected() { return localStorage.getItem(LS_CONNECTED) === "1"; }
  function getLastSync() { return localStorage.getItem(LS_LAST_SYNC) || null; }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function writeJson(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

  // Liest Meta/Tombstones und migriert dabei einmalig das alte, flache
  // Phase-2-Format (nur Geschichten, ohne "stories"-Unterebene).
  function getMetaAll() {
    const raw = readJson(LS_META, {});
    if (!raw.stories && !raw.ideas && !raw.books) {
      return { stories: raw, ideas: {}, books: {} };
    }
    return { stories: raw.stories || {}, ideas: raw.ideas || {}, books: raw.books || {} };
  }
  function setMetaAll(meta) { writeJson(LS_META, meta); }

  function getTombstonesAll() {
    const raw = readJson(LS_TOMBSTONES, {});
    if (!raw.stories && !raw.ideas && !raw.books) {
      return { stories: raw, ideas: {}, books: {} };
    }
    return { stories: raw.stories || {}, ideas: raw.ideas || {}, books: raw.books || {} };
  }
  function setTombstonesAll(t) { writeJson(LS_TOMBSTONES, t); }

  // Von der Oberfläche beim Löschen einer Geschichte/Idee/eines Buchs
  // aufgerufen, damit die Löschung beim nächsten Sync auf das andere
  // Gerät übertragen werden kann. kind: "stories" | "ideas" | "books".
  function markDeleted(kind, id) {
    const tAll = getTombstonesAll();
    tAll[kind][id] = new Date().toISOString();
    setTombstonesAll(tAll);
    const metaAll = getMetaAll();
    delete metaAll[kind][id];
    setMetaAll(metaAll);
  }

  // Verlässt die Seite Richtung Google und kehrt nie normal zurück - wirft
  // deshalb immer "REDIRECTING", damit der Aufrufer nichts mehr weitermacht und
  // keinen Fehler anzeigt. Nach der Rückkehr greift takeRedirectResult().
  // resumeAction: "connect" (nur verbinden) | "sync" (danach gleich synchronisieren).
  async function connect(resumeAction) {
    await startLogin(resumeAction || "connect", true);
    throw new Error("REDIRECTING");
  }

  function disconnect() {
    const stored = readJson(LS_TOKEN, null);
    if (stored && stored.token) {
      fetch(REVOKE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "token=" + encodeURIComponent(stored.token)
      }).catch(() => {});
    }
    clearStoredToken();
    localStorage.removeItem(LS_CONNECTED);
    localStorage.removeItem(LS_FILE_ID);
  }

  async function ensureToken() {
    const token = readStoredToken();
    if (token) return token;
    if (!isConnected()) throw new Error("NOT_CONNECTED");
    // Token abgelaufen (hält ca. eine Stunde): einmal kurz über Google
    // zurückleiten lassen. Ist die Nutzerin dort noch angemeldet und hat schon
    // zugestimmt, geht es ohne weitere Eingabe sofort zurück zur App.
    await startLogin("sync", false);
    throw new Error("REDIRECTING");
  }

  async function driveFetch(url, options) {
    const token = await ensureToken();
    const res = await fetch(url, {
      ...options,
      headers: { ...(options && options.headers), Authorization: "Bearer " + token }
    });
    if (res.status === 401) {
      clearStoredToken();
      throw new Error("Die Google-Anmeldung ist abgelaufen. Bitte noch einmal auf „Synchronisieren“ tippen.");
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error("Google Drive Fehler (" + res.status + "): " + body.slice(0, 200));
    }
    return res;
  }

  async function findSyncFileId() {
    const cached = localStorage.getItem(LS_FILE_ID);
    if (cached) return cached;
    const url = "https://www.googleapis.com/drive/v3/files"
      + "?spaces=appDataFolder&fields=files(id,name)"
      + "&q=" + encodeURIComponent(`name='${SYNC_FILE_NAME}' and trashed=false`);
    const res = await driveFetch(url, { method: "GET" });
    const data = await res.json();
    const file = (data.files || [])[0];
    if (file) { localStorage.setItem(LS_FILE_ID, file.id); return file.id; }
    return null;
  }

  async function downloadRemote() {
    const fileId = await findSyncFileId();
    if (!fileId) return { stories: [], ideas: [], books: [] };
    const res = await driveFetch(
      "https://www.googleapis.com/drive/v3/files/" + fileId + "?alt=media",
      { method: "GET" }
    );
    try {
      const data = await res.json();
      return { stories: data.stories || [], ideas: data.ideas || [], books: data.books || [] };
    } catch (e) { return { stories: [], ideas: [], books: [] }; }
  }

  async function uploadSnapshot(data) {
    const payload = JSON.stringify({
      app: "Meine Schreibwerkstatt",
      savedAt: new Date().toISOString(),
      stories: data.stories || [],
      ideas: data.ideas || [],
      books: data.books || []
    });
    let fileId = await findSyncFileId();
    if (fileId) {
      await driveFetch(
        "https://www.googleapis.com/upload/drive/v3/files/" + fileId + "?uploadType=media",
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: payload }
      );
    } else {
      const boundary = "swsync" + Date.now();
      const metadata = { name: SYNC_FILE_NAME, parents: ["appDataFolder"] };
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${payload}\r\n` +
        `--${boundary}--`;
      const res = await driveFetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
        { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body }
      );
      const created = await res.json();
      localStorage.setItem(LS_FILE_ID, created.id);
    }
    localStorage.setItem(LS_LAST_SYNC, new Date().toISOString());
  }

  // Ideen aus einer älteren Version haben eventuell noch kein updatedAt -
  // dann dient createdAt als Rückfalloption.
  function getTimestamp(kind, item) {
    return kind === "ideas" ? (item.updatedAt || item.createdAt) : item.updatedAt;
  }

  function itemsEqual(kind, a, b) {
    if (kind === "ideas") return a.text === b.text;
    if (kind === "books") {
      return a.title === b.title && a.subtitle === b.subtitle && a.description === b.description
        && a.cover === b.cover
        && JSON.stringify(a.chapters || []) === JSON.stringify(b.chapters || []);
    }
    return a.title === b.title && a.content === b.content && a.status === b.status;
  }

  // Vergleicht lokalen und entfernten Stand einer Sammlung und liefert eine
  // Liste von Aktionen. Automatische Aktionen können sofort angewendet
  // werden; "conflict"-Einträge muss die Nutzerin entscheiden.
  // kind: "stories" | "ideas" | "books".
  function buildSyncPlan(kind, localItems, remoteItems) {
    const meta = getMetaAll()[kind];
    const tombstones = getTombstonesAll()[kind];
    const localById = new Map(localItems.map(s => [s.id, s]));
    const remoteById = new Map((remoteItems || []).map(s => [s.id, s]));
    const ids = new Set([...localById.keys(), ...remoteById.keys(), ...Object.keys(tombstones)]);

    const actions = [];

    ids.forEach((id) => {
      const local = localById.get(id) || null;
      const remote = remoteById.get(id) || null;
      const lastSynced = meta[id] || null;
      const deletedLocallyAt = tombstones[id] || null;

      // Lokal gelöscht (seit letztem Sync)
      if (deletedLocallyAt && !local) {
        if (!remote) {
          actions.push({ type: "clear-tombstone", id });
          return;
        }
        const remoteTs = getTimestamp(kind, remote);
        const remoteChangedAfterDeletion = !lastSynced || remoteTs > lastSynced;
        if (remoteChangedAfterDeletion && remoteTs > deletedLocallyAt) {
          actions.push({ type: "conflict", kind: "delete-edit", id, local: null, remote });
        } else {
          actions.push({ type: "delete-remote", id });
        }
        return;
      }

      if (local && !remote) {
        if (!lastSynced) {
          // Ganz neu, nur lokal vorhanden -> hochladen
          actions.push({ type: "upload-local", item: local });
        } else {
          // War schon mal synchronisiert, ist jetzt entfernt (anderes Gerät hat gelöscht)
          const localChanged = getTimestamp(kind, local) > lastSynced;
          if (localChanged) {
            actions.push({ type: "conflict", kind: "edit-delete", id, local, remote: null });
          } else {
            actions.push({ type: "delete-local", id });
          }
        }
        return;
      }

      if (!local && remote) {
        actions.push({ type: "adopt-remote", item: remote });
        return;
      }

      if (local && remote) {
        const localTs = getTimestamp(kind, local);
        const remoteTs = getTimestamp(kind, remote);
        const localChanged = !lastSynced || localTs > lastSynced;
        const remoteChanged = !lastSynced || remoteTs > lastSynced;
        if (!localChanged && !remoteChanged) return; // nichts zu tun
        if (localChanged && !remoteChanged) { actions.push({ type: "upload-local", item: local }); return; }
        if (!localChanged && remoteChanged) { actions.push({ type: "adopt-remote", item: remote }); return; }
        // beide geändert
        if (itemsEqual(kind, local, remote)) {
          actions.push({ type: "align-timestamp", item: localTs > remoteTs ? local : remote });
        } else {
          actions.push({ type: "conflict", kind: "edit-edit", id, local, remote });
        }
      }
    });

    return actions;
  }

  // Nach Anwenden aller automatischen Aktionen und Klären aller Konflikte für
  // alle drei Sammlungen: ein gemeinsamer Upload plus Aktualisierung von
  // Sync-Zeitstempeln/Tombstones. perKindData sieht für jedes kind so aus:
  // { items: [...aktueller lokaler Bestand...], resolvedIds: [...], clearedTombstoneIds: [...] }
  async function finishSync(perKindData) {
    await uploadSnapshot({
      stories: perKindData.stories.items,
      ideas: perKindData.ideas.items,
      books: perKindData.books.items
    });

    const metaAll = getMetaAll();
    const tombstonesAll = getTombstonesAll();

    KINDS.forEach((kind) => {
      const { items, resolvedIds, clearedTombstoneIds } = perKindData[kind];
      const byId = new Map(items.map(i => [i.id, i]));
      const meta = metaAll[kind];
      (resolvedIds || []).forEach((id) => {
        const item = byId.get(id);
        if (item) meta[id] = getTimestamp(kind, item);
        else delete meta[id];
      });
      const tombstones = tombstonesAll[kind];
      (clearedTombstoneIds || []).forEach((id) => delete tombstones[id]);
    });

    setMetaAll(metaAll);
    setTombstonesAll(tombstonesAll);
  }

  redirectResult = parseRedirectReturn();

  return {
    hasClientId, getClientId, setClientId, getRedirectUri,
    isConnected, connect, disconnect, getLastSync,
    takeRedirectResult, setBeforeRedirectHook, buildAuthUrl,
    markDeleted,
    downloadRemote, buildSyncPlan, finishSync
  };
})();
