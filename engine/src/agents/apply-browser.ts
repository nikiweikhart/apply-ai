/**
 * apply-browser - bewirbt sich auf den Portalen, wo es keine Mailadresse gibt.
 *
 * Nimmt alle Bewerbungen mit Status `approved` und Weg `portal` (also: der
 * Writer hat keine Kontaktadresse in der Anzeige gefunden). Fuer jede wird
 * zuerst die Original-Anzeige noch einmal aufgerufen - zwei Wochen zwischen
 * Fund und Freigabe sind keine Seltenheit, und eine abgelaufene Anzeige soll
 * nicht stumm als "approved" liegen bleiben.
 *
 * Danach zwei Wege, je Portal:
 *
 *   1. **Adapter gebaut + Anmeldung gespeichert** (`PORTAL_ADAPTER`,
 *      `eingeloggtBei()`). Niki loggt sich bei hokify und karriere.at ueber
 *      "Mit Google anmelden" ein - es gibt also kein eigenes Passwort, das
 *      hier stehen koennte. Stattdessen einmalig `npm run anmelden <portal>`
 *      (eigenes Chrome-Profil unter `engine/.auth/`, siehe `lib/browser.ts`).
 *      Der Adapter bekommt dann eine schon eingeloggte Seite.
 *   2. **Sonst: `needs_manual`.** Apply AI erfindet keine Bewerbung, die es
 *      nicht wirklich abschicken kann. Niki bekommt den Direktlink per
 *      Telegram und bewirbt sich in dem Fall selbst.
 *
 * Seit 2026-09-30 (Nikis Entscheidung) schicken hokify und karriere.at
 * WIRKLICH selbst ab - vorher blieben beide an der Portal-Vorschau stehen.
 * Nach jedem echten Absenden kommt eine Telegram-Nachricht "✅ abgeschickt"
 * mit allem, was der Bot im Formular angegeben hat. Ist nach dem Klick nicht
 * eindeutig ein Erfolgstext zu sehen, gilt die Bewerbung NICHT als `sent`,
 * sondern `needs_manual` mit der Marke "UNSICHER" - und wird von `nochmal`
 * nie ein zweites Mal versucht (sonst droht eine doppelte Bewerbung).
 * `PORTAL_VORSCHAU_STOPP=1` in der .env stellt das alte Anhalten wieder her.
 * willhaben bleibt ohne Adapter (siehe docs/stand.md).
 *
 * Sicherheitsnetz wie ueberall: `DRY_RUN` (Standard: an) zeigt nur, was
 * passieren wuerde - nichts wird in der Datenbank geaendert, keine
 * Telegram-Nachricht geschickt, kein Formular angefasst.
 *
 * Nie abgeschickt wird, unabhaengig vom Status: jede Firma aus
 * `settings.exclusions.firmen` (z.B. McDonald's) und alles in `NIE_ABSCHICKEN`.
 *
 * Starten mit:
 *   npm run apply                  alle freigegebenen Portal-Bewerbungen
 *   npm run apply 1                nur eine (zum Ausprobieren)
 *   npm run apply nochmal          zusaetzlich haengende (`needs_manual`) von
 *                                  Portalen mit Adapter - ausser "UNSICHER"
 *   npm run apply nochmal nur:123  nur die Anzeige, deren Adresse 123 enthaelt
 */
import { db } from "../lib/supabase.ts";
import { log } from "../lib/log.ts";
import { env } from "../lib/env.ts";
import { sendeNachricht, telegramEingerichtet } from "../lib/telegram.ts";
import { browserMitProfilStarten, browserStarten, cookiesAblehnen, eingeloggtBei, screenshot, warte } from "../lib/browser.ts";
import { hokifyBewerben } from "../adapters/hokify-bewerben.ts";
import { karriereBewerben } from "../adapters/karriere-bewerben.ts";
import { UNSICHER_MARKE, type BewerbungsAdapter } from "../adapters/bewerben.ts";
import type { Page } from "playwright";

/**
 * hokify und karriere.at sind gebaut (Baureihenfolge wie beim Scout).
 * willhaben bleibt absichtlich draussen - dort gibt es keinen portaleigenen
 * Bewerbungsablauf (siehe docs/stand.md, 2026-09-13).
 */
const PORTAL_ADAPTER: Record<string, BewerbungsAdapter> = {
  hokify: hokifyBewerben,
  karriere: karriereBewerben,
};

/**
 * Anzeigen, die NIE abgeschickt werden, egal welcher Status in der Datenbank
 * steht. hokify.at/apply/28943952: dort ist serverseitig noch die falsche
 * Antwort "Warst du bereits bei McDonald's taetig? -> Ja" gespeichert (aus
 * einem Testlauf vor dem Bugfix vom 2026-09-13). Ist ohnehin McDonald's und
 * `rejected`, steht hier aber ausdruecklich, damit es nie davon abhaengt.
 */
const NIE_ABSCHICKEN = ["hokify.at/job/28943952", "hokify.at/apply/28943952"];

// ------------------------------------------------------------- Aufrufparameter
const argv = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const MAX = Number(argv.find((a) => /^\d+$/.test(a)) ?? 999);
const NOCHMAL = argv.includes("nochmal");
const NUR = argv.find((a) => a.startsWith("nur:"))?.slice(4) ?? null;

// ------------------------------------------------------------- Kandidaten
const { data: bereite, error: ladeFehler } = await db
  .from("applications")
  .select("job_id, status, error, cover_letter, created_at, jobs(id, title, company, url, portal_id)")
  .in("status", NOCHMAL ? ["approved", "needs_manual"] : ["approved"])
  .eq("channel", "portal")
  .order("created_at");

if (ladeFehler) {
  console.error(`X  [apply-browser] Bewerbungen nicht ladbar: ${ladeFehler.message}`);
  process.exit(1);
}

const { data: einstellungen } = await db.from("settings").select("exclusions").eq("id", 1).single();
const ausgeschlosseneFirmen = (((einstellungen?.exclusions ?? {}) as { firmen?: string[] }).firmen ?? [])
  .map((f) => f.trim().toLowerCase())
  .filter(Boolean);

type Anzeige = { id: string; title: string; company: string | null; url: string; portal_id: string | null };

const alle = (bereite ?? [])
  .map((a) => ({
    jobId: a.job_id as string,
    status: a.status as string,
    fehler: (a.error as string | null) ?? "",
    anschreiben: a.cover_letter as string | null,
    job: a.jobs as unknown as Anzeige | null,
  }))
  .filter((k): k is typeof k & { job: Anzeige } => k.job !== null);

/** Warum eine Bewerbung in diesem Lauf nicht angefasst wird - oder null. */
function ausgelassenWeil(k: (typeof alle)[number]): string | null {
  const firma = (k.job.company ?? "").toLowerCase();
  const gesperrt = ausgeschlosseneFirmen.find((f) => firma.includes(f));
  if (gesperrt) return `Firma ausgeschlossen (${gesperrt})`;
  if (NIE_ABSCHICKEN.some((u) => k.job.url.includes(u))) return "steht auf NIE_ABSCHICKEN";
  if (k.status === "needs_manual") {
    // `nochmal` nimmt nur haengende Bewerbungen von Portalen, auf denen der
    // Bot wirklich selbst bewerben kann - willhaben-Links bleiben bei Niki.
    if (!PORTAL_ADAPTER[k.job.portal_id ?? ""]) return "kein Adapter fuer dieses Portal";
    if (k.fehler.startsWith(UNSICHER_MARKE)) return "war UNSICHER, ob schon abgeschickt - nie automatisch wiederholen";
  }
  if (NUR && !k.job.url.includes(NUR)) return "nicht ausgewaehlt (nur:)";
  return null;
}

const ausgelassen = alle.map((k) => ({ k, grund: ausgelassenWeil(k) })).filter((x) => x.grund !== null);
const kandidaten = alle.filter((k) => ausgelassenWeil(k) === null).slice(0, MAX);

console.log(
  `\nApply AI - Browser-Bewerbung\n${"=".repeat(60)}\n` +
    `${kandidaten.length} Portal-Bewerbung(en) dran` +
    (NOCHMAL ? " (inkl. haengender needs_manual)" : "") +
    `\nDRY_RUN: ${env.dryRun ? "AN - es wird nichts geaendert oder geschickt" : "AUS"}` +
    `\nAbsenden: ${env.portalVorschauStopp ? "NEIN - Stopp an der Portal-Vorschau (PORTAL_VORSCHAU_STOPP=1)" : "JA"}\n`,
);
for (const { k, grund } of ausgelassen) {
  if (grund === "nicht ausgewaehlt (nur:)") continue;
  console.log(`  ausgelassen: ${k.job.company ?? "?"} - ${k.job.title.slice(0, 45)}  -> ${grund}`);
}

// Kein frueher process.exit(0): siehe die anderen Agenten - eine leere
// `kandidaten`-Liste durchlaeuft den Rest folgenlos.
let abgelaufen = 0;
let manuellNoetig = 0;
let erledigt = 0;
let unsicher = 0;
let wuerde = 0;

if (kandidaten.length === 0) {
  console.log("Nichts zu tun.\n");
} else {
  const { page, schliessen } = await browserStarten();

  try {
    for (const k of kandidaten) {
      const job = k.job;
      console.log(`\n${job.title.slice(0, 55)}  (${job.company ?? "?"})  [${k.status}]\n    ${job.url}`);

      let nochDa = true;
      try {
        await page.goto(job.url, { waitUntil: "domcontentloaded" });
        await cookiesAblehnen(page);
        await warte(800, 1200);
        nochDa = !(await seiteZeigtAbgelaufen(page));
      } catch (e) {
        console.log(`    Seite nicht erreichbar: ${(e as Error).message.slice(0, 150)}`);
        nochDa = false;
      }

      if (!nochDa) {
        abgelaufen++;
        const fehlertext = "Anzeige ist nicht mehr verfuegbar (Seite pruefen vor der Bewerbung).";
        console.log(`    ABGELAUFEN - ${fehlertext}`);
        if (!env.dryRun) {
          const bild = await screenshot(page, `apply-abgelaufen-${job.portal_id ?? "portal"}`);
          await db
            .from("applications")
            .update({ status: "failed", error: fehlertext, proof_path: bild ?? null })
            .eq("job_id", k.jobId);
          await log("browser", "warn", `Anzeige abgelaufen: ${job.title}`, { jobId: k.jobId, data: { firma: job.company, url: job.url } });
        }
        await warte(1500, 2500);
        continue;
      }

      const portalId = job.portal_id ?? "";
      const adapter = PORTAL_ADAPTER[portalId];

      if (adapter && eingeloggtBei(portalId)) {
        // Eigener, eingeloggter Browser fuer diesen einen Bewerbungsversuch -
        // die geteilte `page` oben bleibt bewusst ohne Anmeldung, weil sie nur
        // zum Pruefen der Anzeige dient (das braucht kein Konto).
        const eingeloggt = await browserMitProfilStarten(portalId);
        try {
          await eingeloggt.page.goto(job.url, { waitUntil: "domcontentloaded" });
          await cookiesAblehnen(eingeloggt.page);
          await warte(800, 1200);

          // Zweite, spaetere Pruefung: der erste Check oben kann eine Anzeige
          // verpassen, die genau zwischen den beiden Seitenaufrufen verschwindet.
          if (await seiteZeigtAbgelaufen(eingeloggt.page)) {
            abgelaufen++;
            const fehlertext = "Anzeige ist nicht mehr verfuegbar (erst beim zweiten Aufruf bemerkt).";
            console.log(`    ABGELAUFEN - ${fehlertext}`);
            if (!env.dryRun) {
              const bild = await screenshot(eingeloggt.page, `apply-abgelaufen-${portalId}`);
              await db
                .from("applications")
                .update({ status: "failed", error: fehlertext, proof_path: bild ?? null })
                .eq("job_id", k.jobId);
              await log("browser", "warn", `Anzeige abgelaufen (spaet bemerkt): ${job.title}`, {
                jobId: k.jobId,
                data: { firma: job.company, url: job.url },
              });
            }
            continue;
          }

          const r = await adapter(eingeloggt.page, {
            anschreiben: k.anschreiben ?? "",
            lebenslaufPfad: env.cvPath,
          });

          if (r.ergebnis === "trockenlauf") {
            wuerde++;
            console.log(`    WUERDE RAUSGEHEN - ${r.belegText}`);
          } else if (r.ergebnis === "abgeschickt") {
            erledigt++;
            console.log(`    ABGESCHICKT - ${r.belegText}`);
            const bild = await screenshot(eingeloggt.page, `apply-abgeschickt-${portalId}`);
            await db
              .from("applications")
              .update({ status: "sent", sent_at: new Date().toISOString(), error: null, proof_path: bild ?? null })
              .eq("job_id", k.jobId);
            await log("browser", "info", `Portal-Bewerbung abgeschickt: ${job.title}`, {
              jobId: k.jobId,
              data: { firma: job.company, portal: portalId, beleg: r.belegText },
            });
            await telegram(
              `✅ abgeschickt (${portalId})\n${job.company ?? "?"}\n${job.title}\n\n${r.belegText}\n\n` +
                `Was der Bot angegeben hat:\n${r.zusammenfassung}\n\n${job.url}`,
            );
          } else if (r.ergebnis === "unsicher") {
            unsicher++;
            const fehlertext = `${UNSICHER_MARKE}. ${r.belegText}`;
            console.log(`    UNSICHER - ${fehlertext}`);
            const bild = await screenshot(eingeloggt.page, `apply-unsicher-${portalId}`);
            await db
              .from("applications")
              .update({ status: "needs_manual", error: fehlertext, proof_path: bild ?? null })
              .eq("job_id", k.jobId);
            await log("browser", "warn", `Portal-Bewerbung unsicher: ${job.title}`, {
              jobId: k.jobId,
              data: { firma: job.company, portal: portalId, screenshot: bild ?? null },
            });
            await telegram(
              `❓ unsicher, ob abgeschickt - bitte pruefen (${portalId})\n${job.company ?? "?"}\n${job.title}\n\n` +
                `${r.belegText}\n\nWas der Bot angegeben hat:\n${r.zusammenfassung}\n\n${job.url}`,
            );
          } else {
            // "vorschau": PORTAL_VORSCHAU_STOPP=1 - Niki schickt selbst ab.
            manuellNoetig++;
            console.log(`    AN DER VORSCHAU ANGEHALTEN - ${r.belegText}`);
            const bild = await screenshot(eingeloggt.page, `apply-vorschau-${portalId}`);
            await db
              .from("applications")
              .update({ status: "needs_manual", error: r.belegText, proof_path: bild ?? null })
              .eq("job_id", k.jobId);
            await telegram(
              `⚠ Portal-Bewerbung braucht dich\n${job.title}\n${job.company ?? "?"}\n\n${r.belegText}\n\n` +
                `${r.zusammenfassung}\n\n${job.url}`,
            );
          }
        } catch (e) {
          manuellNoetig++;
          const fehlertext = (e as Error).message.slice(0, 300);
          console.log(`    HAENGT - braucht Niki: ${fehlertext}`);
          if (!env.dryRun) {
            const bild = await screenshot(eingeloggt.page, `apply-manuell-${portalId}`);
            await db
              .from("applications")
              .update({ status: "needs_manual", error: fehlertext, proof_path: bild ?? null })
              .eq("job_id", k.jobId);
            await telegram(`⚠ Portal-Bewerbung braucht dich\n${job.title}\n${job.company ?? "?"}\n\n${fehlertext}\n\n${job.url}`);
            await log("browser", "warn", `Portal-Bewerbung braucht Niki: ${job.title}`, { jobId: k.jobId, data: { firma: job.company, fehler: fehlertext } });
          }
        } finally {
          await eingeloggt.schliessen();
        }
      } else {
        manuellNoetig++;
        const grund = !adapter
          ? `Fuer "${portalId}" ist noch kein Bewerbungs-Adapter gebaut.`
          : `Noch keine gespeicherte Anmeldung fuer "${portalId}" - Apply AI kann sich dort noch nicht selbst bewerben. ` +
            `Hilft: npm run anmelden ${portalId}`;
        console.log(`    NOCH MANUELL - ${grund}`);
        if (!env.dryRun) {
          await db.from("applications").update({ status: "needs_manual", error: grund }).eq("job_id", k.jobId);
          await telegram(`⚠ Portal-Bewerbung braucht dich\n${job.title}\n${job.company ?? "?"}\n\n${grund}\n\n${job.url}`);
          await log("browser", "info", `Portal-Bewerbung noch manuell: ${job.title}`, { jobId: k.jobId, data: { firma: job.company, grund } });
        }
      }

      await warte(2000, 3500);
    }
  } finally {
    await schliessen();
  }
}

console.log(
  `${"=".repeat(60)}\n` +
    (env.dryRun
      ? `${wuerde} wuerden rausgehen, ${manuellNoetig} brauchen Niki, ${abgelaufen} abgelaufen.\n` +
        "Trockenlauf - nichts wurde abgeschickt oder in der Datenbank geaendert.\n"
      : `${erledigt} abgeschickt, ${unsicher} unsicher, ${manuellNoetig} brauchen Niki, ${abgelaufen} abgelaufen.\n`),
);

// ------------------------------------------------------------- Hilfsfunktionen

/** Schaut, ob die Anzeige noch da ist oder das Portal sie schon entfernt hat. */
async function seiteZeigtAbgelaufen(page: Page): Promise<boolean> {
  const text = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  const MUSTER = [
    "nicht mehr verfügbar",
    "nicht mehr aktiv",
    "wurde bereits gelöscht",
    "seite nicht gefunden",
    "diese anzeige ist abgelaufen",
    "job wurde entfernt",
  ];
  return MUSTER.some((m) => text.includes(m));
}

/** Telegram-Nachricht an Niki - ein Fehler dabei bricht den Lauf nicht ab. */
async function telegram(text: string): Promise<void> {
  if (!telegramEingerichtet()) return;
  try {
    await sendeNachricht(text);
  } catch (e) {
    console.log(`    Telegram-Meldung fehlgeschlagen: ${(e as Error).message.slice(0, 150)}`);
  }
}
