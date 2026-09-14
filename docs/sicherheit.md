# Sicherheit und Grenzen

## Was der Bot bewusst NICHT tut

- **Keine Konten anlegen.** Zugänge bei Workday & Co. legt Niki selbst an.
- **Keine CAPTCHAs lösen, keine Bot-Sperren umgehen.** Stößt der Bot auf eine
  Sperre, setzt er den Status auf `needs_manual`, macht einen Screenshot und
  meldet sich per Telegram. Fertig.
- **Keine Passwörter im Code oder in der Datenbank.** Nur in `.env` (lokal) und
  in den GitHub-Secrets (automatischer Betrieb).

## Wo welcher Schlüssel hingehört

| Schlüssel | Wo | Warum |
|---|---|---|
| `SUPABASE_SERVICE_KEY` | nur Motor | Umgeht die Datenbanksperre — darf nie in die Website |
| `ANTHROPIC_API_KEY` | nur Motor | Kostet Geld, wenn er abhandenkommt |
| Portal-Passwörter | nur GitHub-Secrets | Zugang zu echten Bewerberkonten |

## Kostenbremse

1. Hartes Ausgabenlimit im Anthropic-Konto (Console → Limits).
2. Jeder KI-Aufruf schreibt Tokenzahl und Kosten in die Tabelle `events`.
3. Modellwahl: Bewerten mit Haiku 4.5 (günstig), nur Anschreiben mit Opus 5.
4. Der Jugendschutz-Filter läuft als reiner Code **vor** der KI — was dort
   rausfällt, kostet nichts.

## Vollautomatik ab Punktzahl 80

Bewusste Entscheidung von Niki (2026-07-24). Absicherung davor:
- Erste Woche Testlauf: alle Bewerbungen gehen an Nikis eigene Adresse.
- Die ersten ~20 Bewertungen werden von Hand gegengeprüft, bevor scharf
  geschaltet wird.
- `DRY_RUN=1` ist der Standard und muss aktiv abgeschaltet werden.
