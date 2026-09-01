// Google-Drive-Synchronisation.
//
// Die Geschichten werden als eine JSON-Datei im privaten "App-Ordner" der
// Nutzerin auf Google Drive abgelegt (Scope drive.appdata). Diesen Ordner
// sieht die Nutzerin nicht in ihrem normalen Drive – sie muss also nie
// Dateien oder Ordner selbst verwalten.
//
// Diese Datei kennt nichts von der Benutzeroberfläche. app.js ruft
// DriveSync.buildSyncPlan(...) auf, wendet automatische Aktionen an, fragt
// bei Konflikten die Nutzerin und ruft danach DriveSync.finishSync(...) auf.
const DriveSync = (function () {
  "use strict";

  const SYNC_FILE_NAME = "schreibwerkstatt-sync.json";
  const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
  const LS_CLIENT_ID = "sw_google_client_id";
  const LS_CONNECTED = "sw_drive_connected";
  const LS_FILE_ID = "sw_drive_file_id";
  const LS_LAST_SYNC = "sw_drive_last_sync";
  const LS_META = "sw_drive_sync_meta";       // { storyId: lastSyncedUpdatedAt }
  const LS_TOMBSTONES = "sw_drive_tombstones"; // { storyId: deletedAtISO }

  let tokenClient = null;
  let accessToken = null;
  let tokenExpiresAt = 0;
  let gisReady = false;
  let gisLoadPromise = null;

  function loadGisScript() {
    if (gisLoadPromise) return gisLoadPromise;
    gisLoadPromise = new Promise((resolve, reject) => {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) {
        gisReady = true;
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = () => { gisReady = true; resolve(); };
      script.onerror = () => reject(new Error("Google-Anmeldedienst konnte nicht geladen werden."));
      document.head.appendChild(script);
    });
    return gisLoadPromise;
  }

  function getClientId() { return localStorage.getItem(LS_CLIENT_ID) || ""; }
  function setClientId(id) {
    localStorage.setItem(LS_CLIENT_ID, (id || "").trim());
    tokenClient = null; // bei geänderter Client-ID neu initialisieren
  }
  function hasClientId() { return !!getClientId(); }

  function isConnected() { return localStorage.getItem(LS_CONNECTED) === "1"; }
  function getLastSync() { return localStorage.getItem(LS_LAST_SYNC) || null; }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function writeJson(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

  function getMeta() { return readJson(LS_META, {}); }
  function setMeta(meta) { writeJson(LS_META, meta); }
  function getTombstones() { return readJson(LS_TOMBSTONES, {}); }
  function setTombstones(t) { writeJson(LS_TOMBSTONES, t); }

  // Vom Editor beim Löschen einer Geschichte aufgerufen, damit die Löschung
  // beim nächsten Sync auf das andere Gerät übertragen werden kann.
  function markDeleted(id) {
    const t = getTombstones();
    t[id] = new Date().toISOString();
    setTombstones(t);
    const meta = getMeta();
    delete meta[id];
    setMeta(meta);
  }

  async function ensureTokenClient() {
    if (!gisReady) await loadGisScript();
    if (!hasClientId()) throw new Error("NO_CLIENT_ID");
    if (!tokenClient) {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: getClientId(),
        scope: SCOPE,
        callback: () => {} // wird pro Aufruf überschrieben
      });
    }
    return tokenClient;
  }

  function requestToken(interactive) {
    return new Promise(async (resolve, reject) => {
      let client;
      try { client = await ensureTokenClient(); }
      catch (e) { reject(e); return; }

      client.callback = (resp) => {
        if (resp && resp.access_token) {
          accessToken = resp.access_token;
          tokenExpiresAt = Date.now() + ((resp.expires_in || 3600) - 60) * 1000;
          resolve(accessToken);
        } else {
          reject(new Error(resp && resp.error ? resp.error : "Keine Berechtigung erhalten."));
        }
      };
      client.error_callback = (err) => {
        reject(new Error((err && err.type) || "Anmeldung abgebrochen."));
      };
      client.requestAccessToken({ prompt: interactive ? "consent" : "" });
    });
  }

  // Muss aus einem direkten Klick-Handler aufgerufen werden (Popup-Blocker).
  async function connect() {
    await requestToken(true);
    localStorage.setItem(LS_CONNECTED, "1");
    return true;
  }

  function disconnect() {
    if (accessToken && window.google && window.google.accounts && window.google.accounts.oauth2) {
      window.google.accounts.oauth2.revoke(accessToken, () => {});
    }
    accessToken = null;
    tokenExpiresAt = 0;
    localStorage.removeItem(LS_CONNECTED);
    localStorage.removeItem(LS_FILE_ID);
  }

  async function ensureToken() {
    if (accessToken && Date.now() < tokenExpiresAt) return accessToken;
    if (!isConnected()) throw new Error("NOT_CONNECTED");
    // Versuch, ohne erneuten Klick eine Berechtigung zu bekommen (funktioniert,
    // solange die Nutzerin noch bei Google angemeldet ist und schon zugestimmt hat).
    return requestToken(false);
  }

  async function driveFetch(url, options) {
    const token = await ensureToken();
    const res = await fetch(url, {
      ...options,
      headers: { ...(options && options.headers), Authorization: "Bearer " + token }
    });
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
    if (!fileId) return { stories: [] };
    const res = await driveFetch(
      "https://www.googleapis.com/drive/v3/files/" + fileId + "?alt=media",
      { method: "GET" }
    );
    try { return await res.json(); }
    catch (e) { return { stories: [] }; }
  }

  async function uploadSnapshot(stories) {
    const payload = JSON.stringify({ app: "Meine Schreibwerkstatt", savedAt: new Date().toISOString(), stories });
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

  function storiesEqual(a, b) {
    return a.title === b.title && a.content === b.content && a.status === b.status;
  }

  // Vergleicht lokalen und entfernten Stand und liefert eine Liste von
  // Aktionen. Automatische Aktionen können sofort angewendet werden;
  // "conflict"-Einträge muss die Nutzerin entscheiden.
  function buildSyncPlan(localStories, remoteStories) {
    const meta = getMeta();
    const tombstones = getTombstones();
    const localById = new Map(localStories.map(s => [s.id, s]));
    const remoteById = new Map((remoteStories || []).map(s => [s.id, s]));
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
        const remoteChangedAfterDeletion = !lastSynced || remote.updatedAt > lastSynced;
        if (remoteChangedAfterDeletion && remote.updatedAt > deletedLocallyAt) {
          actions.push({ type: "conflict", kind: "delete-edit", id, local: null, remote });
        } else {
          actions.push({ type: "delete-remote", id });
        }
        return;
      }

      if (local && !remote) {
        if (!lastSynced) {
          // Ganz neu, nur lokal vorhanden -> hochladen
          actions.push({ type: "upload-local", story: local });
        } else {
          // War schon mal synchronisiert, ist jetzt entfernt (anderes Gerät hat gelöscht)
          const localChanged = local.updatedAt > lastSynced;
          if (localChanged) {
            actions.push({ type: "conflict", kind: "edit-delete", id, local, remote: null });
          } else {
            actions.push({ type: "delete-local", id });
          }
        }
        return;
      }

      if (!local && remote) {
        actions.push({ type: "adopt-remote", story: remote });
        return;
      }

      if (local && remote) {
        const localChanged = !lastSynced || local.updatedAt > lastSynced;
        const remoteChanged = !lastSynced || remote.updatedAt > lastSynced;
        if (!localChanged && !remoteChanged) return; // nichts zu tun
        if (localChanged && !remoteChanged) { actions.push({ type: "upload-local", story: local }); return; }
        if (!localChanged && remoteChanged) { actions.push({ type: "adopt-remote", story: remote }); return; }
        // beide geändert
        if (storiesEqual(local, remote)) {
          actions.push({ type: "align-timestamp", story: local.updatedAt > remote.updatedAt ? local : remote });
        } else {
          actions.push({ type: "conflict", kind: "edit-edit", id, local, remote });
        }
      }
    });

    return actions;
  }

  // Nach Anwenden aller automatischen Aktionen und Klären aller Konflikte:
  // finalStories ist der vollständige, endgültige lokale Bestand.
  // resolvedIds sind die Story-IDs, die diese Runde final abgeglichen wurden
  // (inkl. "später entscheiden" ausgenommen) – für sie wird der Sync-Zeitstempel gesetzt.
  async function finishSync(finalStories, resolvedIds, clearedTombstoneIds) {
    await uploadSnapshot(finalStories);
    const meta = getMeta();
    const finalById = new Map(finalStories.map(s => [s.id, s]));
    resolvedIds.forEach((id) => {
      const s = finalById.get(id);
      if (s) meta[id] = s.updatedAt;
      else delete meta[id];
    });
    setMeta(meta);

    const tombstones = getTombstones();
    (clearedTombstoneIds || []).forEach((id) => delete tombstones[id]);
    setTombstones(tombstones);
  }

  return {
    hasClientId, getClientId, setClientId,
    isConnected, connect, disconnect, getLastSync,
    markDeleted,
    downloadRemote, buildSyncPlan, finishSync
  };
})();
