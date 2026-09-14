# Apply AI

Ein Bewerbungsbot, der selbstständig auf österreichischen Jobportalen nach einem
Samstagsjob sucht, Treffer gegen ein Profil bewertet, Anschreiben schreibt und
Bewerbungen verschickt — per Mail vollautomatisch, auf Jobportalen bis zur
letzten Bestätigung vor dem Absenden.

Gebaut von Grund auf mit [Claude Code](https://claude.com/claude-code): Motor
in GitHub Actions, Datenbank in Supabase, Freigaben per Telegram.

## Wie es funktioniert

```
   einmal täglich   ┌──────────────────────────────┐
   ───────────────► │  MOTOR (GitHub Actions)      │
                     │  echter Chrome läuft hier     │
                     │  scout → score → write        │
                     └──────────────┬────────────────┘
                                    │ liest & schreibt
                     ┌──────────────▼────────────────┐
                     │  DATENBANK (Supabase)          │
                     └──────────────┬────────────────┘
                                    │
                     ┌──────────────▼────────────────┐
                     │  mail (automatisch ab Score X)  │
                     │  apply-browser (lokal, s.u.)    │
                     └────────────────────────────────┘

   Telegram ←── Push bei Rückfrage, Versand, Einladung, Blockade
```

Sechs Agenten, jeder ein eigenständiges Skript:

| Agent | Aufgabe |
|---|---|
| **Scout** | Geht selbst auf die Portale, filtert Jugendschutz-relevantes, liest Anzeigen |
| **Score** | Vorfilter im Code (rechtlich Unmögliches, eigene No-Gos) + Bewertung 0–100 |
| **Writer** | Schreibt ein Anschreiben zur konkreten Anzeige, eine Bewerbung pro Firma |
| **Freigabe** | Holt Telegram-Knopfdrücke ab, schickt liegengebliebene Entwürfe nach |
| **Mail** | Verschickt freigegebene Bewerbungen, liest Firmenantworten per IMAP |
| **Browser** | Füllt Bewerbungsformulare auf Portalen aus (hokify, karriere.at) |

**Bewertung entscheidet den Weg:** ab `settings.auto_send_min` (Standard 70)
geht eine Bewerbung ohne Rückfrage direkt raus, Telegram bekommt nur eine
Information. Zwischen `approval_min` (60) und dieser Schwelle fragt Apply AI
erst per Telegram-Knopf nach. Darunter wird nur abgelegt, nicht gelöscht.

**Zwei Zustellwege**, je nachdem was die Anzeige hergibt:
- **Mail**, wenn eine Kontaktadresse im Anzeigentext steht — läuft komplett
  automatisch (mit Sicherheitsnetzen, siehe unten).
- **Portal**, sonst. Für hokify und karriere.at füllt der Browser-Agent das
  jeweils eigene Bewerbungsformular aus und stoppt bewusst an der
  Vorschau-Seite des Portals — Niki prüft und schickt selbst ab. Für Portale
  ohne eigenen Bewerbungsablauf (willhaben) oder mit aktiver Bot-Sperre
  (Indeed) bekommt er stattdessen den Direktlink per Telegram.

## Warum Motor und Oberfläche getrennt sind

Eine reine Gratis-Website kann das nicht: Funktionen brechen nach zehn
Sekunden ab, kein echter Browser läuft dort. Apply AI soll sich aber selbst
durch die Portale klicken — deshalb läuft der Motor in GitHub Actions
(kostenlos, beliebiger Zeitplan, echtes Chromium).

Der Browser-Agent für Portal-Bewerbungen läuft bewusst **nicht** dort, sondern
nur lokal: hokify und karriere.at verlangen für die Bewerbung ein eingeloggtes
Konto, und Google blockiert jede Anmeldung aus einem ferngesteuerten Browser
(egal welcher) als Bot-Versuch. Die Lösung: ein ganz normaler, lokaler
Chrome-Prozess mit eigenem Profil, in dem man sich einmal selbst einloggt
(`npm run anmelden <portal>`) — keine Umgehung, sondern schlicht ein
menschlicher Login, den Apply AI danach wiederverwendet.

## Sicherheitsnetze

- **Keine Konten, keine Sperren umgehen.** Apply AI legt keine Portal-Konten
  an und löst keine CAPTCHAs. Trifft ein Agent auf eine Sperre, hört er auf
  und meldet sich per Telegram statt sich vorbeizumogeln.
- **`DRY_RUN=1`** (Standard: an) — überall dort, wo etwas nach außen geht
  (Mail, Portal-Formular), zeigt ein Trockenlauf nur, was passieren würde.
- **`MAIL_TEST_MODE=1`** (Standard: an) — jede Bewerbungsmail geht testweise
  an die eigene Adresse statt an die Firma, bis eine Testwoche lang alles
  richtig ankommt.
- **Firmensperre** — höchstens eine Bewerbung pro Firma innerhalb von 30
  Tagen, damit sechs Standorte derselben Kette nicht sechs Briefe bekommen.
- **Eigene Ausschlussliste** (`settings.exclusions`) — Tätigkeiten und ganze
  Firmen, die Niki nicht will, fliegen schon vor der KI-Bewertung raus.

## Aufbau

| Ordner | Was drin ist |
|---|---|
| `engine/` | Der Motor — die sechs Agenten unter `src/agents/`, Adapter pro Portal unter `src/adapters/`. |
| `db/` | `schema.sql` — der Datenbankaufbau für Supabase. |
| `docs/` | Laufender Baustand, Entscheidungen, geprüfte Portal-Eigenheiten. |
| `.github/workflows/` | `motor.yml` — der tägliche automatische Lauf. |

## Einrichten

1. **Datenbank:** Supabase-Projekt anlegen (gratis), Inhalt von `db/schema.sql`
   im SQL-Editor ausführen.
2. **Zugangsdaten:** `.env.example` kopieren nach `.env` und ausfüllen.
3. **Eigenes Profil:** `engine/src/profil-daten.example.ts` kopieren nach
   `engine/src/profil-daten.ts` und mit den eigenen Daten ausfüllen (bleibt
   ungetrackt, siehe `.gitignore`).
4. **Pakete installieren:**
   ```
   npm install
   npx playwright install chromium
   ```
5. **Testen:**
   ```
   npm run check
   npm run profil
   ```
   `check` prüft Zugangsdaten, Datenbank, Lebenslauf und Claude — und sagt bei
   jedem Problem, was zu tun ist. `profil` schreibt das eigene Profil aus
   Schritt 3 in die Datenbank.
6. **Bei Portalen anmelden** (einmalig, für die Browser-Bewerbung):
   ```
   npm run anmelden hokify
   npm run anmelden karriere
   ```

## Befehle

| Befehl | Was passiert |
|---|---|
| `npm run check` | Verbindungstest |
| `npm run scout` | Portale durchsuchen |
| `npm run score` | Gefundene Anzeigen bewerten |
| `npm run write` | Anschreiben schreiben, pusht sofort per Telegram oder setzt direkt `approved` |
| `npm run anschreiben` | Fertige Anschreiben lesen |
| `npm run freigabe` | Liegengebliebene Entwürfe nachschicken + Telegram-Knöpfe abholen |
| `npm run mail` | Freigegebene Bewerbungen per Mail verschicken |
| `npm run antwort` | Postfach nach Firmenantworten durchsuchen (nur lesend) |
| `npm run apply` | Auf Portalen bewerben (braucht `npm run anmelden` vorher) |
| `npm test` | Firmensperre prüfen, ohne Internet |

Keine Striche vor Zahlen-Argumenten (`npm run scout hokify 5`, nicht `--max 5`)
— npm schluckt sie sonst selbst auf.

## Automatischer Betrieb

`.github/workflows/motor.yml` läuft einmal täglich (05:00 UTC) von selbst:
sucht, bewertet, schreibt Anschreiben, holt Telegram-Freigaben ab. Jeder Lauf
hinterlässt eine kurze Zusammenfassung direkt auf der Actions-Laufseite sowie
Bildschirmfotos als Anhang — damit auch ohne laufenden PC sichtbar ist, was
passiert ist, wenn mal ein Portal dichtmacht. Der Versand per Mail und die
Browser-Bewerbung auf Portalen laufen bewusst lokal, siehe oben.

---

*Persönliche Daten (Name, Adresse, Lebenslauf-Text) stehen bewusst nicht im
Code: `engine/src/seed-profil.ts` liest sie aus `profil-daten.ts`, einer
ungetrackten Datei nach dem Muster von `.env` (Vorlage:
`engine/src/profil-daten.example.ts`). Wer dieses Projekt für sich selbst
nutzen will, kopiert die Vorlage und füllt sie mit den eigenen Daten.*
