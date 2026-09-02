# Meine Schreibwerkstatt

Eine persönliche Autoren-App für Kurzgeschichten – siehe `MASTERANWEISUNG.md` (nicht Teil dieses Repos) für das vollständige Konzept.

**Status:** Phase 2 – echtes Hosting + Google-Drive-Synchronisation.

## Lokal testen

Kein Build-Schritt nötig, aber Google-Drive-Login und IndexedDB funktionieren
zuverlässig nur über `http://`/`https://`, nicht über `file://`. Lokal am
einfachsten mit einem simplen Webserver starten, z. B.:

```bash
python -m http.server 8934
```

und dann `http://localhost:8934` öffnen.

## Veröffentlichen auf GitHub Pages

1. Ein neues, **privates oder öffentliches** GitHub-Repository anlegen (z. B. `schreibwerkstatt`).
2. Diesen Ordner hochladen (`git push`).
3. In den Repository-Einstellungen unter **Pages** als Quelle den `main`-Branch (Root-Verzeichnis) auswählen.
4. GitHub zeigt danach die fertige Adresse an, z. B. `https://<benutzername>.github.io/schreibwerkstatt/`.

> Hinweis: GitHub Pages ist bei privaten Repos nur mit einem kostenpflichtigen
> GitHub-Plan öffentlich erreichbar. Für ein kostenloses privates Repo mit
> Pages entweder das Repo öffentlich lassen (die App enthält keine
> persönlichen Daten – die Geschichten liegen nur lokal bzw. im eigenen
> Google Drive) oder Netlify statt GitHub Pages verwenden.

## Google-Drive-Synchronisation einrichten (einmalig, pro Google-Konto)

Die App braucht eine eigene, kostenlose **OAuth-Client-ID** von Google, damit
sie sich mit dem eigenen Google-Konto verbinden darf. Diese Einrichtung
passiert einmalig in der Google Cloud Console:

1. [console.cloud.google.com](https://console.cloud.google.com/) öffnen und mit dem Google-Konto anmelden, das später für die Synchronisation genutzt werden soll.
2. Ein neues Projekt anlegen, z. B. „Meine Schreibwerkstatt".
3. Im Menü zu **APIs & Dienste → Bibliothek** wechseln, nach „Google Drive API" suchen und aktivieren.
4. Zu **APIs & Dienste → OAuth-Zustimmungsbildschirm** wechseln:
   - Nutzertyp „Extern" wählen (auch für den reinen Eigenbedarf nötig).
   - App-Name (z. B. „Meine Schreibwerkstatt"), eigene E-Mail-Adresse als Kontakt eintragen.
   - Unter „Testnutzer" die eigene Google-Adresse (bzw. die der Schwester) hinzufügen. Ohne diesen Schritt lässt Google die Anmeldung nicht zu.
5. Zu **APIs & Dienste → Zugangsdaten** wechseln, **Zugangsdaten erstellen → OAuth-Client-ID**:
   - Anwendungstyp: „Webanwendung".
   - Unter „Autorisierte JavaScript-Quellen" **genau** die spätere GitHub-Pages-Adresse eintragen, z. B. `https://<benutzername>.github.io` (ohne Pfad am Ende).
   - Für lokale Tests zusätzlich `http://localhost:8934` eintragen.
6. Die entstandene Client-ID (endet auf `.apps.googleusercontent.com`) kopieren.
7. In der App unter **Einstellungen → Google Drive-Synchronisation** einfügen und auf „Client-ID speichern" tippen, danach „Mit Google Drive verbinden".

Die Geschichten werden dabei in einem privaten App-Ordner im eigenen Google
Drive abgelegt (Scope `drive.appdata`) – dieser taucht nicht im normalen
Drive-Ordner auf und muss nie manuell verwaltet werden.

## Architektur

- `js/storage.js` – lokaler Speicher (IndexedDB). Austauschbar.
- `js/drive-sync.js` – Google-Drive-Anbindung inkl. Konflikterkennung. Austauschbar gegen andere Cloud-Anbieter.
- `js/app.js` – Oberfläche und Verknüpfung der beiden Module.

Die Synchronisation deckt Geschichten, Ideen und Bücher gemeinsam ab.
Konflikte (derselbe Eintrag auf zwei Geräten geändert) werden einzeln
angezeigt; die Autorin entscheidet, welche Version bleibt, oder verschiebt
die Entscheidung auf später.

## Hinweis für Updates

Die drei Skript-Einbindungen in `index.html` tragen eine Versionsnummer
(`js/app.js?v=4` usw.), damit Browser nach einem Update nicht versehentlich
eine alte, zwischengespeicherte Version ausführen. Bei jeder inhaltlichen
Änderung an `js/*.js` bitte die Zahl `?v=` in allen drei `<script>`-Tags in
`index.html` um eins erhöhen.
