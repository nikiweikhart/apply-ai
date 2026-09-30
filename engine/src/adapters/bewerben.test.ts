/**
 * Pruefstuecke fuer die Erfolgserkennung beim Absenden (seit 2026-09-30).
 *
 * Die Frage "ist die Bewerbung wirklich raus?" entscheidet, ob eine
 * Bewerbung `sent` wird - und `sent` wird nie wieder angefasst. Ein falsches
 * "ja" heisst: Niki glaubt, er hat sich beworben, und hat es nicht. Ein
 * falsches "nein" ist harmlos (dann `unsicher`, Niki prueft selbst).
 *
 * Starten mit:  npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ERFOLGS_MUSTER, erfolgNeuAufgetaucht } from "./bewerben.ts";

/** Echter Text von hokifys Vorschau-Seite (2026-09-30, gekuerzt). */
const HOKIFY_VORSCHAU =
  "Bewerbungsvorschau 1/2\n\nAlle Angaben korrekt? 👀\n\nPrüfe deine Antworten & persönlichen Angaben, " +
  "bevor du deine Bewerbung abschickst!\n\nDeine Antworten\nWarum bist du für diesen Job geeignet?";

/** karriere.at-Vorschau mit Anschreiben, das selbst "Vielen Dank" sagt. */
const KARRIERE_VORSCHAU =
  "Bewerbungsvorschau\nAnmerkungen zur Bewerbung\nSehr geehrte Damen und Herren, ... " +
  "Vielen Dank für Ihre Zeit und die Prüfung meiner Bewerbung.\nEingaben ändern\nBewerbung abschließen";

test("Vorschau-Seiten selbst sind KEIN Erfolg", () => {
  assert.equal(erfolgNeuAufgetaucht("", HOKIFY_VORSCHAU, ERFOLGS_MUSTER), null);
  assert.equal(erfolgNeuAufgetaucht("", KARRIERE_VORSCHAU, ERFOLGS_MUSTER), null);
});

test("unveraenderte Seite nach dem Klick ist KEIN Erfolg", () => {
  assert.equal(erfolgNeuAufgetaucht(HOKIFY_VORSCHAU, HOKIFY_VORSCHAU, ERFOLGS_MUSTER), null);
});

test("typische Erfolgsmeldungen werden erkannt, wenn sie NEU sind", () => {
  for (const meldung of [
    "Deine Bewerbung wurde erfolgreich versendet!",
    "Vielen Dank für deine Bewerbung",
    "Danke für Ihre Bewerbung bei Manufactum",
    "Bewerbung erfolgreich übermittelt",
    "Du hast dich erfolgreich beworben",
    "Deine Bewerbung ist unterwegs",
  ]) {
    assert.notEqual(erfolgNeuAufgetaucht(KARRIERE_VORSCHAU, meldung, ERFOLGS_MUSTER), null, meldung);
  }
});

test("Erfolgstext, der schon VOR dem Klick da war, zaehlt nicht", () => {
  const vorher = "Du hast dich bereits beworben (Hinweis oben auf der Seite)";
  assert.equal(erfolgNeuAufgetaucht(vorher, vorher + "\nirgendwas anderes", ERFOLGS_MUSTER), null);
});
