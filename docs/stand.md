# Stand und nächster Schritt

**Letzter Arbeitstag: 2026-09-14**

## 2026-09-14: Repo öffentlich, Git-Historie bereinigt

Der Abschnitt „Vor einer Veröffentlichung auf GitHub" weiter unten ist damit
**erledigt** - Niki wollte das Projekt heute vorzeigbar machen, nicht erst
"irgendwann". Was passiert ist:

- **Persönliche Daten aus dem Code ausgelagert:** `seed-profil.ts` enthielt
  Name, Adresse, Schule und Geburtsdatum im Klartext. Stehen jetzt in
  `engine/src/profil-daten.ts` (ungetrackt, siehe `.gitignore`), Vorlage dafür
  ist `profil-daten.example.ts`. Nebenbei: `env.cvPath` und der
  Mail-Anhang-Dateiname hatten Nikis Namen fest verdrahtet, jetzt generisch
  über `CV_PDF_PATH` gelöst.
- **Git-Historie neu gestartet:** kein `git-filter-repo` zur Hand (bräuchte
  Python/pip), deshalb der in stand.md bereits genannte Alternativweg: alle 24
  alten Commits (enthielten in älteren Versionen von `seed-profil.ts` und
  dieser Datei die volle Adresse, Telefonnummer und das Geburtsdatum) durch
  einen einzigen frischen Commit ersetzt und mit `--force` gepusht. Die alte
  Historie ist damit unwiederbringlich weg - genau das war der Zweck.
- **Actions-Logs geprüft, bevor auf Public umgestellt wurde:** alle drei
  bisherigen Workflow-Läufe nach Namen/Adresse/Telefonnummer/Geburtsdatum/
  E-Mail durchsucht. Einziger Fund: einmal schreibt das Modell in einer
  „Vor dem Abschicken prüfen"-Anmerkung den Vornamen „Nikolaus" (kein
  Nachname) - unbedenklich, der GitHub-Account heißt ohnehin `nikiweikhart`.
  Die Bildschirmfoto-Artefakte zeigen nur die öffentlichen Jobportal-Seiten
  und laufen nach 7 Tagen automatisch ab (`retention-days: 7` in `motor.yml`).
- **Repo auf GitHub von Niki selbst auf Public umgestellt**
  (`github.com/nikiweikhart/apply-ai`), inklusive GitHubs eigener
  E-Mail-Bestätigung dafür.
- **Nebenbei einen echten Bug gefunden und behoben:** `motor.yml` ruft
  `npm run freigabe` vom Projekt-Root auf, das Root-`package.json` kannte das
  Script aber nicht - deshalb schlug der Telegram-Freigabe-Schritt bei jedem
  Motor-Lauf fehl (`npm error Missing script`). Gleiches Muster fehlte für
  `anschreiben`, `antwort` und `anmelden`, alle vier jetzt nachgetragen.
- **README aktualisiert:** die alte "Projekt ist privat, bis..."-Zeile ist
  raus, dafür ein Hinweis, wie ein Fremder das Projekt für sich selbst mit
  eigenen Daten einrichtet (`profil-daten.example.ts` kopieren).

**Das Supabase-Projekt ist wach** - der geplante Lauf am 2026-09-14, 05:00 UTC
(Motor #3) kam bis zum Bewerter und Writer durch (186 Anzeigen bewertet, drei
neue Anschreiben). War es zuvor mal eingeschlafen (Gratis-Projekte schlafen
nach etwa einer Woche ohne Zugriff ein): [supabase.com/dashboard](https://supabase.com/dashboard)
öffnen → Projekt anklicken → **Restore project** → ein bis zwei Minuten
warten → `npm run check`.

## Was fertig ist

**Phase 0 — Vorbereitung** ✅
- Anthropic-Schlüssel, 5 $ Guthaben als harte Kostenbremse
- Supabase-Projekt, alle 6 Tabellen
- Lebenslauf als PDF unter
  `C:/Users/nikiw/OneDrive/Dokumente/Samstagsjob/Lebenslauf_Nikolaus_Weikhart.pdf`

**Phase 1 — Fundament** ✅
- TypeScript, Node 24 (führt `.ts` direkt aus, kein Build nötig)
- `npm run check` läuft grün durch
- 6 Portale in der Datenbank (`npm run seed`)

**Phase 2 — Scout** ✅
- `lib/browser.ts` — echter Chrome, höfliche Pausen, Cookie-Banner ablehnen,
  Sperren erkennen und abbrechen statt umgehen
- `adapters/hokify.ts`, `adapters/willhaben.ts`, `adapters/studentjob.ts`,
  `adapters/karriere.ts`, `adapters/indeed.ts`, gemeinsame Helfer in
  `adapters/hilfen.ts`
- `adapters/ams.ts` ist fertig gebaut, aber **bewusst nicht zugeschaltet**
  (Nikis Entscheidung). Zum Aktivieren: in `agents/scout.ts` importieren und
  in die Liste `ADAPTER` eintragen — zwei Zeilen.
- `agents/scout.ts` — Portale aus der Datenbank, Fingerabdrücke, nur Neues
- Sichtbarer Browser (`HEADFUL=1`) von Niki getestet ✅

**Phase 3 — Bewerter** ✅ (bis auf die offenen Punkte unten)
- `lib/jugendschutz.ts` — Vorfilter im Code
- `agents/score.ts` — Bewertung 0 bis 100 mit Haiku 4.5, festes Antwortformat
- `seed-profil.ts` — Nikis Profil und Regeln in der Datenbank
- `treffer-zeigen.ts` — Trefferliste im Terminal
- `.github/workflows/motor.yml` — Zeitplan, **noch nicht scharf geschaltet**

**Phase 4 — Explorer** ✅ (2026-08-30)
- `lib/abriss.ts` — fasst eine fremde Seite auf rund 2.000 Zeichen zusammen:
  welche Links nach Anzeigen aussehen, welche Kästen sich wiederholen, welche
  Kennzeichnungen es gibt. Rechnet nur, entscheidet nichts.
- `agents/explorer.ts` — Haiku 4.5 sucht anhand des Abrisses die
  Anhaltspunkte, der Vorschlag wird sofort auf der echten Seite ausprobiert.
  Klappt es nicht, gibt es **genau einen** zweiten Versuch mit dem Grund als
  Rückmeldung, dann ist Schluss.
- `agents/scout.ts` — springt von selbst in den Notbetrieb, wenn ein Adapter
  einen `AdapterFehler` wirft. Bei einer **Sperre** nicht: da hilft kein
  zweiter Anlauf, und das Portal soll nicht angerempelt werden.
- Alle Adapter haben jetzt `suchadressen()`. Die Suchadresse überlebt einen
  Umbau fast immer — die Anhaltspunkte darin nicht. Genau deshalb reicht der
  Adapter beim Scheitern seine Adressen an den Explorer weiter.

**Wie der Notbetrieb sich meldet:** Das Portal bleibt auf `adapter_broken`,
auch wenn Anzeigen ankamen — der Notbetrieb kostet Geld und Zeit und soll
nicht unbemerkt zum Dauerzustand werden. Auf dem Bildschirm und im Protokoll
steht danach eine fertige Bauanleitung für die Reparatur des Adapters.

**Der Test dazu** (Phase 4 verlangt ihn ausdrücklich):

```
npm run scout hokify 3 kaputt
```

`kaputt` übergeht den Adapter, als hätte das Portal über Nacht alles
umgebaut. Ergebnis am 2026-08-30:

| Portal | gefunden | Kachel, die der Explorer selbst fand | Kosten |
|---|---|---|---|
| hokify | 13 Anzeigen, 3 gelesen | `[data-cy="jobList"]` | 1,03 ¢ |
| karriere.at | 15 Anzeigen, 2 gelesen | `div.m-jobsListItem` | 0,70 ¢ |

Beide Male stimmten Firma, Ort mit Postleitzahl, Anstellungsart und
Mailadresse. Zwei der so gefundenen Anzeigen landeten anschließend mit 78
Punkten in der Trefferliste. Danach lief ein normaler Lauf über alle vier
Portale sauber durch — die Adapter selbst sind unberührt.

**Was der Notbetrieb kostet:** rund 0,2 ¢ pro Anzeige, weil jede Detailseite
einmal an Haiku geht. Ein normaler Lauf kostet nichts. Bei 15 Anzeigen sind
das etwa 3 ¢ — vertretbar für ein paar Tage, nicht für ein paar Monate.

### Stand der Daten (2026-08-30)

96 Anzeigen aus vier Portalen, alle bewertet: 16 im Vorfilter aussortiert,
1 über 80 Punkten, der Rest darunter.
Bester Treffer unverändert: **WEIN & CO, Samstagskraft im Verkauf, Wien,
geringfügig, 82 Punkte.**

Gesamtkosten aller Bewertungen bisher: rund **52 US-Cent**.

### Schwelle für die Vollautomatik: 70 statt 80 (2026-08-30)

Nikis Entscheidung. Grund: Bei 80 stand nach 96 gelesenen Anzeigen genau **eine**
in der Vollautomatik — der Bot hätte praktisch nie von selbst geschrieben. Bei 70
sind es **23**. Der Wert steht in `settings.auto_send_min`; `npm run profil` setzt
ihn auf denselben Stand zurück.

Was sich damit ändert, ehrlich benannt — nachzuprüfen, sobald Phase 7 läuft:

- **Doppelte Bewerbungen sind jetzt möglich.** In den 23 stecken dreimal
  „Mitarbeiter Service in Teilzeit" und dreimal „Mitarbeiter Küche in Teilzeit",
  alle von McDonald's an verschiedenen Standorten. Der Fingerabdruck aus Firma +
  Titel + **Ort** hält sie auseinander, weil der Ort verschieden ist. Bei 80 fiel
  das nicht auf, bei 70 hieße das sechs Bewerbungen an eine Kette. **Vor Phase 7
  zu lösen:** entweder pro Firma nur die beste Anzeige, oder eine Sperrfrist
  (z. B. eine Bewerbung pro Firma alle 30 Tage).
- **Die Mischung wird breiter.** Im 72er-Bereich stehen auch Anzeigen, die Niki
  vermutlich nicht will (Winterdienst, Promotion-Agenturen). Nichts davon ist
  rechtlich unmöglich, der Vorfilter greift also zu Recht nicht — aber der
  Testlauf aus Phase 7 (alle Bewerbungen gehen zuerst an Nikis eigene Adresse)
  wird damit umso wichtiger.
- **Der 78er-Bereich ist inhaltlich gut**: Samstagsjobs im Verkauf bei HOFER,
  Guess, Grüne Erde, Fabasoft. Die offene Frage der KI lautet dort meist „klär den
  genauen Arbeitstag" — genau das klärt ein Gespräch, nicht ein Nichtbewerben.

## Phase 6, erster Teil — der Writer (2026-09-07, Modell am selben Tag gewechselt)

`engine/src/agents/write.ts` steht. Er nimmt die bewerteten Anzeigen ab der
Rückfrage-Schwelle (60), geht sie von oben nach unten durch und lässt ein
Modell zu jeder ein Anschreiben schreiben — Betreff, Brieftext und eine Zeile
„das solltest du vor dem Abschicken prüfen". Das Ergebnis landet in der
Tabelle `applications` mit Status `draft`.

**Der Writer verschickt nichts und gibt nichts frei.** Er legt Entwürfe ab,
mehr nicht. Das ist Absicht: solange die Telegram-Freigabe fehlt, soll kein
Brief einen Zustand erreichen, aus dem ihn Phase 7 versehentlich abschickt.

Standardmäßig schreibt er **drei** Anschreiben pro Aufruf, nicht alles was da
ist — nicht mehr primär wegen der Kosten (siehe unten), sondern weil jeder
Aufruf ein echter KI-Aufruf ist und die Qualität einen Blick verdient, bevor
mehr geschrieben wird.

### Modellwechsel: Opus 5 raus, nur noch Sonnet 5 (2026-09-07)

Der erste Entwurf lief mit Opus 5, 3–5 US-Cent pro Anschreiben. Ein Vergleich
zur selben Anzeige (WEIN & CO, 82 Punkte, mit beiden Modellen geschrieben)
zeigte: **Sonnet 5 war mindestens gleichwertig, kostete unter ein Zehntel**
(1,3 Cent im echten Lauf) — und Opus hatte einen echten Mangel: es schrieb das
komplette Anschreiben ohne Umlaute (`fuer`, `Ueber`, `Gruessen` statt
`für`/`Über`/`Grüßen`), was in einer Bewerbung veraltet wirkt. Sonnet schrieb
im selben Test durchgehend korrekt. Nikis Entscheidung: Opus raus, nur noch
Sonnet 5. `lib/env.ts` -> `MODELS.good` steht jetzt auf `claude-sonnet-5`, und
die Anweisung in `write.ts` verlangt jetzt ausdrücklich echte Umlaute statt
ae/oe/ue — als Absicherung, falls das Modell noch einmal wechselt.

**Lektion für spätere Modellvergleiche:** ein kaputt aussehender Umlaut im
Terminal ist nicht automatisch ein API-Fehler — beim ersten Testlauf sah die
Ausgabe von Opus im Terminal völlig zerschossen aus (Buchstabensalat mitten im
Wort), das lag aber nur an der Terminal-Anzeige. Direkt in eine Datei
geschrieben und von dort gelesen, war der Text sauber (nur eben ohne Umlaute).
Bei Encoding-Verdacht immer erst in eine Datei schreiben und die Datei lesen,
nicht der Terminalausgabe trauen.

### Die Firmensperre — der offene Punkt von 2026-08-30 ist erledigt

`engine/src/lib/firma.ts`: **pro Firma höchstens eine Bewerbung in 30 Tagen.**
Sie greift an zwei Stellen — gegen Bewerbungen, die schon in der Datenbank
stehen, und gegen Doppelte innerhalb desselben Laufs. Sonst hätte
`npm run write 6` doch wieder sechs Briefe an dieselbe Kette geschickt.

Der Vergleich räumt den Namen auf (Rechtsform, Ort, Hausnummer, Akzente weg)
und hält zwei Firmen für dieselbe, wenn das erste tragende Wort übereinstimmt.
Er ist absichtlich eher großzügig, weil die beiden Fehler ungleich schwer
wiegen: zu viel gesperrt heißt, eine Anzeige bleibt liegen — zu wenig gesperrt
heißt, sechs Briefe sind draußen und nicht mehr zurückzuholen.

Eine Falle steckte darin: Wien ist voll mit Firmen, deren Name mit einem
Branchenwort anfängt. „Cafe Central" und „Cafe Ritter" wären beim ersten
Entwurf dieselbe Firma gewesen. Deshalb fliegen `cafe`, `bäckerei`,
`gasthaus`, `apotheke` und dreißig weitere solche Wörter vorher raus. Genau
das prüft `npm test` — 13 echte Wiener Firmennamen mit dem erwarteten Urteil,
ohne Internet, ohne Datenbank, ohne KI.

**Ein zweiter Fehler kam erst beim echten Betrieb zum Vorschein (2026-09-07):
Selbstsperre.** `npm run write nochmal 1` sollte die beste Anzeige (WEIN & CO)
neu schreiben, wurde aber von der Firmensperre übersprungen — durch ihre
eigene, bereits bestehende Bewerbung zu genau dieser Anzeige. Die gesperrten
Firmen wurden aus ALLEN bestehenden Bewerbungen gebildet, ohne die gerade neu
zu schreibende Anzeige selbst auszunehmen. Fix: `gesperrteFirmen` trägt jetzt
die `job_id` mit und wird pro Kandidat um dessen eigene ID gefiltert.

### Phase 6, zweiter Teil — Telegram-Freigabe ✅ gebaut (2026-09-07)

Niki hat seinen Bot bei @BotFather angelegt (`@Niki_ApplyAI_bot`) und mir
Token und Chat-ID gegeben — Chat-ID musste nicht manuell rausgesucht werden,
sondern kam automatisch aus `getUpdates`, nachdem er dem Bot einmal
geschrieben hatte.

`lib/telegram.ts`: duenne Huelle um drei Telegram-Aufrufe (`sendMessage`,
`getUpdates`, `answerCallbackQuery`) — bewusst ohne SDK, die HTTP-API ist
simpel genug.

`agents/write.ts` schickt jetzt **sofort** nach jedem fertigen Anschreiben
eine Telegram-Nachricht mit zwei Knöpfen (**Freigeben** / **Ablehnen**) und
setzt den Status auf `pending_approval` — nur wenn der Versand klappt; sonst
bleibt es `draft` und `npm run freigabe` holt es nach.

`agents/freigabe.ts` (`npm run freigabe`) macht zwei Dinge: liegengebliebene
Entwürfe nachschicken, und Knopfdrücke abholen (`getUpdates`) und in
`applications.status` eintragen (`approved` / `rejected`). Kein
Datenbank-Feld für den Telegram-Update-Zähler nötig: unbestätigte Updates
werden am Ende jedes Laufs per `offset` bei Telegram als erledigt markiert,
und ein Knopfdruck auf eine schon bearbeitete Anzeige wird sauber ignoriert
(idempotent) — doppeltes Verarbeiten kann also nichts kaputt machen.

**Was absichtlich noch fehlt:** "Freigabe stößt den Motor sofort an" aus dem
Bauplan. Dafür bräuchte es entweder einen Telegram-Webhook (braucht eine
öffentliche Adresse — kommt erst mit Phase 5/Vercel) oder einen laufenden
Zeitplan, der `npm run freigabe` regelmäßig aufruft (der GitHub-Actions-
Zeitplan ist seit 2026-08-30 bewusst aus). Bis dahin: nach dem Draufdrücken
auf dem Handy kurz Bescheid geben, dann wird's abgeholt. Und: Phase 7 (Mail-
Versand) existiert noch nicht — `approved` heißt bisher nur "wartet", nicht
"ist raus".

### Profil korrigiert (2026-09-07)

Der erste echte Test zeigte eine ungenaue Stelle im Anschreiben: „Realgymnasium
GRG 23 in Wien-Liesing" — Niki wollte es genauer. Die Schule ist **GRG 23,
Anton-Baumgartner-Straße, nahe Alt-Erlaa**. Dabei auch gleich seine Adresse
aufgenommen (Details in `seed-profil.ts`, nicht hier wiederholt - siehe
Hinweis zur Veröffentlichung weiter unten) — die Anweisung in `write.ts`
verbot bisher pauschal jede Adressangabe, weil keine bekannt war; jetzt darf
sie verwendet werden, aber nur wenn die Anzeige eine postalische Bewerbung
verlangt, nicht automatisch in jedem kurzen Portal-Anschreiben.
`npm run profil` neu ausgeführt, die beiden bestehenden Entwürfe (WEIN & CO,
McDonald's) mit `npm run write nochmal` neu geschrieben.

### Was noch fehlt, ehrlich

- **`settings.cover_template` ist weiterhin leer.** Kein Hindernis: Sonnet
  schreibt ohnehin auf die konkrete Anzeige bezogen, und das erste gute
  Anschreiben wird die Vorlage.

Beide wartenden Entwürfe (WEIN & CO, McDonald's) hat Niki noch am selben Tag
über die Telegram-Knöpfe freigegeben — `npm run freigabe` hat den ersten
echten Knopfdruck verarbeitet, beide stehen jetzt auf `approved`.

## Phase 7 — Mail-Versand: Senden gebaut (2026-09-07)

`lib/mailer.ts` (nodemailer) + `agents/mail.ts` (`npm run mail`). Nimmt alles
mit Status `approved` und Weg `mail`, hängt den Lebenslauf an und verschickt.

**Zwei Sicherheitsnetze, beide standardmäßig an, beide müssen extra
ausgeschaltet werden, bevor irgendwas Echtes bei einer Firma ankommt:**

1. `DRY_RUN` (gab es schon seit Phase 1, war bisher nur für den Browser
   gedacht) — solange an, wird nichts verschickt, nur gezeigt was passieren
   würde.
2. `MAIL_TEST_MODE` (neu) — solange an, geht jede Mail an `MAIL_ADDRESS`
   selbst statt an die Firma, mit einem Hinweis im Betreff, an wen es in
   echt gegangen wäre. Genau die "Testwoche" aus dem Bauplan.

Nebenbei aufgeräumt: der Lebenslauf-Pfad stand dreimal fast wortgleich in
`check.ts` und `seed-profil.ts` — jetzt einmal in `lib/env.ts`
(`env.cvPath`), beide Stellen greifen darauf zu.

**Zugangsdaten eingerichtet, noch am selben Tag (2026-09-07).** Niki hat 2FA
angeschaltet und ein Gmail-App-Passwort für `niki.weikhart@gmail.com` erstellt
(App-Name „ApplyAI"). `MAIL_ADDRESS`/`MAIL_APP_PASSWORD` stehen in der `.env`.

**Dabei ein echter Absturz gefunden und behoben, unabhängig vom Mail-Code:**
`npm run mail` stürzte beim ersten Testlauf ab (`Assertion failed:
!(handle->flags & UV_HANDLE_CLOSING)`) — ein bekannter Node/libuv-Fehler unter
Windows: `process.exit()` beendet den Prozess sofort, während eine offene
Supabase-Verbindung noch am Schließen ist. Reproduziert sogar mit einer
einzelnen Datenbankabfrage + `process.exit(0)`, ganz ohne Mail-Code — betraf
denselben Codepfad in sieben weiteren Skripten (`score.ts` ×2, `write.ts` ×2,
`scout.ts`, `freigabe.ts`, `anschreiben-zeigen.ts`), überall dort, wo ein
früher Erfolgs-Ausstieg direkt nach einer Datenbankabfrage kam. Alle acht
Stellen gefixt — je nach Lage im File entweder die Prüfung ohne `exit`
stehen gelassen (der Rest wäre über eine leere Liste sowieso folgenlos
gelaufen) oder mit `if`/`else` bzw. einem markierten Block (`break`)
umschlossen, wo sonst noch eine zweite Zusammenfassung gedruckt oder — bei
`scout.ts` — unnötig ein Playwright-Browser gestartet worden wäre. Drei
Wiederholungen von `npm run mail` und ein Lauf von `npm run freigabe`
bestätigen: kein Absturz mehr, exit code 0.

**Erster Dry-Run mit echten Zugangsdaten: 0 Bewerbungen per Mail versandbereit
— das ist richtig, kein Fehler.** Beide bisher freigegebenen Anzeigen (WEIN &
CO, McDonald's) haben keine Firmen-Mailadresse gefunden (`contact_email:
null`), stehen also auf Weg `portal` statt `mail` — die brauchen Phase 8
(Browser-Bewerbung), nicht den Mail-Agenten. Der erste echte Mailversand
steht also noch aus, sobald eine Anzeige mit hinterlegter Mailadresse
freigegeben wird.

**Antwort-Erkennung per IMAP ✅ gebaut am 2026-09-13** (`agents/antwort.ts`,
`npm run antwort`) - der zuletzt fehlende Teil von Phase 7. Nimmt jede
Bewerbung mit Status `sent` und leerem `reply_status`, sucht im Posteingang
(`imapflow`, dasselbe Konto wie beim Versand) nach Mails seit dem
Versandzeitpunkt, die entweder von der Firmendomain aus `contact_email`
kommen oder den ersten tragenden Firmennamen im Betreff tragen (dieselbe
Art Vergleich wie bei der Firmensperre in `lib/firma.ts`, nur einfacher).
Findet sich eine, liest Haiku 4.5 den Text- oder HTML-Teil der Mail und
ordnet sie in `einladung` / `absage` / `rueckfrage` / `sonstiges` ein -
bei einer Einladung sofort eine Telegram-Meldung, genau wie im Bauplan
vorgesehen. Rein lesend: nichts wird verschickt, gelöscht oder verschoben.
Noch nicht real getestet - es gibt noch keine einzige Bewerbung mit Status
`sent` (siehe „Projekt fertigmachen" oben), ein `npm run antwort` bestätigt
aber schon den leeren Fall sauber (0 Kandidaten, kein IMAP-Verbindungsaufbau
nötig).

## Befehle

```
npm run check                    alles verbunden?
npm test                         Firmensperre prüfen (kein Internet nötig)
npm run seed                     Portalliste in die Datenbank
npm run profil                   Nikis Profil und Regeln in die Datenbank

npm run scout                    alle Portale mit fertigem Adapter
npm run scout hokify 5           nur hokify, höchstens 5 neue Anzeigen
npm run scout willhaben frisch   auch Bekanntes neu lesen und aktualisieren
npm run scout hokify 3 kaputt    Adapter übergehen, Explorer prüfen (kostet)

npm run score                    alle noch unbewerteten Anzeigen
npm run score trocken            nur den Vorfilter zeigen, kostet nichts
npm run score nochmal            alles neu bewerten (überschreibt)

npm run write                    Anschreiben zu den 3 besten offenen Anzeigen
npm run write 1                  nur eines (zum Anschauen, ~1 Cent mit Sonnet)
npm run write trocken            nur zeigen, wer drankäme — kostet nichts
npm run write nochmal            vorhandene Anschreiben neu schreiben
npm run write ohnesperre         Firmensperre außer Kraft (bewusst, selten)

npm run freigabe                 liegengebliebene Entwürfe nachschicken + Telegram-Knopfdrücke abholen

npm run mail                     freigegebene Bewerbungen verschicken (DRY_RUN/MAIL_TEST_MODE beachten!)

npm run antwort                  im Postfach nach Firmenantworten suchen (nur lesend)
npm run antwort trocken          nur zeigen was gefunden wuerde, kein KI-Aufruf

npm run jobs                     gefundene Anzeigen ansehen
npm run treffer                  bewertete Anzeigen, beste zuerst
npm run anschreiben              fertige Anschreiben lesen
npm run anschreiben kurz         nur die Liste, ohne die Brieftexte
npm run untersuchen "<adresse>"  Seitenaufbau eines neuen Portals ansehen
```

Keine Striche vor den Angaben — npm schluckt `--max 5` selbst auf.

**Zuschauen:** `HEADFUL=1` in der `.env` öffnet ein Chrome-Fenster.
`SHOTS=1` legt von jeder Seite ein Bildschirmfoto in `engine/screenshots/` —
der einzige Weg zu sehen, was nachts in GitHub Actions passiert.

⚠ **Playwright lädt zwei getrennte Browser.** `npm install` holt nur die
fensterlose Fassung. Für `HEADFUL=1` einmalig nachinstallieren, sonst kommt
`spawn UNKNOWN`:

```
npx playwright install chromium
```

## Wie der Vorfilter gedacht ist

Der erste Entwurf durchsuchte den ganzen Anzeigentext nach Stichworten wie
„40 Stunden" oder „Nachtdienst" — und warf 21 von 28 Anzeigen weg, darunter
„Friseur:in für 20 Stunden" (weil irgendwo „40 Stunden" stand) und
„Büromitarbeiter TEILZEIT STUDENTENJOB ab 15h" (wegen „38,5h" an anderer
Stelle). Also genau die Jobs, die gesucht sind.

Daraus die Regel: **eine Bewertung kostet 0,1 Cent — der Filter spart also
kaum Geld.** Sein einziger Zweck ist, rechtlich Unmögliches und Nikis eigene
No-Gos abzufangen. Alles Weiche entscheidet die KI, die den Zusammenhang sieht.

Jetzt greift er nur bei:
- ausdrücklichen Altersgrenzen im Text („ab 18 Jahren", „volljährig")
- Berufen im **Titel**, die unter 18 nicht gehen (Security, Ordner, Schweißen,
  Stapler, LKW)
- reinen Vollzeitstellen, erkannt am Feld „Anstellungsart" des Portals
- Nikis Ausschlussliste aus `settings.exclusions`, ebenfalls nur im Titel

**Geburtsdatum ist hinterlegt: 3. Juli 2009.** Niki ist also 17 und wird am
**3. Juli 2027** volljährig. Ab diesem Tag lässt der Filter die
Jugendschutz-Regeln von selbst weg und die Bewertung fällt bei Sonntagsstellen
höher aus — ohne dass jemand etwas umstellen muss.

Bewusst **nicht** gefiltert: Sonntagsarbeit. Unter 18 stark eingeschränkt, aber
Niki sucht ausdrücklich Samstag **oder** Sonntag. Die KI zieht dafür Punkte ab
und schreibt in den Hinweis, dass er es mit dem Arbeitgeber klären muss.

### Zwei Reparaturen am Vorfilter (2026-08-30)

Aufgefallen an einer Anzeige, die mit **78 Punkten** in der Rückfrage-Liste
stand, obwohl in ihrem Text „Über 18 Jahre" steht.

**1. `\b` kennt keine Umlaute.** Das Muster begann mit `\b(… |über 18 jahr| …)`.
In JavaScript zählt „ü" nicht als Wortzeichen, also gibt es zwischen einem
Zeilenumbruch und einem „Ü" **keine** Wortgrenze — der Ausdruck konnte gar
nicht greifen. Jetzt steht dort eine ausdrückliche Grenze über `\p{L}` mit dem
nötigen `u` am Ende. Merksatz: **`\b` niemals vor einem deutschen Umlaut.**

**2. „Erforderlich" ist nicht dasselbe wie „Von Vorteil".** hokify sortiert die
Anforderungen unter zwei Überschriften. Nach der ersten Reparatur flogen zehn
Anzeigen raus — bei zweien davon stand „Über 18 Jahre" aber unter *Von Vorteil
für diesen Job*, war also nur ein Wunsch. Das wäre genau der alte Fehler
gewesen: zu viel wegwerfen. Der Filter schaut jetzt zurück, welche der beiden
Überschriften zuletzt kam, und lässt Wünsche durch (`nurWunsch()` in
`lib/jugendschutz.ts`).

Ergebnis: 16 statt 12 Anzeigen im Vorfilter aussortiert. Vier bereits bewertete
Anzeigen wurden neu einsortiert, darunter zwei aus dem Rückfrage-Bereich
(72 und 78 Punkte) — die hätten sonst eine Bewerbung ausgelöst, für die Niki
zu jung ist.

## Geprüfte Anhaltspunkte der Portale (Stand 2026-08-25)

**hokify** — Adresse `hokify.at/jobs/m/<suchwort>/<ort>`

| Was | Wo |
|---|---|
| Trefferkachel | `div.post-link` |
| Titel + Adresse | `h2 a[href^="/job/"]` |
| Firma | `[data-cy="companyName"]` |
| Anstellungsart | `[data-cy^="employmentType"]` (fehlt oft → Rückfall auf Titeltext) |
| Nachladen | Knopf „LADEN" |

**willhaben** — Adresse
`willhaben.at/jobs/suche?employment_type=<nr>&location=Wien&region=14486`

| Was | Wo |
|---|---|
| Anstellungsart-Nummer | geringfügig `11796`, Teilzeit `113` |
| Region Wien | `14486` |
| Anzeigenlink | `a[href^="/jobs/job/<name>/<nummer>"]` |
| Firma | `[data-testid*="-company-name"]` **in der Trefferliste** — auf der Detailseite heißt der Firmenlink oft nur „Zum Firmenprofil" |
| Ort / Anstellung | `[data-testid="jobaddetail-jobdetails-employment-locations"]` / `-employment-mode` |
| Cookie-Banner | `#didomi-notice-disagree-button` |
| Blättern | `&page=2` — willhaben lädt **nicht** beim Scrollen nach |

**StudentJob.at** — fertige Kategorieseiten, kein Filter nötig

| Was | Wo |
|---|---|
| Kategorieseite | `/samstagsjob/wien`, Blättern über `/samstagsjob/wien/2` |
| Anzeigenlink | `a[href^="/stellenangebote/<nummer>-<name>"]` |
| Cookie-Banner | Knopf „ALLE ABLEHNEN" |
| Kategorien | `samstagsjob`, `nebenjob`, `ferialjob` — **`wochenendjob` gibt es nicht** |

⚠ **Qualitätswarnung StudentJob:** die Kategorie `nebenjob` ist voll mit
Umfrage-, Cashback- und Home-Office-Werbung. Beim ersten Lauf lagen alle fünf
bewerteten Anzeigen unter 40 Punkten — der Bewerter hat das sauber erkannt,
aber es kostet Geld. Falls das so bleibt: in `settings` bei StudentJob nur
noch die Kategorie `samstagsjob` eintragen.

**karriere.at** — Adresse `karriere.at/jobs/<suchwort>/<ort>`, wie hokify

| Was | Wo |
|---|---|
| Suchworte | `geringfuegig` (13 Stellen Wien), `samstagsjob` (2), `teilzeit` (487) |
| Anzeigenlink | `karriere.at/jobs/<nummer>` |
| Blättern | `?page=2` |
| Firma | `a[href*="karriere.at/f/"]` — **nicht** `/firmen`, das ist nur der Menüpunkt |
| Ort | beschrifteter Textblock „Dienstort" (ältere Anzeigen haben ihn nicht) |
| Anstellungsart | beschrifteter Textblock „Anstellungsart" |
| Cookie-Banner | keiner |

Kein Bot-Risiko festgestellt, entgegen der Einschätzung im Bauplan.

**Indeed AT** — gebaut, aber **von Indeed gesperrt**

Der Bauplan hat recht behalten. Die erste Suchseite kommt noch mit Code 200,
danach antwortet Indeed mit **403 (Zugriff verweigert)**. Zusätzlich verlangt
die Detailseite `/viewjob?jk=...` eine Anmeldung (401).

Der Adapter umgeht nichts davon: er liest den Anzeigentext aus der
Seitenansicht der Trefferliste (Parameter `vjk`) — dieselbe Ansicht, die auch
ein Mensch ohne Anmeldung sieht — und bricht bei 403 ab. Das Portal steht jetzt
in der Datenbank auf `blocked` und wird bei künftigen Läufen übersprungen.

Erneut versuchen (etwa nach ein paar Tagen, von einem anderen Netz aus):

```
npm run scout indeed
```

**Erneut geprüft am 2026-09-13: weiterhin 403, unverändert seit 2026-08-25.**
Selbst bei erneutem Versuch bleibt außerdem offen, dass es für Indeed noch
gar kein Niki-Konto gibt (siehe „Offene Punkte für Niki") - ohne Login geht
es bei einer Bewerbung ohnehin nicht weiter, das muss Niki selbst anlegen.

Ein ausdrücklich genanntes Portal wird auch dann angefasst, wenn es gesperrt
ist. Klappt es, setzt der Scout den Zustand von selbst wieder auf `ok`.

**AMS** (gebaut, nicht zugeschaltet) — Adresse
`jobs.ams.at/public/emps/jobs?location=Wien&WORKING_TIME=T&query=<wort>`
plus **fünfmal** `JOB_OFFER_TYPE` (`SB_WKO`, `IJ`, `BA`, `BZ`, `TN`).
Ohne diese fünf liefert AMS eine Fehlerseite — die Adresse aus dem Bauplan
funktioniert so nicht. AMS kennt kein „geringfügig", nur Vollzeit/Teilzeit.

## Was als Nächstes dran ist

**1. GitHub Actions scharf schalten** ✅ **erledigt am 2026-08-30, Zeitplan
seit 2026-09-13 wieder an** (siehe Abschnitt „Projekt fertigmachen" unten).
Projekt: `github.com/nikiweikhart/apply-ai`, **privat**. Die drei Secrets
(`ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`) sind eingetragen.
Erster Lauf von Hand: alle vier Portale besucht, 10 neue Anzeigen, alle
bewertet, 4 US-Cent.

**Zwei Dinge, die dabei zu lernen waren:**

⚠ **Die Playwright-Fassung muss an zwei Stellen dieselbe sein.** Der erste
Lauf brach ab mit `Executable doesn't exist`. In `engine/package.json` stand
`^1.56.0` — das Dach-Zeichen heißt „diese Version **oder jede neuere**", also
wurde 1.62.1 installiert. Das Docker-Abbild im Workflow war aber fest auf
1.56.0. Playwright sucht seinen Browser dann an einer Stelle, an der das
Abbild ihn nicht abgelegt hat. Lokal fällt das nie auf, weil dort ein eigener
Chromium liegt. Jetzt steht die Fassung **ohne `^`** fest auf 1.62.1, und im
Workflow steht ein Warnhinweis daneben. **Beim Aktualisieren von Playwright
immer beide Zahlen gemeinsam ändern.**

⚠ **Eingaben aus dem Workflow-Formular gehen über Umgebungsvariablen**
(`SCOUT_PORTAL`, `SCOUT_MAX`), nicht direkt in die Befehlszeile. Alles, was
GitHub mit `${{ }}` in eine `run`-Zeile einsetzt, würde die Shell als Befehl
mitlesen.

**2. Phase 6, erster Teil — Writer** ✅ **gebaut am 2026-09-07**, siehe oben.
Samt Firmensperre, damit nicht sechs Briefe an dieselbe Kette gehen — der
offene Punkt vom 2026-08-30 ist damit erledigt. Was noch aussteht: der erste
echte Lauf (braucht die geweckte Datenbank) und Nikis Urteil darüber, ob das
Anschreiben taugt.

**3. Phase 6, zweiter Teil — Telegram-Freigabe** ✅ **gebaut am 2026-09-07**,
siehe oben. Push bei jedem neuen Entwurf steht, Freigabe-Knopf steht, beide
ersten Entwürfe sind schon echt freigegeben worden. Was aus dem Bauplan
bewusst noch fehlt: die Freigabe stößt den Motor noch nicht von selbst an
(braucht Webhook oder Zeitplan, siehe oben) — bis dahin `npm run freigabe`
von Hand anstoßen, sobald auf dem Handy gedrückt wurde.

**4. Phase 7 — Mail-Versand** ✅ **Senden gebaut am 2026-09-07**, siehe oben.
Zwei Sicherheitsnetze (`DRY_RUN`, `MAIL_TEST_MODE`) stehen beide auf an, bis
Niki ein Gmail-App-Passwort besorgt und beides zusammen mit der Adresse
weitergibt. Antwort-Erkennung per IMAP fehlt noch — kein Blocker fürs Senden.

Neue Portale bauen geht weiterhin wie gehabt: `npm run untersuchen "<adresse>"`,
dann den Adapter nach dem Muster von `willhaben.ts` bauen und in `scout.ts`
eintragen. Neu ist nur: `suchadressen()` nicht vergessen, sonst steht der
Explorer im Notfall ohne Startadresse da.

## 2026-09-13: Writer weitergelaufen, Phase 8 als Gerüst gebaut

**Telegram-Knöpfe „gehen nicht" — sind aber normal.** Ohne Webhook/Zeitplan
beantwortet niemand die `callback_query`, solange `npm run freigabe` nicht
läuft — das Ladesymbol dreht sich einfach weiter. Kein Fehler, siehe die
Erklärung weiter oben bei Phase 6. Merkposten fürs nächste Mal: gleich nach
ein paar Knopfdrücken selbst `npm run freigabe` anstoßen, statt auf eine
Meldung zu warten.

**Zwölf neue Anschreiben** (zwei Läufe zu je sechs, ~11 Cent pro Lauf).
Ergebnis nach allen Freigaben: **8 approved, 2 rejected** (HOFER, Treevent —
Treevent war die einzige Anzeige mit echter Firmenmail, schade für den
Mailversand-Test), Rest wartet noch auf Nikis Knopfdruck.

**Beim ersten `npm run apply`-Lauf (Phase 8) fällt auf: zwei der freigegebenen
Anzeigen sind schon abgelaufen** (WEIN & CO, Grüne Erde — beide über drei
Wochen alt). Zeigt: `applications.status = approved` heißt nicht „geht noch",
Anzeigen können zwischen Fund und Freigabe verschwinden. `apply-browser.ts`
prüft das jetzt bei jedem Lauf selbst nach, bevor irgendetwas versucht wird.

**Phase 8 (`agents/apply-browser.ts`) ist als Gerüst gebaut, noch ohne
echten Adapter.** Ablauf: Anzeige mit Status `approved` + Weg `portal` erneut
öffnen → abgelaufen? → `failed`. Sonst: Adapter + Zugangsdaten für das
Portal vorhanden? → bewerben. Sonst: `needs_manual` + Telegram-Nachricht mit
Direktlink, damit Niki selbst weitermacht statt die Anzeige unbemerkt liegen
zu lassen. `DRY_RUN` (Standard an) wie überall im Projekt.

**Warum noch kein einziger Adapter drin ist:** Alle drei betroffenen Portale
verlangen für die Bewerbung ein eigenes Konto — nachgeprüft an den echten
Anzeigen, nicht vermutet:
- **hokify** (`hokify.at/apply/<id>`): „Jetzt bewerben" führt zu „Hast du
  bereits ein Profil? Ja / Nein" und einem 4-Schritte-Assistenten inkl.
  Auswahlfragen, die laut Seite „zu einer automatischen Vorauswahl oder
  Absage führen können" — genau die Sorte Formular, die man nicht blind
  automatisieren sollte.
- **willhaben**: noch keine lebende Anzeige zum Nachschauen, die einzige
  bisherige (WEIN & CO) war schon abgelaufen.
- **karriere.at**: „Bewerbung nur per smart bewerben", der Knopf selbst ist
  im DOM als „nur für angemeldete Bewerber" markiert.

Konten legt Apply AI grundsätzlich nicht selbst an (Bauplan, Phase 8) — das
ist unverändert Nikis Aufgabe.

**Nachtrag noch am selben Tag: Login läuft bei Niki über Google, nicht über
ein Passwort.** Die ursprüngliche Idee (`HOKIFY_EMAIL`/`_PASSWORD` in der
`.env`) war damit hinfällig, bevor sie einmal benutzt wurde. Zwei Anläufe mit
Playwright sind an derselben Sperre gescheitert — Google lehnt jede Anmeldung
aus einem ferngesteuerten Browser ab, egal ob Playwrights eigene
Chrome-Testfassung oder echtes Chrome über `channel: "chrome"` (im zweiten
Fall sogar mit einer eigenen Chrome-Warnung wegen `--no-sandbox`). Beide Male
dieselbe Meldung: „Dieser Browser oder diese App ist unter Umständen nicht
sicher." Wird hier nicht umgangen, das ist Googles eigene Bot-Sperre.

**Lösung, verifiziert:** `npm run anmelden <portal>` startet jetzt einen
ganz normalen Chrome-**Prozess** (`node:child_process`, kein Playwright, kein
CDP) mit einem eigenen Profil unter `engine/.auth/profil-<portal>/`
(`.gitignore`). Niki loggt sich darin komplett per Hand ein — für Google ein
Nutzer wie jeder andere. `apply-browser.ts` startet später Playwright
(`browserMitProfilStarten`, `lib/browser.ts`) nur noch mit genau diesem
Profil-Ordner und nur gegen die Portal-Seiten selbst, nie gegen Googles
Login-Seite — die Sperre greift dort also nicht mehr. Für **alle drei
Portale durchgeführt und bestätigt**: hokify zeigt „Niki", willhaben zeigt
„Nikolaus", karriere.at zeigt ein Profil-Symbol statt „Anmelden" — jeweils
nach Neustart mit dem gespeicherten Profil.

**Damit ist Phase 8 nur noch durch fehlende Adapter blockiert, nicht mehr
durch Zugangsdaten.** Naechster Schritt: pro Portal mit eingeloggter Seite
erkunden (wie `npm run untersuchen`, aber eingeloggt), dann den jeweiligen
`BewerbungsAdapter` in `apply-browser.ts` eintragen - angefangen bei hokify,
weil dessen 4-Schritte-Assistent schon bekannt ist.

## hokify-Adapter gebaut und im echten Lauf verifiziert (2026-09-13)

`engine/src/adapters/hokify-bewerben.ts` steht und ist in `apply-browser.ts`
eingetragen. Ablauf: Lebenslauf hochladen, dann bis zu 15 Interview-Fragen
durchgehen (Auswahl per Radio-Knopf, Freitext im Tiptap/ProseMirror-Editor,
freiwillige Checkboxen werden immer übersprungen) — jede Frage geht einzeln an
Haiku 4.5 mit Nikis Profiltext. Danach zeigt hokify **von sich aus** eine
mehrseitige Bewerbungsvorschau mit allen Antworten zum Nachlesen und Ändern;
der Adapter klickt dort bewusst **nicht** weiter, sondern wirft eine
Fehlermeldung mit der vollen Zusammenfassung, die `apply-browser.ts` als
`needs_manual` abfängt und per Telegram an Niki weiterreicht (Nikis
Entscheidung: „KI beantwortet, du bestätigst vor dem Absenden"). `DRY_RUN`
verlässt die Funktion, bevor überhaupt etwas angeklickt wird — hokify
speichert Antworten serverseitig, sobald man sie eintippt, ein Trockenlauf
klickt deshalb nichts an.

**Zwei echte Bugs beim Testen gefunden, beide behoben:**

1. **Stiller Rateversuch bei nicht erkannter Antwort.** Die erste Fassung
   wählte bei einer Modellantwort, die zu keiner Option passte, per
   `Math.max(0, ...)` einfach die erste Option — bei Ja/Nein-Fragen
   systematisch „Ja". Ein echter Testlauf hat das getroffen: „Warst du bereits
   bei McDonald's tätig?" wurde faelschlich mit „Ja" beantwortet (stimmt
   nicht). Fix: bei keiner Übereinstimmung wird jetzt ein Fehler geworfen statt
   geraten (mit einem toleranten Vergleich davor, der nur Leerzeichen/
   Groß-Kleinschreibung ignoriert).
2. **Race Condition beim Auslesen der Frage.** Radiooptionen kamen aus einem
   `$$eval`-Aufruf, der Fragetext aus einem separaten, späteren
   `page.evaluate()` — bei einer SPA wie hokify können zwischen den beiden
   Aufrufen unterschiedliche Seitenzustände liegen. Im echten Testlauf
   passten dadurch die Optionen einer Arbeitserlaubnis-Frage zum Fragetext
   einer ganz anderen, „Wie viele Jobs hattest du bis jetzt?" — das Modell
   antwortete verwirrt mit leerem Text, der Adapter brach korrekt ab (dank
   Bugfix 1), statt falsch zu raten. Fix: beides wird jetzt in einem einzigen
   `page.evaluate()` gelesen, garantiert aus demselben Seitenzustand.

**Danach ein sauberer End-to-End-Test über die echte Datenbank-Kette**
(`npm run apply 1`, `DRY_RUN=0`, echter frischer Job:
`hokify.at/job/29069395`, McDonald's Melk): 10 Fragen beantwortet für 1,25
US-Cent, alle Antworten beim Gegenlesen plausibel und widerspruchsfrei, Stopp
korrekt bei hokifys eigener Vorschau, Status `needs_manual`, Telegram-Meldung
raus. Nebenbei fiel noch eine dritte, kleinere Lücke auf: die
Abgelaufen-Prüfung lief nur einmal, vor der Anmeldung — eine Anzeige, die
genau zwischen dem ersten (anonymen) und zweiten (eingeloggten) Seitenaufruf
verschwindet, landete als kryptischer Playwright-Timeout statt als sauberes
„abgelaufen". `apply-browser.ts` prüft die Anzeige jetzt ein zweites Mal,
direkt nach der Anmeldung, bevor der Adapter überhaupt startet.

**willhaben und karriere.at sind noch offen** — beide Logins stehen (siehe
oben), aber ihre Bewerbungsabläufe sind noch nicht mit einer eingeloggten
Seite erkundet. Gleiches Muster wie bei hokify: erst erkunden, dann Adapter
bauen, dann echt testen.

## willhaben erkundet — kein eigener Adapter möglich (2026-09-13)

Mit Nikis eingeloggtem Profil an vier echten, noch aktiven Anzeigen geprüft:
„Jetzt bewerben" ist bei willhaben so gut wie nie ein eigenes Formular,
sondern ein externer Link (`target="_blank"`) direkt auf die Seite der
jeweiligen Firma — bei jeder Anzeige eine andere:

| Anzeige | Ziel von „Jetzt bewerben" |
|---|---|
| McDonald's, Mitarbeiter Küche Penzing | `jobs.mcdonalds.at` (eigenes Bewerbersystem) |
| STAGEHANDS WANTED (Event & Personal Management GmbH) | `artlogic.biz/at/jobs/` |
| Nachhilfe geben (LernFamilie) | `lernfamilie.at/nachhilfelehrer-werden` |

**Anders als bei hokify gibt es also keinen willhaben-eigenen
Bewerbungsablauf, den sich ein einziger Adapter merken könnte.** willhaben ist
im Kern eine Anzeigen-Sammelstelle: entweder steht eine Mailadresse im
Anzeigentext (das fängt der bestehende Scout-Adapter schon ab, Weg `mail`),
oder der Knopf zeigt auf eine von unzähligen fremden Firmenseiten — jede mit
eigenem Formular, oft eigenem Login. Ein „willhaben-Adapter" wäre in
Wirklichkeit ein Adapter pro Firma, unbegrenzt viele, nichts wiederverwendbar.

**Nikis Entscheidung (2026-09-13): hier aufhören, kein Adapter gebaut.** Der
bestehende Rückfall in `apply-browser.ts` (kein Adapter gefunden →
`needs_manual` + Telegram-Direktlink) ist für willhaben also nicht eine
Notlösung, sondern bereits die richtige, dauerhafte Antwort — Niki bewirbt
sich auf der jeweiligen Firmenseite selbst, was bei so unterschiedlichen
Zielseiten ohnehin der einzig robuste Weg ist. `willhaben` bleibt deshalb
absichtlich draußen aus `PORTAL_ADAPTER`.

**Offen, falls später gewünscht:** Ein Adapter direkt für `jobs.mcdonalds.at`
(McDonald's eigenes Bewerbersystem) würde sowohl hokify- als auch
willhaben-Anzeigen von McDonald's gleichzeitig abdecken, weil beide Portale
am Ende auf dieselbe fremde Seite verweisen — anders geschnitten als „ein
Adapter pro Portal", aber wiederverwendbar. Nicht begonnen, nur notiert.

## karriere.at-Adapter gebaut und im echten Lauf verifiziert (2026-09-13)

Erkundung mit Nikis eingeloggtem Profil, mit seiner ausdrücklichen Zustimmung
für den ersten Testklick (anders als bei hokify öffnet der Knopf einen neuen
Tab, es war vorher nicht sicher erkennbar, ob dabei schon etwas verschickt
wird). Ergebnis: **nicht jede Anzeige hat einen eigenen karriere.at-Ablauf** —
von acht stichprobenartig geprüften, aktuellen Anzeigen hatte nur eine einen
Link mit `data-is-smart-apply-link="true"` (Ziel `/bewerben/backend/apply/<id>`,
`target="_blank"`, der sichtbare grüne Knopf selbst ist 0×0 Pixel groß und
wird nur durch das Klick-Handling ausgelöst — der Adapter navigiert deshalb
direkt zur aufgelösten Zieladresse statt zu klicken). Die anderen Anzeigen
haben gar keinen Bewerben-Knopf auf der Seite (vermutlich Bewerbung nur per
Mail/extern) — das ist kein Fehler im Adapter, sondern normal.

Der eigentliche Ablauf unter `karriere.at/bewerben` ist ein echtes Formular,
kein Sofort-Versand: Lebenslauf (Nikis hinterlegter karriere.at-Lebenslauf ist
automatisch vorausgewählt), persönliche Daten (Vorname/Nachname/E-Mail aus dem
Profil vorausgefüllt), ein normales `<textarea>` für die „Anmerkung" (max.
3000 Zeichen, kein Tiptap wie bei hokify), eine eigens gestylte DSGVO-Checkbox
(das echte `<input>` liegt unsichtbar hinter einem SVG-Icon — angeklickt wird
deshalb das `<label>`), und zwei getrennte Knöpfe am Ende: „Vorschau ansehen"
(nur Prüfung/Vorschau, kein Versand) und „Bewerbung abschließen" (der einzige
echte Sende-Knopf). `engine/src/adapters/karriere-bewerben.ts` füllt das
Formular und klickt bewusst nur bis „Vorschau ansehen" — genau wie bei hokify
übergibt die Funktion danach mit einem Fehler (von `apply-browser.ts` als
`needs_manual` abgefangen) an Niki, der die karriere.at-eigene Vorschau prüft
und selbst abschickt.

**Echter Fund beim ersten Testlauf:** Karriere.at verlangt beim Klick auf
„Vorschau ansehen" zwingend eine Telefonnummer („Bitte gib eine Telefonnummer
an.") — die steht in Nikis karriere.at-Profil noch nicht (anders als
Vorname/Nachname/E-Mail, die vorausgefüllt sind). Der Adapter füllt sie
bewusst nicht selbst aus (keine erfundenen Kontaktdaten), sondern erkennt die
Fehlermeldung und wirft einen klaren, verständlichen Fehler statt eines
kryptischen Playwright-Timeouts. Ende-zu-Ende mit `npm run apply 1`, `DRY_RUN=0` gegen eine echte, aktive
Anzeige bestätigt: Formular korrekt ausgefüllt, Fehler sauber erkannt,
`needs_manual` gesetzt, Telegram-Meldung raus, nichts abgeschickt.

**Telefonnummer am 2026-09-13 nachgetragen** (Wert nicht hier wiederholt,
siehe Hinweis zur Veröffentlichung weiter unten), direkt unter
karriere.at/profil → Persönliche Daten bearbeiten → Telefon, per Playwright
mit Nikis eingeloggtem Profil eingetragen und gespeichert — „Deine Daten
wurden aktualisiert" bestätigt).

**Zweiter echter Bug dabei gefunden und behoben:** `data-qa` des
„Vorschau ansehen"-Knopfes ist zustandsabhängig - `"preview button disabled"`
solange ein Pflichtfeld fehlt, danach (ohne das Wort „disabled") nur noch
`"preview button"`. Der erste Adapter-Entwurf war auf den alten Namen
festgenagelt und lief nach dem Nachtragen der Telefonnummer in einen
20-Sekunden-Timeout, weil der Knopf unter diesem Namen nicht mehr existierte.
Fix: Klick jetzt über den sichtbaren Text (`getByRole("button", { name:
"Vorschau ansehen" })`) statt über den wechselnden `data-qa`-Wert.

Danach ein zweiter echter End-zu-Ende-Lauf (`npm run apply 1`, `DRY_RUN=0`)
bestätigt: die karriere.at-eigene „Bewerbungsvorschau" erscheint jetzt wie
erwartet - Absender (Name/E-Mail/Telefon), angehängter Lebenslauf, das
Anschreiben unter „Anmerkungen zur Bewerbung", der DSGVO-Haken, und erst
danach „Eingaben ändern" / „Bewerbung abschließen". Genau das Bild, das Niki
vor dem Abschicken sehen soll - der Adapter stoppt eine Zeile davor.

**Nebenbei aufgefallen (kein Adapter-Bug, nur notiert):** die DB-Zeile zur
Anzeige `karriere.at/jobs/7865512` führt die Firma als „Raiffeisen
Oberösterreich", die Seite selbst zeigt heute „KIWI - Kinder in Wien" für
dieselbe ID/URL. Möglicherweise eine wiederverwendete Job-ID oder eine
veraltete Kopie in der Datenbank — nicht weiter verfolgt, da für den
Bewerbungsablauf selbst ohne Bedeutung.

## Projekt fertigmachen (2026-09-13)

Niki wollte das Projekt "fertigmachen" - Anlass, den ganzen Bauplan noch
einmal gegen den echten Code zu halten. Zwei echte Lücken dabei gefunden:

**1. "Vollautomatik ab 70 Punkten" war nie wirklich scharf.** Der Wert
`settings.auto_send_min` stand zwar in der Datenbank (seit der Senkung von 80
auf 70 am 2026-08-30), wurde in `write.ts` aber nur für ein Log-Label benutzt
("wäre Vollautomatik"). Tatsächlich ging **jede** Bewerbung, egal wie hoch
bewertet, über Telegram in eine Rückfrage. **Jetzt behoben:** ab `auto_send_min`
setzt `write.ts` den Status direkt auf `approved` und schickt Telegram nur
noch eine Information (keine Knöpfe). Darunter, ab `approval_min` (60), bleibt
es wie bisher eine Rückfrage mit Freigeben/Ablehnen. Niki hat das ausdrücklich
so gewollt - das entspricht seiner Entscheidung vom 2026-07-24, nur eben jetzt
auch im Code.

**2. Der Motor machte nur Scout+Score, nicht den Rest.** `write` und `freigabe`
liefen bisher nur, wenn jemand sie von Hand anstößt - der automatische Lauf
alle 8 Stunden (der ohnehin abgeschaltet war) hätte also nur Anzeigen
gesammelt, ohne dass je ein Anschreiben entstanden wäre. `.github/workflows/motor.yml`
macht jetzt nach `score` auch `write` und `freigabe`, und der Zeitplan ist
wieder an - zuerst dreimal täglich, noch am selben Abend auf Nikis Wunsch auf
**einmal täglich (05:00 UTC)** reduziert, ihm waren drei Läufe zu viel.
**Nicht ergänzt:** `mail`
und `apply-browser` - Mail-Versand ist ein eigener Schritt mit echten
Konsequenzen (siehe unten), und der Browser-Agent (Phase 8) braucht Nikis
eingeloggtes Chrome-Profil, das es in GitHub Actions grundsätzlich nicht gibt
und dort auch nicht geben sollte (Googles eigene Sperre gegen ferngesteuerte
Browser, siehe oben) - dieser Teil bleibt bewusst lokal auf Nikis Rechner.

**Wichtig zu prüfen:** `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` stehen zwar
schon als `secrets.*`-Verweise in `motor.yml`, ob sie im GitHub-Projekt
tatsächlich als Secrets hinterlegt sind, ließ sich von hier aus nicht prüfen
(nur die drei ursprünglichen sind laut Stand vom 2026-08-30 bestätigt). Fehlen
sie, läuft `write`/`freigabe` trotzdem durch (Vollautomatik funktioniert auch
ohne Telegram), nur die Rückfrage-Benachrichtigung bliebe aus.

**Phase 5 (eigene Web-Oberfläche) wird bewusst NICHT gebaut** - Nikis
Entscheidung am 2026-09-13. Telegram deckt die Freigabe ab, Verlauf und
Regeln bespricht er bei Bedarf direkt mit Claude Code. Spart eine komplette
zusätzliche Next.js/Vercel-App.

**McDonald's ausgeschlossen** (Nikis Entscheidung, 2026-09-13): neues Feld
`settings.exclusions.firmen`, geprüft gegen die Firma statt den Anzeigentitel
(`lib/jugendschutz.ts`). Die zwei bereits wartenden McDonald's-Bewerbungen
wurden auf `rejected` gesetzt.

**Die drei wartenden Mail-Entwürfe wollte Niki nicht** (Sekulić Vukašin,
Elite Freizeitcenter, Thomas Kraml) - "nicht gut, einfach liegen lassen".
Bleiben bewusst als `pending_approval` liegen, werden nicht angerührt.

**Antwort-Erkennung per IMAP gebaut** (`agents/antwort.ts`, `npm run antwort`)
- siehe Phase 7 oben. Damit ist aus dem Bauplan nur noch Phase 5 (Web-
Oberfläche) offen, und die ist auf Nikis Wunsch bewusst nicht gebaut.

### Echter Endtest, zum ersten Mal komplett ohne Handgriff (2026-09-13)

Genau der Abnahme-Test aus dem Bauplan: ein frischer `npm run scout` (alle
vier Portale, 48 neue Anzeigen) → `npm run score` (10 über 70 Punkten) →
`npm run write` - und zum ersten Mal griff die echte Vollautomatik: zwei
Anzeigen (HOFER, OBI - beide willhaben, 78/82 Punkte) gingen ohne
Telegram-Rückfrage direkt auf `approved`. `npm run apply` danach bestätigt:
sauber als `needs_manual` erkannt (willhaben hat keinen Adapter, wie
entschieden), Telegram-Direktlink raus. Erster echter Beleg, dass die neue
Vollautomatik tut, was sie soll.

**Dabei einen echten Bug gefunden: die Vollautomatik griff auch bei
McDonald's.** Grund: die neue Firmen-Ausschlussliste wirkt nur im Vorfilter
beim *Bewerten* neuer Anzeigen - sie schaut nicht rückwirkend in schon
bestehende `scores`-Zeilen. Sechs McDonald's-Anzeigen standen seit dem
2026-08-25 mit `hard_filtered: false` in der Datenbank (vor der heutigen
Ausschlussliste gescout), `npm run write` zog sie also ganz normal als
Kandidaten - eine davon (78 Punkte, noch ohne eigene Bewerbungszeile) wurde
prompt automatisch `approved`. **Sofort korrigiert:** die Bewerbung auf
`rejected` zurückgesetzt, und alle sechs alten McDonald's-Scores nachträglich
auf `hard_filtered: true` gesetzt, damit sie nie wieder als Kandidat
auftauchen - unabhängig davon, wann sie gescout wurden. **Merkposten für
jede künftige Ausschlussliste-Änderung (Wort oder Firma):** eine neue Regel
im Vorfilter wirkt nur auf Anzeigen, die DANACH bewertet werden. Schon
bestehende `scores`-Zeilen müssen von Hand (oder mit `npm run score nochmal`,
kostet dann aber wieder echtes Geld für alle) gegen die neue Regel geprüft
werden.

## Offene Punkte für Niki

- ~~Prüfen, ob `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` als GitHub-Secrets
  hinterlegt sind~~ - **erledigt (2026-09-14)**, beide nachgetragen.
- **Zwei neue Vollautomatik-Treffer warten auf dich per Telegram**
  (HOFER Siemensstraße, OBI Samstagsaushilfe Kassa - beide willhaben, kein
  Adapter dort) - Direktlink ist raus, du bewirbst dich dort selbst.
- Der erste echte Mail-Testversand steht weiterhin aus - braucht eine
  Anzeige mit hinterlegter Firmenmail, die Niki auch wirklich will. Kommt von
  selbst, sobald der Motor (jetzt mit Zeitplan) eine findet.
- Sitzungen laufen irgendwann ab - meldet sich apply-browser dann als
  „needs_manual", einfach `npm run anmelden <portal>` wiederholen.
- **Weitere Anschreiben lesen und ehrlich beurteilen.** Was am Ton oder Inhalt
  nicht passt, gehört in die Anweisung in `write.ts` — nicht in eine
  Nachbesserung von Hand.
- Eine hokify-Anzeige (`hokify.at/job/28943952`) hat noch den Ort „5000 EUR"
  aus der Zeit vor der Reparatur. Sie taucht in der Suche nicht mehr auf,
  `frisch` erreicht sie also nicht mehr. Kosmetisch, stört sonst nichts.
- **Auf derselben Anzeige (`hokify.at/apply/28943952`) steht noch eine falsche
  Antwort** aus einem frühen Testlauf vor dem Bugfix oben: „Warst du bereits
  bei McDonald's tätig?" mit „Ja" beantwortet (stimmt nicht). Kurz
  reingeschaut, korrigiert oder die Bewerbung verworfen werden, bevor die
  jemals abgeschickt wird.
- Profile anlegen auf: Indeed, StudentJob (AMS braucht keines)
- Prüfen, dass in der Anthropic Console **Auto-Reload ausgeschaltet** ist
- Der API-Schlüssel läuft am **01.01.2027** ab

## Vor einer Veröffentlichung auf GitHub (2026-09-13, erledigt am 2026-09-14)

**✅ Erledigt - siehe den Abschnitt ganz oben ("2026-09-14: Repo öffentlich,
Git-Historie bereinigt") für den genauen Ablauf.** Das Repo ist seit
2026-09-14 `public`. Ursprünglich hier festgehalten war die Absicht, das
"irgendwann" zu machen - daraus wurde noch am selben Tag ein "jetzt gleich",
auf Nikis Wunsch. Die drei Punkte, die damals als offen galten:

- ~~Persönliche Daten stecken in der Git-Historie~~ - Historie neu gestartet
  statt mit `git-filter-repo` selektiv bereinigt (Tool nicht vorhanden, und
  bei 24 Commits war der komplette Neuanfang der zuverlässigere Weg).
- ~~`seed-profil.ts` enthält Nikis echten Lebenslauf-Text als Quellcode~~ -
  ausgelagert nach `profil-daten.ts` (ungetrackt).
- ~~Diese Datei (`docs/stand.md`) müsste vor der Historie-Bereinigung
  nochmal geprüft werden~~ - passiert, siehe Actions-Log-Check oben.

## Zum Wiedereinsteigen

```
cd "C:\Users\nikiw\OneDrive\Dokumente\AI\Claude Code Projekte\apply-ai"
npm run check
npm run treffer
```

Der vollständige Bauplan liegt unter
`C:\Users\nikiw\.claude\plans\radiant-exploring-eclipse.md`.
