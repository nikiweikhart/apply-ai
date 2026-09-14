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
 *      hier stehen koennte. Stattdessen einmalig `npm run anmelden <portal>`:
 *      oeffnet ein sichtbares Fenster, Niki loggt sich selbst ein, das
 *      Programm speichert danach die Cookies in `engine/.auth/<portal>.json`
 *      (siehe `lib/browser.ts`). Der Adapter bekommt dann eine schon
 *      eingeloggte Seite - kein Passwort im Code, nirgends.
 *   2. **Sonst: `needs_manual`.** Apply AI erfindet keine Bewerbung, die es
 *      nicht wirklich abschicken kann. Niki bekommt den Direktlink per
 *      Telegram und bewirbt sich in dem Fall selbst - die Anzeige bleibt im
 *      Verlauf sichtbar statt unbemerkt zu verschwinden.
 *
 * Stand (2026-09-13): hokify und karriere.at haben eigene Adapter (siehe
 * `adapters/`), beide stoppen bewusst an der Vorschau des jeweiligen Portals
 * statt selbst den letzten Absenden-Knopf zu klicken. willhaben bleibt ohne
 * Adapter - dort gibt es keinen portaleigenen Bewerbungsablauf, "Jetzt
 * bewerben" fuehrt zu einer von unzaehligen fremden Firmenseiten (siehe
 * docs/stand.md).
 *
 * Sicherheitsnetz wie ueberall: `DRY_RUN` (Standard: an) zeigt nur, was
 * passieren wuerde - nichts wird in der Datenbank geaendert, keine
 * Telegram-Nachricht geschickt.
 *
 * Starten mit:
 *   npm run apply             alle freigegebenen Portal-Bewerbungen
 *   npm run apply 1           nur eine (zum Ausprobieren)
 */
import { db } from "../lib/supabase.ts";
import { log } from "../lib/log.ts";
import { env } from "../lib/env.ts";
import { sendeNachricht, telegramEingerichtet } from "../lib/telegram.ts";
import { browserMitProfilStarten, browserStarten, cookiesAblehnen, eingeloggtBei, screenshot, warte } from "../lib/browser.ts";
import { hokifyBewerben } from "../adapters/hokify-bewerben.ts";
import { karriereBewerben } from "../adapters/karriere-bewerben.ts";
import type { Page } from "playwright";

/**
 * Ein Portal-Adapter fuer das Bewerben. Bekommt eine Seite, die schon ueber
 * die gespeicherte Anmeldung (`npm run anmelden <portal>`) eingeloggt ist und
 * auf der Anzeige steht, dazu die Bewerbung - und meldet zurueck, ob es
 * geklappt hat. Wirft bei allem, worauf kein zweiter Versuch hilft (CAPTCHA,
 * unbekanntes Formular) - das faengt der Aufrufer als `needs_manual` ab.
 */
type BewerbungsAdapter = (
  page: Page,
  bewerbung: { anschreiben: string; lebenslaufPfad: string },
) => Promise<{ belegText: string }>;

/**
 * hokify und karriere.at sind gebaut (Baureihenfolge wie beim Scout).
 * willhaben bleibt absichtlich draussen - dort gibt es keinen portaleigenen
 * Bewerbungsablauf (siehe docs/stand.md, 2026-09-13).
 */
const PORTAL_ADAPTER: Record<string, BewerbungsAdapter> = {
  hokify: hokifyBewerben,
  karriere: karriereBewerben,
};

// ------------------------------------------------------------- Aufrufparameter
const argv = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const MAX = Number(argv.find((a) => /^\d+$/.test(a)) ?? 999);

// ------------------------------------------------------------- Kandidaten
const { data: bereite, error: ladeFehler } = await db
  .from("applications")
  .select("job_id, cover_letter, jobs(id, title, company, url, portal_id)")
  .eq("status", "approved")
  .eq("channel", "portal")
  .limit(MAX);

if (ladeFehler) {
  console.error(`X  [apply-browser] Bewerbungen nicht ladbar: ${ladeFehler.message}`);
  process.exit(1);
}

type Anzeige = { id: string; title: string; company: string | null; url: string; portal_id: string | null };

const kandidaten = (bereite ?? [])
  .map((a) => ({ jobId: a.job_id as string, anschreiben: a.cover_letter as string | null, job: a.jobs as unknown as Anzeige | null }))
  .filter((k): k is typeof k & { job: Anzeige } => k.job !== null);

console.log(
  `\nApply AI - Browser-Bewerbung\n${"=".repeat(60)}\n` +
    `${kandidaten.length} freigegebene Bewerbung(en) per Portal\n` +
    `DRY_RUN: ${env.dryRun ? "AN - es wird nichts geaendert oder geschickt" : "AUS"}\n`,
);

// Kein frueher process.exit(0): siehe die anderen Agenten - eine leere
// `kandidaten`-Liste durchlaeuft den Rest folgenlos.
let abgelaufen = 0;
let manuellNoetig = 0;
let erledigt = 0;

if (kandidaten.length === 0) {
  console.log("Nichts zu tun.\n");
} else {
  const { page, schliessen } = await browserStarten();

  try {
    for (const k of kandidaten) {
      const job = k.job;
      console.log(`\n${job.title.slice(0, 55)}  (${job.company ?? "?"})\n    ${job.url}`);

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
          // verpassen, die genau zwischen den beiden Seitenaufrufen verschwindet
          // (z.B. bei stark nachgefragten Einstiegsjobs). Ohne diesen Check
          // wuerde der Adapter nur auf einen fehlenden "Jetzt bewerben"-Knopf
          // mit einer kryptischen Timeout-Meldung stossen.
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

          const ergebnis = await adapter(eingeloggt.page, {
            anschreiben: k.anschreiben ?? "",
            lebenslaufPfad: env.cvPath,
          });
          erledigt++;
          console.log(`    ERLEDIGT - ${ergebnis.belegText}`);
          if (!env.dryRun) {
            const bild = await screenshot(eingeloggt.page, `apply-erledigt-${portalId}`);
            await db
              .from("applications")
              .update({ status: "sent", sent_at: new Date().toISOString(), proof_path: bild ?? null })
              .eq("job_id", k.jobId);
            await log("browser", "info", `Portal-Bewerbung abgeschickt: ${job.title}`, { jobId: k.jobId, data: { firma: job.company, portal: portalId } });
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
            await telegramMelden(job, fehlertext);
            await log("browser", "warn", `Portal-Bewerbung braucht Niki: ${job.title}`, { jobId: k.jobId, data: { firma: job.company, fehler: fehlertext } });
          }
        } finally {
          await eingeloggt.schliessen();
        }
      } else {
        manuellNoetig++;
        const grund = !eingeloggtBei(portalId)
          ? `Noch keine gespeicherte Anmeldung fuer "${portalId}" - Apply AI kann sich dort noch nicht selbst bewerben. ` +
            `Hilft: npm run anmelden ${portalId}`
          : `Fuer "${portalId}" ist noch kein Bewerbungs-Adapter gebaut.`;
        console.log(`    NOCH MANUELL - ${grund}`);
        if (!env.dryRun) {
          await db.from("applications").update({ status: "needs_manual", error: grund }).eq("job_id", k.jobId);
          await telegramMelden(job, grund);
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
    `${erledigt} abgeschickt, ${manuellNoetig} brauchen Niki, ${abgelaufen} abgelaufen.\n` +
    (env.dryRun ? "Trockenlauf - nichts wurde in der Datenbank geaendert.\n" : ""),
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

/** Telegram-Meldung mit Direktlink, damit Niki selbst weitermachen kann. */
async function telegramMelden(job: Anzeige, grund: string): Promise<void> {
  if (!telegramEingerichtet()) return;
  try {
    await sendeNachricht(
      `⚠ Portal-Bewerbung braucht dich\n${job.title}\n${job.company ?? "?"}\n\n${grund}\n\n${job.url}`,
    );
  } catch (e) {
    console.log(`    Telegram-Meldung fehlgeschlagen: ${(e as Error).message.slice(0, 150)}`);
  }
}
