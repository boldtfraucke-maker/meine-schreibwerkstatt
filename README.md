# Meine Schreibwerkstatt

Eine persönliche Autoren-App für Kurzgeschichten – siehe `MASTERANWEISUNG.md` (nicht Teil dieses Repos) für das vollständige Konzept.

**Status:** Phase 5 abgeschlossen – KI-Vorschläge (Korrektorat/Lektorat/Stil) und eine Aufbau & Wirkung-Einschätzung (Spannungsbogen, Emotion, Beschreibungen) für einzelne Geschichten, eine kostenbewusste Konsistenzprüfung über mehrere Geschichten hinweg sowie ein Buch-Assistent, der stimmungsvolle Kapitel-Titel vorschlägt.

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

## KI-Vorschläge einrichten (Cloudflare Worker)

Für die KI-Funktionen (Korrektorat, Lektorat, Stil-Analyse) ruft die App die
Claude-API auf. Der API-Key darf dafür aber niemals im Browser landen (er
wäre für jeden im Netzwerk-Tab sichtbar und mit der eigenen Rechnung
verknüpft). Deshalb läuft die Anfrage über einen winzigen, kostenlosen
Cloudflare Worker, der den Key geheim hält und nur weiterleitet.

1. Einen Anthropic-API-Key besorgen: [console.anthropic.com](https://console.anthropic.com/) → **API Keys** → neuen Key erstellen und kopieren (beginnt mit `sk-ant-...`). Empfehlenswert: dort auch ein monatliches Ausgabenlimit setzen (z. B. 5–10 €) als zusätzliche Absicherung.
2. Bei [dash.cloudflare.com](https://dash.cloudflare.com/) ein kostenloses Konto anlegen.
3. Im Dashboard **Workers & Pages → Create → Create Worker** wählen, einen Namen vergeben (z. B. `schreibwerkstatt-ki`) und erstellen.
4. Im Worker-Editor („Edit code") den kompletten Inhalt von [`cloudflare-worker/worker.js`](cloudflare-worker/worker.js) aus diesem Repo einfügen (vorhandenen Beispielcode ersetzen) und **Deploy** klicken.
5. Zurück in den Worker-Einstellungen unter **Settings → Variables and Secrets** zwei Secrets anlegen (jeweils als „Secret", nicht als normale Variable):
   - `ANTHROPIC_API_KEY` – der Key aus Schritt 1.
   - `WORKER_ACCESS_KEY` – ein selbst ausgedachtes Passwort (schützt den Worker davor, dass Fremde ihn mitbenutzen, falls sie die Adresse erraten).
6. Die Worker-Adresse (`https://<name>.<konto>.workers.dev`) kopieren.
7. In der App unter **Einstellungen → ✨ KI-Vorschläge (Claude)** die Worker-Adresse und den selbst ausgedachten `WORKER_ACCESS_KEY` eintragen und speichern.

Danach sind der Button „✨ KI-Vorschläge" und „📖 Aufbau prüfen" im
Schreiben-Bereich sowie „🔍 Konsistenz prüfen" und „✨ Kapitel-Titel
vorschlagen" im Bücher-Bereich nutzbar.

„Konsistenz prüfen" vergleicht Namen und Orte über alle Geschichten hinweg
(z. B. „Balu" vs. „Balou") und extrahiert dafür pro Geschichte höchstens
einmal eine kurze Namensliste per KI – der eigentliche Abgleich zwischen den
Geschichten läuft danach komplett lokal im Browser, ganz ohne weitere
KI-Kosten. „Kapitel-Titel vorschlagen" schickt pro Kapitel nur die Titel und
kurze Ausschnitte der enthaltenen Geschichten (keine vollen Texte) und
schlägt darauf passende, stimmungsvolle Kapitel-Titel vor – die Reihenfolge
der Geschichten bleibt dabei unangetastet, das entscheidet weiterhin
ausschließlich die Autorin selbst. „📖 Aufbau prüfen" schaut sich (wie „✨
KI-Vorschläge" auch) den vollen Text einer Geschichte an, gibt aber statt
einzelner Textstellen-Vorschläge eine kurze Gesamteinschätzung zu
Spannungsbogen, emotionaler Wirkung und Lebendigkeit der Beschreibungen –
und falls sinnvoll einen Hinweis, wo ein Schnitt in zwei Teile in Frage käme.
Reine Einschätzung zum Nachdenken, es wird nichts automatisch verändert.

### Kosten im Blick behalten

Die App selbst, Hosting, Speicherung und Google-Drive-Sync sind komplett
kostenlos. Nur die beiden KI-Funktionen verursachen laufende Kosten auf dem
eigenen Anthropic-Konto (nach Textmenge abgerechnet) – und die sind bewusst
klein gehalten:

- **Modell:** `claude-sonnet-5` statt des teureren `claude-opus-5` – für das
  Finden von Rechtschreib-/Stilproblemen in einer kurzen Geschichte reicht
  die Qualität völlig aus, kostet aber nur einen Bruchteil.
- **Denktiefe „niedrig"** (`output_config.effort: "low"`): passend für eine
  klar umrissene Aufgabe (Stellen finden, nicht frei nachdenken); spart
  unnötige, mitbezahlte Zwischenschritte der KI.
- **Erzwungenes Antwortformat** (`output_config.format`): Die KI *muss* eine
  kurze, strukturierte Liste zurückgeben (Textstelle/Vorschlag/Begründung) –
  sie schreibt nie die ganze Geschichte neu zurück. Das hält vor allem die
  – deutlich teureren – Ausgabe-Token gering.
- **Kein automatischer Aufruf:** Die KI wird ausschließlich bei einem
  bewussten Klick auf „✨ KI-Vorschläge" angefragt, nie im Hintergrund oder
  beim normalen Tippen.
- **Eingebaute Rechtschreibprüfung des Browsers** (rote Wellenlinien beim
  Tippen) fängt einfache Tippfehler schon kostenlos ab, bevor überhaupt eine
  KI-Prüfung nötig ist.

Grobe Hausnummer bei dieser Einstellung: eine Prüfung liegt im Bereich von
unter einem Cent; selbst bei mehrmals täglicher Nutzung bleibt man im
niedrigen einstelligen Euro-Bereich pro Monat. Als zusätzliche, harte
Absicherung unbedingt ein monatliches Ausgabenlimit in der Anthropic Console
setzen (siehe Schritt 1 oben) – darüber hinaus funktionieren Anfragen
schlicht nicht mehr, ganz unabhängig vom Code hier.

## Architektur

- `js/storage.js` – lokaler Speicher (IndexedDB). Austauschbar.
- `js/drive-sync.js` – Google-Drive-Anbindung inkl. Konflikterkennung. Austauschbar gegen andere Cloud-Anbieter.
- `js/ai-provider.js` – KI-Anbindung über den Cloudflare Worker. Austauschbar gegen einen anderen KI-Anbieter.
- `js/app.js` – Oberfläche und Verknüpfung der Module.
- `cloudflare-worker/worker.js` – Quellcode des Vermittlers zwischen App und Claude-API (siehe oben).

Die Synchronisation deckt Geschichten, Ideen und Bücher gemeinsam ab.
Konflikte (derselbe Eintrag auf zwei Geräten geändert) werden einzeln
angezeigt; die Autorin entscheidet, welche Version bleibt, oder verschiebt
die Entscheidung auf später.

## Hinweis für Updates

Die Skript- und Stylesheet-Einbindungen in `index.html` tragen eine
Versionsnummer (`js/app.js?v=4`, `css/style.css?v=4` usw.), damit Browser
nach einem Update nicht versehentlich eine alte, zwischengespeicherte
Version ausführen. Bei jeder inhaltlichen Änderung an `js/*.js` oder
`css/style.css` bitte die Zahl `?v=` in allen vier betroffenen Tags in
`index.html` um eins erhöhen.
