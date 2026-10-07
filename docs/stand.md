# Stand und nächster Schritt

**Letzter Arbeitstag: 2026-10-06**

> **Kurzfassung — ganz lesen.** Enthält: die neuesten Einträge, was als Nächstes dran ist, offene Punkte, Befehle, Wiedereinstieg.
> Ältere Einträge (Phasen-Historie, Portal-Anhaltspunkte, Vorfilter-Details …) stehen unverändert in `docs/verlauf.md` — **nur bei Bedarf gezielt per Suche (grep) lesen, nie komplett.**
> Pflege: neue Einträge oben einfügen; wird diese Datei größer als ~20 KB, die ältesten datierten Einträge nach `verlauf.md` (oben) verschieben.

## 2026-10-06: Anschreiben mit Sonnet 5.5

**Nikis Auftrag:** Anschreiben-Modell auf `claude-sonnet-5-5`, Bewertung
bleibt auf Haiku.

**Welches Modell wofür (alle in `lib/env.ts` -> `MODELS`):**

| Konstante | Modell | wofür |
|---|---|---|
| `fast` | `claude-haiku-4-5` | Bewerten (`score.ts`), Explorer, Antwort-Erkennung, `check` - unverändert |
| `good` | `claude-sonnet-5` | hokify-Formularfragen (`hokify-bewerben.ts`) - unverändert |
| `anschreiben` | **`claude-sonnet-5-5`** | nur die Anschreiben (`write.ts`) - neu |

`claude-haiku-4-5` ist der Alias zu `claude-haiku-4-5-20251001`, dasselbe
Modell. In Workflows und `.env.example` steht kein Modellname. Künftiger
Wechsel des Anschreiben-Modells: eine Zeile in `env.ts` (+ Preis in `PREISE`).

**Was sich in `write.ts` sonst ändern musste:**
- Aufruf über `claude.beta.messages.create` mit `fallbacks: "default"`
  (Beta `server-side-fallback-2026-07-01`): lehnt Sonnet 5.5 aus
  Sicherheitsgründen ab, rechnet der Server mit einem passenden anderen
  Modell weiter. `stop_reason` `refusal`/`max_tokens` -> klarer Fehler.
- `max_tokens` 2048 -> 8000: Sonnet 5.5 denkt standardmäßig mit, das zählt
  mit hinein.
- Kosten nach `antwort.model` (nach einem Fallback ein anderes Modell).
- Neuer Modus **`npm run write probe`**: ein echtes Anschreiben zur besten
  offenen Anzeige, nur Ausgabe - keine DB-Zeile, kein Telegram, nichts
  kann verschickt werden. Für künftige Modellwechsel.

**Testlauf (`npm run write probe`):** Lidl, Samstagsjob Verkauf, 1210 Wien
(`hokify.at/job/29105685`, 88 Punkte). Anschreiben vollständig, echte
Umlaute, Grußformel, keine erfundenen Fakten erkennbar. Dabei lief auch
die neue Gültigkeitsprüfung echt: die gleichnamige Lidl-Anzeige davor war
abgelaufen (Umleitung auf hokify.at/jobs) und wurde übersprungen.
**Kosten: 3,4 Cent** (2772 Ausgabe-Token) statt ~1,2 Cent mit Sonnet 5 -
das Mitdenken bei Standard-Effort `high`. Möglicher Hebel, nicht umgesetzt:
`output_config.effort: "medium"` oder `"low"` testen.

**GitHub Actions, Motor Nr. 27** (`37487290519`, Commit `dd3e507`, von
Niki gestartet): alle Schritte grün. Der Writer schrieb in der Cloud drei
Anschreiben zu je 2,5-3,3 Cent (9 Cent zusammen - dieselbe Größenordnung
wie der Probelauf, also Sonnet 5.5), übersprang eine abgelaufene Anzeige
(`abgelaufen: 1` in `events`) und sechs per Firmensperre. Mail-Schritt nach
1 s fertig: keine freigegebene Mail-Bewerbung offen.

## 2026-10-06: Mail-Versand läuft jetzt auch in GitHub Actions

**Nikis Wunsch:** die App aufs iPhone, weil das immer an ist. **Geht nicht**
(iOS lässt keinen ferngesteuerten Browser zu und friert Hintergrund-Apps
ein) - das eigentliche Ziel „unabhängig vom PC" ist für Mail aber lösbar:

- **Motor-Schritt „Mail-Bewerbungen verschicken"** (`motor.yml`, nach
  `freigabe`), scharf mit `DRY_RUN=0`/`MAIL_TEST_MODE=0`. Fehlen die
  Secrets, wird der Schritt übersprungen statt rot.
- **Lebenslauf verschlüsselt im Repo:** `engine/lebenslauf.enc`
  (AES-256-GCM, Dateiname mit verschlüsselt, weil er den vollen Namen
  enthält). Schlüssel `CV_SCHLUESSEL` steht in der `.env` und muss als
  GitHub-Secret eingetragen werden. `lib/lebenslauf.ts` nimmt lokal das PDF
  (`CV_PDF_PATH`), sonst die verschlüsselte Fassung. Nach jeder Änderung am
  Lebenslauf: `npm run lebenslauf-verschluesseln` und committen.
- **Keine Doppel-Mails:** PC und Cloud verschicken jetzt beide. `mail.ts`
  stellt jede Bewerbung erst atomar `approved` -> `sending` um, nur wer das
  schafft, schickt. Neuer Status `sending`; bleibt er nach einem Absturz
  stehen, wird nicht automatisch wiederholt (in Supabase nachsehen).
- `mail.ts` prüft den Lebenslauf einmal vor dem Lauf - fehlt er, bricht der
  Lauf ab, statt jede Bewerbung auf `failed` zu setzen.
- hokify/karriere bleiben auf dem PC (eingeloggte Profile, Google-Sperre).

**Secrets, die Niki selbst einträgt** (github.com/nikiweikhart/apply-ai ->
Settings -> Secrets and variables -> Actions): `MAIL_ADDRESS`,
`MAIL_APP_PASSWORD`, `CV_SCHLUESSEL` - jeweils der Wert aus der `.env`.
Geprüft: Entschlüsseln ohne `CV_PDF_PATH` liefert byte-gleich das PDF,
Mail-Trockenlauf ohne `CV_PDF_PATH` läuft durch (Da Antonio war dabei
schon abgelaufen).

**Verifiziert am selben Tag:** Niki hat die drei Secrets eingetragen und den
Motor von Hand gestartet (Lauf `37483332446`, Commit `6a8d725`, alle
Schritte grün). Der Mail-Schritt lief 17 s (Überspringen wäre sofort) und
schrieb um 15:04 UTC drei `events` vom Agenten `mail` - er kam also an der
Secret-Prüfung und am Entschlüsseln des Lebenslaufs vorbei (beides bricht
sonst vor der ersten Anzeige ab). Verschickt wurde nichts: alle drei
Kandidaten (Da Antonio, Cafe Restaurant Pan, nora pure sports) waren
abgelaufen, lokal gegengeprüft - die Cloud meldet richtig, keine
Fehlsperre durch die Rechenzentrums-Adresse.

**Zwei Dinge, die dabei auffielen:**

- **Der Zeitplan startet nicht um 05:00 UTC.** Die letzten geplanten Läufe
  begannen zwischen 10:12 und 12:02 UTC - GitHub verschiebt Cron-Läufe bei
  Last um Stunden. Mail-Bewerbungen gehen also eher mittags raus.
- **Der Writer schreibt Anschreiben zu längst abgelaufenen Anzeigen.** Zwei
  der drei wurden im selben Lauf erst geschrieben (inkl. Telegram
  „Automatisch freigegeben") und eine Minute später als abgelaufen
  verworfen. Kostet je ~1-2 Cent und verwirrt auf Telegram. **Noch am
  selben Tag behoben**, siehe nächster Absatz.

**Writer prüft vor dem Schreiben (2026-10-06, Nikis Auftrag):** `write.ts`
öffnet jede ausgewählte Anzeige mit `anzeigeNochAktiv()`, bevor Sonnet
schreibt. Abgelaufen -> Zeile in `applications` mit `failed` und Grund
„schon vor dem Schreiben abgelaufen", die nächste Anzeige rückt nach.
Nicht prüfbar (Netzwerk) -> diesmal ausgelassen. Im Trockenlauf keine
Prüfung. **Firmensperre zählt `failed` nicht mehr** - dort ist nichts bei
der Firma angekommen, eine abgelaufene Anzeige soll die Firma nicht 30 Tage
sperren. Echter Lauf `npm run write 1`: HOFER Rennbahnweg (88) geprüft,
online, geschrieben. Der Abgelaufen-Zweig selbst lief noch nicht echt.

**Telegram ohne Prüf-Zeile bei der Vollautomatik:** Niki las „prüfen" als
„ich muss noch was tun". Die offenen Punkte stehen bei 70+ nicht mehr in
der Nachricht (nur noch in `events`), bei Rückfragen (60-69) weiter als
„Vor dem Freigeben prüfen".

## 2026-10-06: „Automatisch beworben" war gelogen - nichts ging raus

**Nikis Frage:** Auf Telegram kommen Nachrichten „Automatisch beworben"
mit einer Zeile „Vor dem Abschicken prüfen" - ist das nun abgeschickt oder
nicht, und muss er noch etwas tun?

**Antwort: Nein, nichts war abgeschickt.** Der Writer (GitHub Actions,
05:00 UTC) setzt ab 70 Punkten nur `approved`. Abgeschickt wird erst von
`scripts/versand.ps1` auf Nikis PC - und die Windows-Aufgabe dafür war
**nie eingerichtet** (`Get-ScheduledTask` findet sie nicht, `engine/logs/`
existiert nicht). Seit dem Handlauf am 2026-10-05 ist also nichts mehr
rausgegangen. Am 2026-10-06 wartend: Da Antonio (Pizzaiolo, Mail) und DLS
(Flohmarkt Autokino, willhaben -> nur Link).

**Behoben (Text, `agents/write.ts`):** Telegram sagt jetzt „Automatisch
freigegeben" plus, was als Nächstes passiert: per Mail beim nächsten
Versandlauf / auf hokify bzw. karriere beim nächsten Versandlauf / Portal
ohne Adapter -> Link kommt, selbst bewerben. Die Zeile heißt bei der
Vollautomatik jetzt „Nur zur Info (z. B. fürs Vorstellungsgespräch)", bei
Rückfragen „Vor dem Freigeben prüfen". Erst „✅ abgeschickt" heißt draußen.

**Nicht behoben, weil blockiert:** Das Einplanen der Aufgabe und ein
Versandlauf von Hand wurden von Claude Codes Rechte-Prüfung erneut
abgelehnt („Unauthorized Persistence" bzw. „Real-World Transactions") und
nicht umgangen. Niki muss den Einplan-Befehl aus dem Abschnitt 2026-10-05
selbst einmal in PowerShell ausführen.

**Nachtrag 2026-10-06:** Niki hat die Aufgabe „Apply AI Versand“ selbst
angelegt (State `Ready`, erster Lauf 2026-10-06 19:00). Ab jetzt geht
alles ab 70 Punkten zweimal täglich wirklich raus, sofern der PC an ist.


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
npm run write probe              ein Anschreiben nur ausgeben (Modelltest, nichts gespeichert)

npm run freigabe                 liegengebliebene Entwürfe nachschicken + Telegram-Knopfdrücke abholen

npm run mail                     freigegebene Bewerbungen verschicken (DRY_RUN/MAIL_TEST_MODE beachten!)
npm run lebenslauf-verschluesseln  engine/lebenslauf.enc neu erzeugen (nach Lebenslauf-Aenderung)

npm run apply                    freigegebene Portal-Bewerbungen abschicken (DRY_RUN beachten!)
npm run apply nochmal            dazu haengende needs_manual von hokify/karriere (nie UNSICHER)
npm run apply nochmal nur:123    nur die Anzeige, deren Adresse 123 enthaelt

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/versand.ps1
                                 freigabe+mail+apply+antwort SCHARF (wie die geplante Aufgabe)

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


## Zum Wiedereinsteigen

```
# im Repo-Ordner apply-ai (am PC: Claude Code Projekte/apply-ai im AI-Ordner)
npm run check
npm run treffer
```

Erledigt am 2026-10-05: die `apply nochmal`-Schritte vom 2026-09-30 sind
gelaufen, 8 Bewerbungen echt raus (siehe ganz oben).

Offen seit 2026-10-05:
- Prüfen, ob Niki die Windows-Aufgabe „Apply AI Versand" eingerichtet hat
  (seit 2026-10-06 eingerichtet - nach dem ersten Lauf das Log prüfen)
  (`Get-ScheduledTask -TaskName "Apply AI Versand"`) und ob
  `engine/logs/versand-*.log` sauber aussieht.
- Die ersten hokify-Läufe mit Sonnet-Antworten in Telegram gegenlesen.
- Idee, nicht begonnen: Mail-Versand zusätzlich in GitHub Actions (braucht
  den Lebenslauf als Secret, Repo ist öffentlich) - dann ginge Mail auch
  bei ausgeschaltetem PC raus.

Der vollständige Bauplan liegt unter `docs/bauplan.md` (im Repo).

