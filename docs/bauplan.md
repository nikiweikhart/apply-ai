# Apply AI — Bauplan

## Kontext

Niki (17, Wien, Matura 2027) sucht einen Samstagsjob. Statt jede Anzeige händisch zu suchen und
jede Bewerbung einzeln zu schreiben, soll **Apply AI** das übernehmen: selbstständig auf den
Jobportalen suchen, Treffer bewerten, Anschreiben schreiben und verschicken. Es ist gleichzeitig
sein erstes echtes KI-Projekt und soll am GitHub-Profil vorzeigbar sein (siehe
`Vision/wiki/themen/apply-ai.md` und `Vision/wiki/konzepte/ki-kompetenz.md`).

Bisher existierte nur ein Konzept mit fünf Agenten (Scout, Score, Writer, Browser, Mail), aber
keine Entscheidung, **worauf** das Ganze läuft. Dieser Plan legt das fest und beschreibt den Bauweg
bis zur ersten automatisch verschickten Bewerbung.

**Der entscheidende Befund:** Eine reine Gratis-Website (Vercel Hobby) kann das Konzept nicht
ausführen — Funktionen brechen nach 10 Sekunden ab, es sind nur 2 Zeitpläne à 1× pro Tag erlaubt,
und ein echter Browser läuft dort gar nicht. Genau der ist aber das Herzstück: Apply AI soll sich
selbst durch die Portale klicken. Deshalb wird Motor und Oberfläche getrennt.

## Getroffene Entscheidungen

| Frage | Entscheidung |
|---|---|
| Bauform | Motor getrennt von Oberfläche |
| Jobsuche | Der Agent geht **selbst** auf die Portale, sucht, filtert und liest Anzeigen |
| Versandweg | E-Mail **und** Portal-Ausfüllen von Anfang an |
| Freigaben | Telegram-Push, Freigabe per Tipp |
| KI-Modelle | Navigieren und Bewerten mit Haiku 4.5, Schreiben mit Opus 5 |
| Vollautomatik | Score 80–100 geht ohne Rückfrage raus (Nikis bewusste Entscheidung vom 2026-07-24) |

## Architektur

```
                  ┌─────────────────────────────┐
   alle 8 Std. →  │  MOTOR (GitHub Actions)     │
                  │  echter Chrome läuft hier    │
                  │  scout → score → write       │
                  │  → mail / browser            │
                  └──────────┬──────────────────┘
                             │ liest+schreibt
                  ┌──────────▼──────────────────┐
                  │  DATENBANK (Supabase)       │
                  │  jobs, scores, applications │
                  └──────────┬──────────────────┘
                             │ liest+schreibt
                  ┌──────────▼──────────────────┐
                  │  OBERFLÄCHE (Next.js/Vercel)│  ← am Handy installierbar
                  │  Freigeben, Verlauf, Regeln │
                  └─────────────────────────────┘
                             │ „Jetzt laufen lassen"
                             └──→ stößt Motor an (repository_dispatch)

   Telegram ←── Push bei Freigabe-Bedarf, Versand, Blockade, Fehlern
```

**Warum GitHub Actions als Motor:** kostenlos (2.000 Minuten/Monat im privaten Projekt), beliebiger
Zeitplan, und — der Hauptgrund — **ein echter Chrome-Browser läuft dort**. Zugangsdaten liegen
sicher in den GitHub-Secrets. Niki kennt die Bauweise schon vom Morgen-Bot.

**Wichtig:** Das GitHub-Projekt muss **privat** sein — es enthält Lebenslauf und persönliche Daten.

**Nebeneffekt, der gut passt:** Supabase pausiert Gratis-Projekte nach 7 Tagen ohne Zugriffe. Der
8-stündige Lauf hält die Datenbank automatisch wach.

## Technik

- **Eine Sprache überall: TypeScript.** Ein GitHub-Projekt mit zwei Ordnern (npm workspaces):
  - `engine/` — die fünf Agenten als eigenständige Skripte
  - `web/` — Next.js-Oberfläche
- **Browser:** Playwright mit echtem Chromium. Im GitHub-Ablauf das fertige
  Playwright-Container-Image verwenden, damit nicht bei jedem Lauf minutenlang installiert wird.
- **KI:** `@anthropic-ai/sdk`
  - Navigieren und Bewerten: `claude-haiku-4-5`, mit `output_config.format` für ein festes
    Ergebnis-Format (Score, Begründung, Ausschlussgrund) — kein Freitext-Parsen
  - Schreiben: `claude-opus-5` mit `thinking: {type: "adaptive"}`
  - Lebenslauf + Profiltext als **fester Vorspann mit `cache_control`** → spart bei jedem Aufruf
- **Mail:** eigene Bewerbungs-Adresse, Nodemailer (Versand) + IMAP (Antworten von Firmen lesen)

## Datenbank (Supabase)

| Tabelle | Inhalt |
|---|---|
| `jobs` | Quelle, Original-Link, Titel, Firma, Ort, Anzeigentext, Fingerabdruck (gegen Doppelte) |
| `scores` | job_id, Punktzahl 0–100, Begründung, KJBG-geprüft ja/nein, verwendetes Modell |
| `applications` | job_id, Status, Weg (mail/portal), Anschreiben, Sendezeitpunkt, Fehlertext |
| `portals` | Portal-Name, Suchadresse, Filter-Einstellungen, letzter erfolgreicher Lauf, Zustand |
| `settings` | Profiltext, Ausschlussregeln, Verfügbarkeiten |
| `events` | lückenloses Protokoll: was hat welcher Agent wann getan, inkl. KI-Kosten pro Lauf |
| Storage | Lebenslauf (PDF + Word), Screenshots als Belege |

`applications.status`: `draft` → `pending_approval` → `approved` → `sent` | `failed` | `needs_manual` | `rejected`

## Die fünf Agenten

### 1. Scout — sucht selbstständig auf den Portalen (`engine/scout.ts`)

Der Kern des Projekts. Pro Portal läuft ein echter Browser durch den kompletten Ablauf.

**Die sechs Portale** (recherchiert 2026-08-24, Reihenfolge = Baureihenfolge der Adapter):

| # | Portal | Warum | Bot-Risiko |
|---|---|---|---|
| 1 | **hokify.at** | Österreichisch, gebaut für geringfügig/Aushilfe, Bewerbung ohne Anschreiben | niedrig |
| 2 | **willhaben Jobs** | Größtes Volumen (~15.700 Jobs), stark bei Handel und Gastro | niedrig |
| 3 | **AMS „alle jobs"** (`jobs.ams.at`) | Staatlich, kein Login, rechtlich am saubersten zu durchsuchen | niedrig |
| 4 | **StudentJob.at** | Eigene Kategorie „Samstagsjob Wien", Arbeitgeber erwarten Schüler | niedrig |
| 5 | **karriere.at** | Größte reine Jobbörse, dort posten die großen Ketten | mittel |
| 6 | **Indeed.at** | Größter Sammler, 400+ Samstagsjobs Wien — aber blockt Automatisierung stark | **hoch** |

Niki legt auf allen sechs ein Profil an. Bei Indeed ist damit zu rechnen, dass der Bot
blockiert wird — dann wird dieses Portal auf „manuell" gestellt und Niki bewirbt sich dort
selbst; die Reichweite des Profils bleibt trotzdem erhalten.

Ablauf pro Portal:

1. Suchseite öffnen
2. Filter setzen: Wien + Umkreis, Teilzeit/geringfügig, Wochenende, Schüler/Studenten
3. Trefferliste durchblättern (mehrere Seiten)
4. Jeden noch unbekannten Treffer öffnen und den vollen Anzeigentext auslesen
5. Fingerabdruck bilden und Doppelte verwerfen — jede Anzeige wird nur einmal verarbeitet

**Zwei Betriebsarten, die sich gegenseitig auffangen:**

- **Adapter (Normalfall).** Pro Portal eine fest programmierte Klickfolge. Schnell, kostet keinen
  einzigen KI-Aufruf, verarbeitet hundert Anzeigen in Minuten.
- **Explorer (wenn der Adapter bricht).** Ändert ein Portal sein Layout, greift der Adapter ins
  Leere. Dann übernimmt Haiku 4.5 mit Werkzeugen (`klicken`, `tippen`, `seite_lesen`,
  `fertig`): Der Agent bekommt die Seitenstruktur beschrieben und findet den Weg selbst. Danach
  meldet er per Telegram, welcher Adapter nachgezogen werden muss.

Diese Zweiteilung ist der technisch interessanteste Teil des Projekts und genau das, was ein
Bewerbungsbot von einem simplen Skript unterscheidet.

**Verhalten auf den Seiten:** Der Scout läuft 3× am Tag, nicht im Sekundentakt, mit Pausen
zwischen den Seitenaufrufen — wie ein Mensch, der seine Jobsuche durchgeht. Trifft er auf eine
CAPTCHA-Abfrage oder eine Blockadeseite, **hört er auf**, merkt sich in `portals` den Zustand und
meldet es per Telegram. Er versucht nicht, sich vorbeizumogeln.

**Ehrlicher Hinweis:** willhaben und karriere.at untersagen automatisches Auslesen in ihren AGB.
Bei drei Läufen pro Tag für die eigene Jobsuche ist das praktisch kein Problem, aber es kann
passieren, dass ein Portal irgendwann dichtmacht. Der Explorer und die Telegram-Meldung sind genau
die Antwort darauf: Du erfährst es sofort und kannst entscheiden, statt dass der Bot still steht.

### 2. Score — bewertet (`engine/score.ts`)

Zweistufig, um Geld zu sparen:

- **Erst harter Code-Filter (kostet nichts):** KJBG-Ausschlüsse — keine Sonn-/Feiertagsarbeit außer
  Gastgewerbe, Kranken-/Pflegeanstalten, Musik-/Theateraufführungen, Sport-/Spielplätze;
  Samstag nur bis 13:00 außer Verkaufsstellen. Dazu Umkreis Wien und Mindestalter.
  Was hier rausfällt, kostet keinen KI-Aufruf.
- **Dann Haiku 4.5** bewertet den Rest gegen Nikis Profil: 0–100 plus Begründung.
  - **80–100** → automatisch bewerben
  - **60–79** → Telegram-Freigabe
  - **unter 60** → abgelegt, nicht gelöscht (zum Nachjustieren der Regeln)

### 3. Writer — schreibt (`engine/write.ts`)

Opus 5 schreibt ein Anschreiben, das auf die konkrete Anzeige eingeht (nicht Textbausteine).
Vorspann = Lebenslauf + Profiltext + Anschreiben-Vorlage (gecacht), variabler Teil = die Anzeige.
Ergebnis landet als `draft` in `applications`.

### 4. Browser — bewirbt sich auf Portalen (`engine/apply-browser.ts`)

Playwright füllt Bewerbungsformulare aus (Workday zuerst, weil die Hollister-Bewerbung dort läuft).
Ablauf: einloggen → Formular ausfüllen → Lebenslauf hochladen → Anschreiben einfügen → absenden →
Bestätigungs-Screenshot als Beleg speichern. Nutzt dieselbe Adapter/Explorer-Mechanik wie der Scout.

**Harte Grenzen, absichtlich eingebaut:**
- Konten bei Workday & Co. legt Niki **selbst** an. Der Agent registriert nichts.
- Passwörter liegen ausschließlich in den GitHub-Secrets, nie im Code, nie in der Datenbank.
- Bei CAPTCHA, Zwei-Faktor-Abfrage oder unbekannter Formularseite: Status `needs_manual` +
  Telegram-Meldung mit Screenshot und Direktlink. Er versucht **nicht**, die Sperre zu umgehen.
- Vor jedem echten Absenden ein `--dry-run`-Durchlauf, der alles macht außer klicken.

### 5. Mail — verschickt und verfolgt (`engine/mail.ts`)

Verschickt Anschreiben + Lebenslauf-PDF an die Kontaktadresse der Anzeige.
Liest zusätzlich per IMAP das Bewerbungs-Postfach aus — **nicht um Jobs zu finden**, sondern um
Antworten von Firmen (Einladung, Absage, Rückfrage) dem richtigen Job zuzuordnen, damit die
Oberfläche den echten Stand zeigt und Telegram dich bei einer Einladung sofort informiert.

## Bauphasen

Jede Phase endet mit etwas, das läuft. Nicht alles auf einmal.

**Phase 0 — Vorbereitung (Niki, ohne Code)**
- Bewerbungs-Mailadresse anlegen (löst den offenen Punkt aus `apply-ai.md`)
- Profil anlegen auf allen sechs Portalen (hokify, willhaben, AMS, StudentJob, karriere.at, Indeed)
- Konten bei den Portalen anlegen, auf denen automatisch beworben werden soll (Workday)
- Anthropic-Konto: API-Schlüssel + **Ausgabenlimit auf 15 €/Monat** setzen
- Supabase-Projekt (gratis) und privates GitHub-Projekt anlegen
- Lebenslauf wiederfinden (laut Notiz vermutlich in Downloads) und als PDF exportieren

**Phase 1 — Fundament**
Projektgerüst mit den zwei Ordnern, Datenbank-Tabellen anlegen, Lebenslauf + Profiltext in
Supabase, Verbindungstest zu Claude und zur Datenbank.
*Fertig, wenn:* ein Testskript den Lebenslauf lädt und Claude „Hallo" antwortet.

**Phase 2 — Scout am Rechner**
Playwright-Grundgerüst und der erste Portal-Adapter (hokify), lokal auf Nikis Rechner mit
sichtbarem Browser — damit man zusehen kann, was der Agent tut. Anzeigen landen in der Datenbank.
*Fertig, wenn:* der Browser sich sichtbar durch hokify klickt und echte Wiener Anzeigen speichert.

**Phase 3 — Score + Zeitplan**
KJBG-Code-Filter, Bewertung mit Haiku 4.5, dann der Scout in GitHub Actions alle 8 Stunden.
Weitere Adapter nach Reihenfolge: willhaben, AMS, StudentJob, karriere.at, zuletzt Indeed.
*Fertig, wenn:* nach einer Nacht ohne Zutun bewertete Anzeigen aus mehreren Portalen dastehen.

**Phase 4 — Explorer**
Die KI-gesteuerte Betriebsart für kaputte Adapter. Test: einen Adapter absichtlich zerstören und
prüfen, ob der Explorer trotzdem durchkommt.
*Fertig, wenn:* der Scout eine Layout-Änderung selbst überlebt und Bescheid gibt.

**Phase 5 — Oberfläche**
Next.js auf Vercel: Liste der Jobs mit Punktzahl und Begründung, Detailansicht, Freigeben/Ablehnen,
Regeln und Portale bearbeiten. Als Handy-App installierbar (Web-App-Manifest).
*Fertig, wenn:* Niki am Handy durch die Treffer wischen und freigeben kann.

**Phase 6 — Writer + Telegram**
Anschreiben mit Opus 5, Telegram-Push bei Score 60–79 mit Freigabe-Knopf, Freigabe stößt den Motor
sofort an (statt bis zum nächsten Zeitplan zu warten).
*Fertig, wenn:* Niki eine Telegram-Nachricht mit fertigem Anschreiben bekommt.

**Phase 7 — Mail-Versand**
Erste Woche als Testlauf: Anschreiben gehen an Nikis eigene Adresse statt an Firmen. Danach scharf
schalten, inklusive Vollautomatik ab Score 80. Antwort-Erkennung per IMAP.
*Fertig, wenn:* eine echte Bewerbung rausgegangen und im Verlauf sichtbar ist.

**Phase 8 — Bewerben auf Portalen**
Der Browser-Agent auf Workday. Erst `--dry-run` bis der Ablauf sauber durchläuft, dann echt.
*Fertig, wenn:* eine Portal-Bewerbung mit Bestätigungs-Screenshot abgeschlossen ist.

## Kosten

| Posten | Kosten |
|---|---|
| GitHub Actions (privat, ~900 von 2.000 Freiminuten) | 0 € |
| Supabase (gratis) | 0 € |
| Vercel (gratis) | 0 € |
| Telegram | 0 € |
| **Claude API** | **ca. 3–6 €/Monat** |

Der Browser frisst Rechenzeit, nicht Geld: 3 Läufe/Tag à ~8 Minuten ≈ 720 Minuten/Monat, plus
Bewerbungsläufe — bleibt unter den 2.000 Freiminuten. Der Motor schreibt seinen Minutenverbrauch in
`events` mit; wenn es eng wird, reichen 2 Läufe pro Tag.

Die API ist der einzige echte Kostenpunkt — **Claude Pro deckt sie nicht ab**, das ist getrennt
abgerechnet. Absicherung: hartes Ausgabenlimit im Anthropic-Konto (Phase 0) plus Kostenzählung pro
Lauf in `events`.

## Risiken, ehrlich benannt

- **Portale können dichtmachen.** Der Explorer fängt Layout-Änderungen ab, aber gegen eine echte
  Bot-Sperre hilft er nicht. Antwort darauf: sofortige Telegram-Meldung und ein `portals`-Eintrag,
  damit du siehst welches Portal ausgefallen ist — statt dass die Suche still versandet. Als
  Notausgang lässt sich jederzeit ein Portal-Suchagent per Mail nachrüsten.
- **Der Browser-Agent bleibt der brüchigste Teil.** Deshalb steht er in Phase 8 — Apply AI
  funktioniert vorher schon vollständig über E-Mail-Bewerbungen.
- **Vollautomatik ab Score 80 kann Türen zubrennen.** Ein schlechtes Anschreiben an einen kleinen
  Wiener Betrieb lässt sich nicht zurücknehmen. Der Testlauf in Phase 7 ist genau dafür da — nicht
  um die Entscheidung zurückzudrehen, sondern um vorher zu sehen, was rausgeht.
- **Vercel Hobby ist nur für private Nutzung erlaubt.** Für Nikis eigene Jobsuche passt das; falls
  daraus je ein Dienst für andere wird, braucht es einen bezahlten Plan.

## Wie geprüft wird

- **Pro Agent ein eigenes Skript**, das sich einzeln von Hand starten lässt
  (`npm run scout`, `npm run score`, …) — kein Warten auf den Zeitplan zum Testen.
- **`HEADFUL=1`**: Jeder Browser-Lauf lässt sich lokal mit sichtbarem Fenster starten. Man sieht
  dem Agenten beim Suchen und Ausfüllen zu — der schnellste Weg, Fehler zu finden.
- **Screenshot bei jedem Schritt** im GitHub-Lauf, als Anhang gespeichert. Wenn nachts etwas
  schiefgeht, ist morgens sichtbar wo.
- **`--dry-run` überall, wo etwas nach außen geht** (Mail, Portal-Absenden).
- **Testlauf in Phase 7:** alle Bewerbungen gehen eine Woche lang an Nikis eigene Adresse.
- **Bewertungs-Kontrolle:** Niki geht die ersten ~20 bewerteten Anzeigen händisch durch und
  vergleicht mit seinem Bauchgefühl. Weichen die Punktzahlen ab, wird die Anweisung an Score
  nachgeschärft, bevor irgendetwas automatisch rausgeht.
- **Endtest:** eine echte Anzeige geht von „Scout findet sie" bis „Bestätigung im Verlauf" komplett
  durch, ohne Handgriff.

## Was danach ins Wiki gehört

`Vision/wiki/themen/apply-ai.md` aktualisieren: offene Punkte (Mailadresse, Planungsdokumente)
abhaken, die getroffenen Entscheidungen und den Kostenrahmen ergänzen.
