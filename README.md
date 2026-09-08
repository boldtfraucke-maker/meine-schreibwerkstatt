# Meine Schreibwerkstatt

Eine persönliche Autoren-App für Kurzgeschichten – siehe `MASTERANWEISUNG.md` (nicht Teil dieses Repos) für das vollständige Konzept.

**Status:** Phase 5 abgeschlossen – KI-Vorschläge (Korrektorat/Lektorat/Stil) und eine Aufbau & Wirkung-Einschätzung (Spannungsbogen, Emotion, Beschreibungen) für einzelne Geschichten, eine kostenbewusste Konsistenzprüfung über mehrere Geschichten hinweg sowie ein Buch-Assistent, der stimmungsvolle Kapitel-Titel vorschlägt. Phase 6 (Buchproduktion fürs Drucken) ist abgeschlossen: Anbieter & Format wählen, druckgenaues Layout, Titelei mit Impressum, Seitenzahlen, PDF-Export und Cover-Download. Phase 7 (Bilder im Buch & Cover-Wrap) läuft, Stufe 1 (Umschlag-Größe berechnen), Stufe 2 (Umschlagbild hochladen mit automatischem Zuschnitt), Stufe 3 (Titel/Autor automatisch auf den Rücken setzen) und Stufe 4 (ISBN-Fläche markieren) sind umgesetzt.

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

Bei „✨ KI-Vorschläge" liefert die KI zu jeder Stelle 1 bis 3 Formulierungs-
Alternativen (nicht immer 3 - nur wenn es echten gestalterischen Spielraum
gibt, sonst nur eine). Gibt es mehrere, wählt man per Radiobutton, welche
übernommen werden soll. Korrektorat/Lektorat/Stil haben dabei jeweils eine
eigene Randmarker-Farbe.

„Konsistenz prüfen" vergleicht Namen und Orte über alle Geschichten hinweg
(z. B. „Balu" vs. „Balou") und extrahiert dafür pro Geschichte höchstens
einmal eine kurze Namensliste per KI – der eigentliche Abgleich zwischen den
Geschichten läuft danach komplett lokal im Browser, ganz ohne weitere
KI-Kosten. Das Ergebnis bleibt gespeichert (mit Zahlen-Abzeichen am Button)
und jeder Fund lässt sich einzeln als erledigt markieren, ganz wie bei
KI-Vorschläge/Aufbau & Wirkung - bleibt aber bewusst eine einfache Liste
ohne Marker im Text oder Handy-Schrittansicht, weil sich ein Fund über
mehrere Geschichten hinweg nicht an einer einzelnen Textstelle festmachen
lässt und diese Prüfung erfahrungsgemäß ohnehin nur am PC genutzt wird. Ein
Klick auf den Geschichtentitel im Fund öffnet die betroffene Geschichte
direkt im Schreiben-Bereich und springt zur ersten Fundstelle. „Kapitel-
Titel vorschlagen" schickt pro Kapitel nur die Titel und
kurze Ausschnitte der enthaltenen Geschichten (keine vollen Texte) und
schlägt darauf passende, stimmungsvolle Kapitel-Titel vor – die Reihenfolge
der Geschichten bleibt dabei unangetastet, das entscheidet weiterhin
ausschließlich die Autorin selbst. „📖 Aufbau prüfen" schaut sich (wie „✨
KI-Vorschläge" auch) den vollen Text einer Geschichte an, gibt aber statt
einzelner Textstellen-Vorschläge eine kurze Gesamteinschätzung entlang der
Lektorats-Reihenfolge vom Großen ins Detail: Aufbau & Spannungsbogen,
Einladung zum Weiterlesen, Erzähltempo und Show-don't-tell – und falls
sinnvoll einen Hinweis, wo ein Schnitt in zwei Teile in Frage käme. Reine
Einschätzung zum Nachdenken, es wird nichts automatisch verändert. Lässt
sich ein Fund einer Textstelle zuordnen, gibt es zusätzlich "✎ Text
bearbeiten": ein Entwurfsfeld, vorausgefüllt mit einem konkreten
Formulierungsvorschlag der KI (falls vorhanden, sonst mit der Originalstelle),
das man in Ruhe frei weiterbearbeiten und danach per "Einfügen" an der
ursprünglichen Stelle einsetzen kann - der Entwurf wird zwischengespeichert,
auch wenn man das Feld erstmal wieder schließt.

Ist ein Fund reines Lob ohne Handlungsbedarf (z. B. ein besonders gelungener
Schluss), wird die Karte bzw. der Marker grün hervorgehoben statt in der
sonstigen Kategorie-Farbe - so ist auf einen Blick klar, wo nichts zu tun
ist. Das passiert nur, wenn der KI wirklich etwas Positives auffällt, nicht
als Pflicht-Kommentar für jede Kategorie.

Bei Handlungsbedarf zeigt die Karte die betroffene Original-Textstelle in
Rot und den Formulierungsvorschlag (die "→ ..."-Zeile) in Grün an - wie ein
Vorher/Nachher auf einen Blick. In der Begründung zitierte Textstellen
werden ebenfalls farbig hervorgehoben (rot bei Handlungsbedarf, grün bei
reinem Lob). Das gilt sowohl für KI-Vorschläge als auch für Aufbau &
Wirkung.

Offene Punkte aus beiden Funktionen (KI-Vorschläge und Aufbau & Wirkung)
bleiben an der jeweiligen Geschichte gespeichert (nicht im Ideenparkplatz)
und erscheinen beim erneuten Öffnen automatisch wieder, bis man sie
einzeln übernimmt/ablehnt bzw. als erledigt markiert. Ein kleines
Zahlen-Abzeichen am jeweiligen Button zeigt auf einen Blick, wie viele
Punkte noch offen sind.

Am PC oder Tablet im Querformat (ab 821px Breite) erscheint jeder Fund,
der sich einer bestimmten Textstelle zuordnen lässt, als kleiner farbiger
Marker direkt im Rand neben dem Text (Klick öffnet ein Feld mit
Übernehmen/Ablehnen bzw. Erledigt, ohne den Text-Kontext zu verlassen).
Auf dem Handy oder im Hochformat (kein Platz für einen Rand) erscheinen
dieselben Funde stattdessen einzeln nacheinander (statt einer langen Liste
zum Durchscrollen), mit Zähler „X von Y" sowie Weiter/Zurück, inklusive
„→ Zur Stelle springen". Wird ein Punkt übernommen/abgelehnt/als erledigt
markiert, erscheint automatisch der nächste offene Punkt. Allgemeine
Anmerkungen ohne konkrete Textstelle (z. B. übergreifendes Tempo-Feedback)
bleiben immer in der Liste, auch am PC.

### Ideenparkplatz

Jede Idee kann optional einen Titel und eine Farbe bekommen (als farbiger
Rand auf der Karte) - hilfreich, um bei vielen Ideen den Überblick zu
behalten, z. B. nach Geschichte oder Thema sortiert per Farbe. Fünf fest
eingepflegte Kategorien (Blitzgedanke, Cooler Satz, Metaphern, Bildsprache,
Emotionen & Bewegung) stehen als Ein-Klick-Vorschläge bereit und füllen
Titel und Farbe automatisch aus - man kann den Titel danach trotzdem frei
weiterschreiben oder ergänzen. Wer lieber eine eigene Kategorie möchte,
tippt einfach einen eigenen Titel und wählt eine Farbe - die Vorschläge
sind nur eine Abkürzung, keine Einschränkung.

Ein Mikrofon-Knopf am Ideen-Textfeld erlaubt Diktieren statt Tippen -
unterwegs praktisch. Das läuft komplett über eine im Browser eingebaute
Funktion (Web Speech API), ganz ohne Anthropic-Anfrage und ohne
zusätzliche Kosten. Funktioniert auf Android (Chrome) und iPhone (Safari),
nicht im Firefox-Browser - dort fehlt der Knopf einfach, Tippen geht immer.
Der diktierte Text bleibt danach ganz normal bearbeitbar, bevor man
speichert.

### Bücher

Das Cover dient nur der Übersicht (Bücher-Liste und -Bearbeitung) und
erscheint nicht in „Vorschau ansehen" - das eigentliche Layout kommt erst
mit den Layoutvorlagen in Phase 6. Der Titel jeder einzelnen Geschichte
erscheint in der Vorschau nur, wenn ein Kapitel mehrere Geschichten bündelt
(zum Auseinanderhalten) - bei einem Kapitel mit nur einer Geschichte reicht
der Kapiteltitel allein, ohne doppelte Überschrift.

Die Buch-Bearbeitung ist (nur am PC/Tablet-quer, ab 821px Breite) in zwei
Reiter aufgeteilt: „Inhalt" (Titel, Cover-Bildchen, Kapitel - das, womit
man beim Schreiben/Zusammenstellen arbeitet) und „Für den Druck" (Anbieter,
Titelei, Umschlag - das, was erst am Ende gebraucht wird). Das hält die
Seite übersichtlich, auch wenn mit jeder Druck-Funktion mehr dazukommt.
„Vorschau ansehen" bleibt dabei immer oben sichtbar, unabhängig vom Reiter.
Am Handy gibt es diese Reiter nicht, dort ist „Für den Druck" ohnehin nicht
verfügbar.

### Phase 6: Für den Druck (nur am PC)

In der Buch-Bearbeitung lässt sich (nur am PC/Tablet-quer, ab 821px Breite -
die Funktion wird auf dem Handy bewusst nicht angeboten) ein POD-Anbieter
und dazu ein Seitenformat wählen. Enthalten sind ausschließlich Formate,
deren Maße direkt beim jeweiligen Anbieter bestätigt gefunden wurden (Stand
der Recherche: September 2026) - keine geschätzten oder von anderen
Anbietern übernommenen Werte, weil ein falsches Maß bei einer echten
Druckbestellung teuer werden kann:

- **Amazon KDP:** 12,7×20,3 cm, 13,3×20,3 cm, 14×21,6 cm, 15,2×22,9 cm
  (6″×9″, beliebtestes Format) - Beschnitt 3,2 mm.
- **epubli:** 12,5×19 cm (Taschenbuch), 14,8×21 cm (A5), 13,5×20,5 cm
  (Sachbuch) - kein öffentlicher Beschnitt-Wert gefunden.
- **BoD:** 12×19 cm (Taschenbuch) - Beschnitt 5 mm.

tredition bietet aktuell keine öffentlich gelistete feste Formatauswahl
(freie Formatwahl bis DIN A4) und ist deshalb noch nicht enthalten. Bei
epubli und BoD fehlen öffentliche Rand-/Beschnittangaben für einzelne
Werte - vor einer echten Bestellung lohnt sich ein Blick in die jeweils
aktuelle Vorlage des Anbieters. Anbieter und Format bleiben am Buch
gespeichert.

„Vorschau ansehen" zeigt bei gewähltem Anbieter/Format eine druckgenaue
Seite in echter Größe (Seiten-Maß, Ränder), jedes Kapitel beginnt beim
Druck auf einer neuen Seite. Die Ränder nutzen bei KDP die offiziell
bestätigte, seitenzahl-abhängige Tabelle (Innenrand/Bundsteg wächst mit
der geschätzten Seitenzahl des Buchs), bei epubli die veröffentlichten
Empfehlungswerte. BoD veröffentlicht keine Randwerte - dort ein sicherer,
aber nicht offiziell bestätigter Platzhalter, mit deutlichem Hinweis in
der Vorschau. Die Seitengröße nutzt bewusst das reine Trimm-Maß ohne
Beschnittzugabe (relevant nur bei randabfallenden Bildern, die es aktuell
nicht gibt). Die Bildschirm-Vorschau zeigt eine vereinfachte Einzelseite;
beim echten Drucken/PDF-Export wechselt der Bundsteg über
`@page :left`/`:right` korrekt zwischen linker und rechter Seite.

Zusätzlich lassen sich Autor/in und ein Impressum-/Copyright-Text
hinterlegen (beide optional). Die Titelseite zeigt Titel, Untertitel und
Autor/in. Ist Autor/in oder ein eigener Impressum-Text gesetzt, folgt eine
eigene Impressum-Seite (leerer Text erzeugt automatisch „© [Jahr]
[Autor/in]") - ohne beides bleibt diese Seite ganz weg, statt eine
halbleere Seite einzufügen.

Beim echten Drucken/PDF-Export bekommt jede Seite außer der Titelseite
unten mittig eine laufende Seitenzahl (über `@page`-Randboxen, derselbe
Mechanismus wie die Ränder) - wie bei gedruckten Büchern üblich beginnt
die Zählung nicht sichtbar auf der Titelseite selbst. Die
Bildschirm-Vorschau zeigt (wie schon erwähnt) nur eine vereinfachte
Einzelseite ohne Seitenumbrüche und damit auch ohne sichtbare
Seitenzahlen - das lässt sich aber schon jetzt im Browser-Druckdialog
(Strg+P, danach „Abbrechen") mit echter Seitenaufteilung prüfen, ganz
ohne etwas zu drucken oder zu speichern.

Bei gewähltem Format erscheint in der Vorschau der Knopf „🖨️ Drucken /
Als PDF speichern" - öffnet den Browser-Druckdialog, dort lässt sich
„Als PDF speichern" wählen. Das Cover lässt sich unabhängig davon über
„⬇️ Cover herunterladen" (in der Buch-Bearbeitung, nur am PC, sobald ein
Cover hochgeladen ist) als eigene Bilddatei herunterladen - in der
tatsächlich hochgeladenen Auflösung, ohne Qualitätsverlust, und getrennt
von der Innentext-Datei, weil der Umschlag beim Anbieter ohnehin separat
hochgeladen wird.

Die Leiste mit „← Zurück zur Bearbeitung" und „🖨️ Drucken" bleibt beim
Scrollen durch lange Bücher oben am Bildschirm sichtbar (sticky), statt
beim Lesen aus dem Blick zu wandern. Beim echten Drucken/PDF-Export
werden App-Menü und diese Bedienleiste automatisch ausgeblendet - im
Ausdruck erscheint nur das Buch selbst.

### Phase 7: Bilder im Buch & Cover-Wrap (nur am PC)

Für Bücher mit Bildern soll die Autorin sich nicht mit Beschnitt/Pixel-
Mathematik befassen müssen: Sie gestaltet Bilder extern (z. B. in Canva)
in einer von der App berechneten Größe und lädt sie danach nur noch hoch -
die App übernimmt Zuschnitt und exakte Platzierung.

Erklärtexte zu ISBN-Fläche, Rücken-Text-Schwelle und was der
Download-Knopf tut stehen nicht mehr dauerhaft im Umschlag-Bereich,
sondern hinter dem Info-Knopf (ⓘ) neben der Überschrift „Umschlag
(Cover) für den Druck" - hält den Bereich ruhig, für alle, die die
Hinweise nach der ersten Nutzung nicht mehr brauchen.

**Stufe 1 (umgesetzt):** In der Buch-Bearbeitung zeigt „🎨 Umschlag (Cover)
für den Druck" die fertige Gesamtgröße des durchgehenden Covers (Rückseite
+ Buchrücken + Vorderseite + Beschnitt) als Maß in mm und als Pixelgröße
bei 300dpi - abhängig vom gewählten Anbieter/Format und der geschätzten
Seitenzahl des Buchs. Breite und Höhe haben je einen eigenen
Kopieren-Knopf (nicht gemeinsam als ein Text), weil Canvas „Eigene
Größe"-Dialog dafür zwei getrennte Eingabefelder hat.

- **Rückenbreite:** Bei KDP offiziell bestätigte, papierabhängige Formel
  (Seitenzahl × Papierstärke-Faktor; wählbar zwischen Weiß/Cream/Farbe
  Standard/Farbe Premium, je nachdem ob das Buch schwarzweiß oder farbig
  gedruckt wird). Bei BoD/epubli gibt es keine öffentlich exakte Formel,
  nur eine allgemeine Branchen-Faustformel als Schätzwert - dort mit
  deutlichem Hinweis, vor der Bestellung den anbietereigenen Cover-Rechner
  zu nutzen.
- **ISBN-/Barcode-Fläche:** Bei KDP bestätigt 5,1 × 3,1 cm unten rechts auf
  der Rückseite frei/hell zu lassen (Amazon druckt den Barcode automatisch
  hinein - kein eigener Barcode nötig). Bei anderen Anbietern ein
  allgemeiner Hinweis, da die genaue Fläche dort variiert.
- Bei sehr dünnen Büchern (unter ca. 100 Seiten) druckt KDP möglicherweise
  keinen Text auf den schmalen Buchrücken - die App weist bei Bedarf
  entsprechend darauf hin.

**Stufe 2 (umgesetzt):** Direkt darunter kann ein Umschlag-Hintergrundbild
hochgeladen werden. Die App schneidet es automatisch randlos auf die
berechnete Gesamtgröße zu (per `object-fit: cover`) - die Autorin muss das
Bild nicht selbst pixelgenau zurechtschneiden. Eine Vorschau zeigt das
eingepasste Bild sowie einen markierten Streifen für den Buchrücken, damit
dort nichts Wichtiges (z. B. Gesichter) landet. Das Bild kann jederzeit
ausgetauscht oder entfernt werden. Ein Klick auf die Vorschau öffnet sie
vergrößert (samt Rücken-Markierung/-Text).

**Stufe 3 (umgesetzt):** Autor/in und Titel erscheinen automatisch (senkrecht,
von unten nach oben lesbar - Kopf zum Lesen nach links geneigt, wie bei den
meisten deutschen Taschenbüchern im Regal üblich, unten der Name, darüber
der Titel) im Buchrücken-Streifen der Vorschau - die App setzt den Text
selbst, dafür ist in Canva nichts zu gestalten. Das erscheint erst, sobald
der Rücken auch optisch breit genug für einen hochwertig wirkenden Text ist
(bei KDP ab 200 Seiten - technisch druckt KDP zwar oft schon ab ca. 100
Seiten, siehe Hinweis dort, wirkt bei so wenig Rückenbreite aber gedrängt;
bei anderen Anbietern ab einer generischen Mindestbreite). Ein zu langer
Titel wird in der Vorschau abgeschnitten (…) statt überzulaufen - ein
Hinweis, ihn ggf. zu kürzen. Die Textfarbe lässt sich frei wählen (Farbwahl
plus Hexcode-Eingabefeld), da Weiß nicht zu jedem Umschlagbild passt. Ein
Klick auf die Vorschau öffnet sie vergrößert.

**Stufe 4 (umgesetzt):** Die ISBN-/Barcode-Fläche wird bei Amazon KDP direkt
in der Vorschau als gestricheltes Feld unten rechts auf der Rückseite
markiert (5,1 × 3,1 cm, offiziell bestätigt). Bei anderen Anbietern gibt es
dafür keinen öffentlich bestätigten Wert - dort bleibt es bewusst beim
allgemeinen Text-Hinweis, statt eine falsche Genauigkeit vorzugaukeln.

„⬇️ Umschlag herunterladen" setzt Hintergrundbild (randlos zugeschnitten)
und Rücken-Text (falls vorhanden) zu einer fertigen PNG-Datei in exakt der
berechneten Zielgröße zusammen - bereit zum Hochladen beim Anbieter. Die
Buchrücken-/ISBN-Markierungen aus der Vorschau erscheinen dabei bewusst
nicht mit in der Datei, die sind nur zur Orientierung gedacht.

Weitere Stufen (Innenbild-Platzhalter mit Layout-Auswahl,
Formatwechsel-Schutz, Umschlag als fertige Datei herunterladen) folgen.

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
