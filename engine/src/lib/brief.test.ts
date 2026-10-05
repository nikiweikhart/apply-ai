/**
 * Pruefstuecke fuer lib/brief.ts - echte Faelle aus der Datenbank vom
 * 2026-10-05, vor dem ersten echten Versand.
 *
 * Starten mit:  npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { briefAufraeumen, istPortalAdresse } from "./brief.ts";

const NAME = "Nikolaus Weikhart";

test("Portal-Adressen (auch hokifys apply.job-Adresse) werden erkannt, Firmenadressen nicht", () => {
  assert.equal(istPortalAdresse("info@studentjob.at"), true);
  assert.equal(istPortalAdresse("Support@Willhaben.at"), true);
  assert.equal(istPortalAdresse("jobs@mail.karriere.at"), true);
  assert.equal(istPortalAdresse("apply.job.28547499@hokifyjob.com"), true);
  assert.equal(istPortalAdresse("office@allinevents.at"), false);
  assert.equal(istPortalAdresse("bewerbung-at@kik.at"), false);
});

test("Backtick-Reste mitten im Satz verschwinden", () => {
  const roh = "Mein Englisch nutze ich gerne im Gästekontakt.```; ich lerne schnell.\n\nMit freundlichen Grüßen\nNikolaus Weikhart";
  const t = briefAufraeumen(roh, NAME);
  assert.equal(t.includes("`"), false);
  assert.match(t, /Gästekontakt\.; ich lerne/);
});

test("fehlende Grussformel wird vor dem Namen eingefuegt", () => {
  const roh = "Sehr geehrte Damen und Herren,\n\nText.\n\nÜber die Einladung würde ich mich freuen.\n\nNikolaus Weikhart";
  const t = briefAufraeumen(roh, NAME);
  assert.ok(t.endsWith("freuen.\n\nMit freundlichen Grüßen\nNikolaus Weikhart"), t);
});

test("vorhandene Grussformel bleibt unveraendert", () => {
  const roh = "Sehr geehrte Damen und Herren,\n\nText.\n\nMit freundlichen Grüßen\n\nNikolaus Weikhart";
  assert.equal(briefAufraeumen(roh, NAME), roh);
});
