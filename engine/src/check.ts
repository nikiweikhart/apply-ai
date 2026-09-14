/**
 * Verbindungstest - der Abschluss von Phase 1.
 *
 * Prueft der Reihe nach: Zugangsdaten da? Datenbank erreichbar? Tabellen
 * angelegt? Lebenslauf vorhanden? Antwortet Claude?
 * Jeder Schritt sagt bei einem Fehler, was genau zu tun ist.
 *
 * Starten mit:  npm run check
 */
import { existsSync, statSync } from "node:fs";
// Eigener Name (nicht "env"): weiter unten wird das Modul absichtlich noch
// einmal dynamisch importiert, um die werfenden Pflichtangaben-Getter
// abzufangen - ein zweiter "env" wuerde damit kollidieren.
import { env as envKonfig, MODELS } from "./lib/env.ts";

const LEBENSLAUF_PDF = envKonfig.cvPath;

let fehler = 0;

function ok(text: string) {
  console.log(`  OK    ${text}`);
}
function fehlt(text: string, tipp: string) {
  console.log(`  FEHLT ${text}\n        -> ${tipp}`);
  fehler++;
}

console.log("\nApply AI - Verbindungstest\n" + "=".repeat(50));

// ---------------------------------------------------------------- 1. Zugangsdaten
console.log("\n1. Zugangsdaten (.env)");
let env: typeof import("./lib/env.ts").env | undefined;
try {
  const mod = await import("./lib/env.ts");
  env = mod.env;
  void env.anthropicKey;
  void env.supabaseUrl;
  void env.supabaseKey;
  ok("Alle Pflichtangaben vorhanden");
} catch (e) {
  fehlt("Zugangsdaten unvollstaendig", (e as Error).message);
}

// ---------------------------------------------------------------- 2. Datenbank
console.log("\n2. Datenbank (Supabase)");
if (env) {
  try {
    const { db } = await import("./lib/supabase.ts");

    const { error: sErr } = await db.from("settings").select("id").limit(1);
    if (sErr) throw new Error(sErr.message);
    ok("Verbindung steht, Tabelle 'settings' gefunden");

    const { data: portale, error: pErr } = await db
      .from("portals")
      .select("id, display_name, enabled");
    if (pErr) throw new Error(pErr.message);
    ok(`${portale?.length ?? 0} Portale eingetragen: ${(portale ?? []).map((p) => p.id).join(", ")}`);
  } catch (e) {
    fehlt(
      "Datenbank nicht erreichbar oder Tabellen fehlen",
      `${(e as Error).message}\n           Inhalt von db/schema.sql im Supabase "SQL Editor" ausfuehren.`,
    );
  }
} else {
  fehlt("Uebersprungen", "Erst die Zugangsdaten in Ordnung bringen.");
}

// ---------------------------------------------------------------- 3. Lebenslauf
console.log("\n3. Lebenslauf");
if (existsSync(LEBENSLAUF_PDF)) {
  const kb = Math.round(statSync(LEBENSLAUF_PDF).size / 1024);
  ok(`PDF gefunden (${kb} KB)`);
} else {
  fehlt("Lebenslauf-PDF nicht gefunden", `Erwartet unter: ${LEBENSLAUF_PDF}`);
}

// ---------------------------------------------------------------- 4. Claude
console.log("\n4. Claude API");
if (env) {
  try {
    const { claude, kosten } = await import("./lib/claude.ts");
    const antwort = await claude.messages.create({
      model: MODELS.fast,
      max_tokens: 64,
      messages: [
        {
          role: "user",
          content: "Antworte mit genau einem kurzen deutschen Satz: bestaetige, dass du erreichbar bist.",
        },
      ],
    });

    const text = antwort.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();

    const c = kosten(MODELS.fast, antwort.usage.input_tokens, antwort.usage.output_tokens);
    ok(`${MODELS.fast} antwortet: "${text}"`);
    ok(`Kosten dieses Aufrufs: ${(c * 100).toFixed(4)} US-Cent`);
  } catch (e) {
    fehlt("Claude nicht erreichbar", (e as Error).message);
  }
} else {
  fehlt("Uebersprungen", "Erst die Zugangsdaten in Ordnung bringen.");
}

// ---------------------------------------------------------------- Ergebnis
console.log("\n" + "=".repeat(50));
if (fehler === 0) {
  console.log("Alles bereit. Phase 1 abgeschlossen - weiter mit dem Scout.\n");
} else {
  console.log(`${fehler} Punkt(e) offen. Oben steht bei jedem, was zu tun ist.\n`);
  process.exitCode = 1;
}
