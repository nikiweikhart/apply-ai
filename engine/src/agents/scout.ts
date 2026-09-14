/**
 * scout - sucht selbststaendig auf den Jobportalen.
 *
 * Der Scout kennt kein einziges Portal von innen. Er holt die Portalliste aus
 * der Datenbank, sucht sich zu jedem den passenden Adapter, laesst ihn laufen
 * und kuemmert sich um alles Drumherum: Doppelte aussortieren, speichern,
 * protokollieren, und bei einer Sperre das Portal stilllegen statt weiter
 * dagegenzurennen.
 *
 * Findet ein Adapter nichts mehr, weil das Portal umgebaut hat, ist trotzdem
 * nicht Schluss: dann uebernimmt der Explorer (`agents/explorer.ts`) und liest
 * die Seite mit Claudes Hilfe. Der Scout schreibt danach auf, woran der
 * Explorer sich festgehalten hat - das ist die Vorlage fuer die Reparatur.
 *
 * Starten mit:
 *   npm run scout                  alle freigeschalteten Portale
 *   npm run scout hokify           nur dieses Portal
 *   npm run scout hokify 5         nur hokify, hoechstens 5 neue Anzeigen
 *   npm run scout hokify frisch    auch Bekanntes neu lesen und aktualisieren
 *   npm run scout hokify kaputt    Adapter absichtlich uebergehen, Explorer testen
 *
 * Absichtlich ohne --striche: npm frisst Angaben wie "--max 5" selbst auf,
 * statt sie durchzureichen. Deshalb einfach hintereinander schreiben.
 *
 * Zuschauen: HEADFUL=1 in die .env schreiben, dann geht ein Fenster auf.
 */
import { createHash } from "node:crypto";
import type { Page } from "playwright";
import { db } from "../lib/supabase.ts";
import { log } from "../lib/log.ts";
import { env } from "../lib/env.ts";
import {
  AdapterFehler,
  BlockadeFehler,
  browserStarten,
  screenshot,
  warte,
} from "../lib/browser.ts";
import type { Adapter, AdapterKontext, Portal, RohJob } from "../adapters/typen.ts";
import { erkundungslauf, type Selektoren } from "./explorer.ts";
import { hokify } from "../adapters/hokify.ts";
import { willhaben } from "../adapters/willhaben.ts";
import { studentjob } from "../adapters/studentjob.ts";
import { karriere } from "../adapters/karriere.ts";
import { indeed } from "../adapters/indeed.ts";

/** Alle gebauten Adapter. Wer hier nicht steht, wird uebersprungen. */
/**
 * Alle zugeschalteten Adapter. Wer hier nicht steht, wird uebersprungen -
 * auch wenn die Datei existiert. AMS ist bewusst draussen (Nikis Entscheidung
 * am 2026-08-25); `adapters/ams.ts` liegt fertig da und braucht nur eine
 * Zeile hier, falls es doch dazukommen soll.
 */
const ADAPTER: Record<string, Adapter> = {
  hokify,
  willhaben,
  studentjob,
  karriere,
  indeed,
};

// ------------------------------------------------------------- Aufrufparameter
// Erstes Wort ohne Striche = Portalname, erste Zahl = Obergrenze.
const argv = process.argv.slice(2).filter((a) => !a.startsWith("-"));
/**
 * "frisch" liest auch Anzeigen neu ein, die schon in der Datenbank stehen,
 * und bringt sie auf Stand. Ohne das überspringt der Scout alles Bekannte.
 * Nützlich, wenn ein Adapter verbessert wurde und alte Zeilen schiefe Werte
 * enthalten - oder wenn eine Anzeige zwischenzeitlich geändert wurde.
 */
const FRISCH = argv.includes("frisch");
/**
 * "kaputt" uebergeht den Adapter und laesst gleich den Explorer ran - als
 * haette das Portal ueber Nacht alles umgebaut. Der einzige ehrliche Weg, den
 * Notbetrieb zu pruefen, ohne auf einen echten Umbau zu warten.
 */
const KAPUTT = argv.includes("kaputt");
const NUR_PORTAL =
  argv.find((a) => !/^\d+$/.test(a) && a !== "frisch" && a !== "kaputt") ??
  process.env.SCOUT_PORTAL;
const MAX_NEUE = Number(argv.find((a) => /^\d+$/.test(a)) ?? process.env.SCOUT_MAX ?? 15);

/**
 * Fingerabdruck aus Firma + Titel + Ort. Damit landet dieselbe Stelle, wenn
 * sie auf zwei Portalen steht, nur einmal in der Datenbank.
 */
function fingerabdruck(job: RohJob): string {
  const normal = (s?: string) =>
    (s ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/\((?:m|w|d|x)(?:\/(?:m|w|d|x))+\)/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const roh = [normal(job.company), normal(job.title), normal(job.location)].join("|");
  return createHash("sha256").update(roh).digest("hex").slice(0, 32);
}

// ------------------------------------------------------------- Portale holen
const { data: portalDaten, error: portalFehler } = await db
  .from("portals")
  .select("id, display_name, search_url, filters, enabled, status");

if (portalFehler) {
  console.error(`X  [scout] Portale nicht ladbar: ${portalFehler.message}`);
  process.exit(1);
}

const portale = (portalDaten ?? [])
  .filter((p) => p.enabled)
  .filter((p) => (NUR_PORTAL ? p.id === NUR_PORTAL : true))
  .filter((p) => {
    if (ADAPTER[p.id]) return true;
    console.log(`   [scout] ${p.display_name}: Adapter noch nicht gebaut - uebersprungen.`);
    return false;
  })
  // Ein Portal, das uns ausgesperrt hat, wird nicht bei jedem Lauf neu
  // angerempelt - das waere unhoeflich und brauchte nur Zeit. Es bleibt
  // draussen, bis jemand es in der Datenbank wieder auf "ok" setzt. Wer es
  // beim Aufruf ausdruecklich nennt ("npm run scout indeed"), will es
  // erneut versuchen und bekommt es auch.
  .filter((p) => {
    if (p.status !== "blocked" || NUR_PORTAL === p.id) return true;
    console.log(
      `   [scout] ${p.display_name}: gesperrt seit dem letzten Lauf - uebersprungen.
` +
        `           Zum erneuten Versuch: npm run scout ${p.id}`,
    );
    return false;
  })
  .sort(
    (a, b) =>
      ((a.filters as Portal["filters"]).prio ?? 99) - ((b.filters as Portal["filters"]).prio ?? 99),
  ) as unknown as Portal[];

// Markierter Block statt fruehem process.exit(0): Node stuerzt unter Windows
// gelegentlich ab, wenn der Prozess erzwungen beendet wird, waehrend eine
// offene Datenbankverbindung noch am Schliessen ist. `break lauf` ueberspringt
// den kompletten Suchlauf (inklusive Browser-Start - der soll bei nichts zu
// tun erst gar nicht aufgehen) und laesst Node danach sauber von selbst enden.
lauf: {
if (portale.length === 0) {
  console.log("   [scout] Nichts zu tun - kein freigeschaltetes Portal mit fertigem Adapter.");
  break lauf;
}

console.log(
  `\nApply AI - Scout\n${"=".repeat(50)}\n` +
    `Portale: ${portale.map((p) => p.display_name).join(", ")}\n` +
    `Browser: ${env.headful ? "sichtbar (HEADFUL=1)" : "unsichtbar"}   ` +
    `hoechstens ${MAX_NEUE} Anzeigen pro Portal\n` +
    (FRISCH ? "Auffrischen: auch Bekanntes wird neu gelesen und aktualisiert\n" : "") +
    (KAPUTT
      ? "TESTLAUF: die Adapter werden uebergangen, es laeuft nur der Explorer.\n" +
        "Das kostet ein paar Cent - anders ist der Notbetrieb nicht zu pruefen.\n"
      : ""),
);

const start = Date.now();
const { page, schliessen } = await browserStarten();
let gesamtNeu = 0;

try {
  for (const portal of portale) {
    const adapter = ADAPTER[portal.id];
    if (!adapter) continue;

    await db.from("portals").update({ last_run_at: new Date().toISOString() }).eq("id", portal.id);
    await log("scout", "info", `${portal.display_name}: Suche startet`);

    // Bekannte Anzeigen dieses Portals vorab laden - dann muss der Adapter
    // nur die neuen Detailseiten oeffnen. Spart Zeit und schont das Portal.
    const { data: bekannt } = await db
      .from("jobs")
      .select("external_id")
      .eq("portal_id", portal.id)
      .not("external_id", "is", null);
    const bekannteIds = new Set((bekannt ?? []).map((b) => b.external_id as string));

    const ctx: AdapterKontext = {
      page,
      portal,
      istNeu: (id) => FRISCH || !bekannteIds.has(id),
      maxNeueJobs: MAX_NEUE,
      melde: async (text) => {
        console.log(`   [${portal.id}] ${text}`);
      },
    };

    try {
      let jobs: RohJob[];
      let notbetrieb: { selektoren?: Selektoren; url?: string; kostenUsd: number } | undefined;

      try {
        if (KAPUTT) {
          throw new AdapterFehler(
            portal.id,
            "Testlauf: der Adapter wird absichtlich uebergangen (kaputt).",
          );
        }
        jobs = await adapter.suchen(ctx);
      } catch (adapterFehler) {
        // Eine Sperre ist kein Fall fuer den Explorer: das Portal will uns
        // nicht, und daran aendert ein zweiter Anlauf nichts. Alles andere -
        // umgebaute Seite, verschwundene Kennzeichnung - ist genau sein Fall.
        if (adapterFehler instanceof BlockadeFehler) throw adapterFehler;

        const ergebnis = await explorerUebernimmt(ctx, adapter, adapterFehler as Error);
        jobs = ergebnis.jobs;
        notbetrieb = ergebnis;
        if (jobs.length === 0) throw adapterFehler;
      }

      const neu = await jobsSpeichern(portal, jobs, bekannteIds);
      gesamtNeu += neu;

      if (notbetrieb) {
        await notbetriebVermerken(portal, notbetrieb, jobs.length, neu);
      } else {
        await db
          .from("portals")
          .update({ status: "ok", status_note: null, last_ok_at: new Date().toISOString() })
          .eq("id", portal.id);

        await log(
          "scout",
          "info",
          `${portal.display_name}: ${jobs.length} Anzeigen gelesen, ${neu} neu gespeichert`,
          { data: { portal: portal.id, gelesen: jobs.length, neu } },
        );
      }
    } catch (e) {
      await portalFehlerVermerken(page, portal, e as Error);
    }

    await warte(2000, 4000);
  }
} finally {
  await schliessen();
}

const minuten = (Date.now() - start) / 60_000;
await log("scout", "info", `Lauf beendet: ${gesamtNeu} neue Anzeigen`, { runMinutes: minuten });
console.log(
  `\n${"=".repeat(50)}\n${gesamtNeu} neue Anzeigen in ${minuten.toFixed(1)} Minuten.\n` +
    `Nachschauen: Supabase -> Table Editor -> jobs\n`,
);
} // Ende "lauf:"

// ------------------------------------------------------------- Hilfsfunktionen

/** Speichert die Anzeigen und meldet zurueck, wie viele davon wirklich neu waren. */
async function jobsSpeichern(
  portal: Portal,
  jobs: RohJob[],
  bekannteIds: Set<string>,
): Promise<number> {
  if (jobs.length === 0) return 0;

  // Innerhalb eines Laufs kann derselbe Fingerabdruck zweimal vorkommen -
  // die Datenbank wuerde dann die ganze Ladung ablehnen. Also vorher ausduennen.
  const proFingerabdruck = new Map<string, RohJob & { fingerprint: string }>();
  for (const job of jobs) {
    const fp = fingerabdruck(job);
    if (!proFingerabdruck.has(fp)) proFingerabdruck.set(fp, { ...job, fingerprint: fp });
  }

  const zeilen = [...proFingerabdruck.values()].map((job) => ({
    portal_id: portal.id,
    external_id: job.externalId ?? null,
    url: job.url,
    fingerprint: job.fingerprint,
    title: job.title,
    company: job.company ?? null,
    location: job.location ?? null,
    employment: job.employment ?? null,
    description: job.description ?? null,
    contact_email: job.contactEmail ?? null,
    posted_at: job.postedAt ?? null,
  }));

  // Beim Auffrischen zuerst die bekannten Zeilen aktualisieren. Der Weg ueber
  // upsert ginge hier schief: Schluessel ist der Fingerabdruck, und der aendert
  // sich mit, wenn sich der Ort korrigiert - es entstuende eine Zweitzeile
  // statt einer Korrektur. Deshalb gezielt ueber Portal + Portal-ID.
  let aufgefrischt = 0;
  const einzufuegen: typeof zeilen = [];
  for (const zeile of zeilen) {
    const bekannt = zeile.external_id !== null && bekannteIds.has(zeile.external_id);
    if (!bekannt) {
      einzufuegen.push(zeile);
      continue;
    }
    if (!FRISCH) continue; // bekannt und kein Auffrischen -> nichts tun
    const { error: updFehler } = await db
      .from("jobs")
      .update(zeile)
      .eq("portal_id", portal.id)
      .eq("external_id", zeile.external_id);
    if (!updFehler) aufgefrischt++;
  }
  if (aufgefrischt > 0) {
    await log("scout", "info", `${portal.display_name}: ${aufgefrischt} Anzeigen aufgefrischt`);
  }
  if (einzufuegen.length === 0) return 0;

  // ignoreDuplicates: was schon da ist, bleibt unangetastet. Zurueck kommen
  // nur die Zeilen, die wirklich eingefuegt wurden.
  const { data, error } = await db
    .from("jobs")
    .upsert(einzufuegen, { onConflict: "fingerprint", ignoreDuplicates: true })
    .select("id");

  if (error) {
    await log("scout", "error", `${portal.display_name}: Speichern fehlgeschlagen`, {
      data: { fehler: error.message },
    });
    return 0;
  }
  return data?.length ?? 0;
}

/**
 * Der Adapter hat aufgegeben - jetzt versucht es der Explorer.
 *
 * Er bekommt die Suchadressen des Adapters mit: die aendern sich bei einem
 * Umbau fast nie, nur die Anhaltspunkte auf der Seite tun das. Hat ein
 * Adapter keine hinterlegt, bleibt die Startadresse aus der Datenbank -
 * besser als nichts, aber oft nur eine Werbeseite ohne Trefferliste.
 *
 * Kommt auch der Explorer zu nichts, gibt er eine leere Liste zurueck. Dann
 * gilt wieder der urspruengliche Fehler, und das Portal wird als kaputt
 * vermerkt - so, wie es ohne Explorer auch gewesen waere.
 */
async function explorerUebernimmt(
  ctx: AdapterKontext,
  adapter: Adapter,
  fehler: Error,
): Promise<{ jobs: RohJob[]; selektoren?: Selektoren; url?: string; kostenUsd: number }> {
  const adressen = adapter.suchadressen?.(ctx.portal) ?? [ctx.portal.search_url];

  console.log(
    `\n!  ${ctx.portal.display_name}: der Adapter kommt nicht mehr durch.\n` +
      `   ${fehler.message}\n` +
      `   Der Explorer uebernimmt und liest die Seite mit Claudes Hilfe.\n`,
  );
  await log("scout", "warn", `${ctx.portal.display_name}: Adapter kaputt, Explorer uebernimmt`, {
    data: { portal: ctx.portal.id, fehler: fehler.message, adressen },
  });

  try {
    return await erkundungslauf(ctx, adressen);
  } catch (e) {
    // Eine Sperre gehoert nach oben durchgereicht, nicht verschluckt.
    if (e instanceof BlockadeFehler) throw e;
    await ctx.melde(`Explorer erfolglos: ${(e as Error).message}`);
    return { jobs: [], kostenUsd: 0 };
  }
}

/**
 * Schreibt auf, dass gerade der Notbetrieb laeuft - und woran der Explorer
 * sich festgehalten hat.
 *
 * Das Portal bleibt auf `adapter_broken`, obwohl Anzeigen ankamen. Das ist
 * Absicht: Der Notbetrieb kostet Geld und Zeit, er soll nicht unbemerkt zum
 * Dauerzustand werden.
 */
async function notbetriebVermerken(
  portal: Portal,
  notbetrieb: { selektoren?: Selektoren; url?: string; kostenUsd: number },
  gelesen: number,
  neu: number,
): Promise<void> {
  const s = notbetrieb.selektoren;
  const vorschlag = s
    ? `kachel="${s.kachel}" titel_link="${s.titel_link}" firma="${s.firma}" id="${s.id_muster}"`
    : "kein Vorschlag";

  await db
    .from("portals")
    .update({
      status: "adapter_broken",
      status_note:
        `Explorer hat uebernommen: ${gelesen} Anzeigen. ${vorschlag}`.slice(0, 500),
      last_ok_at: new Date().toISOString(),
    })
    .eq("id", portal.id);

  await log(
    "scout",
    "warn",
    `${portal.display_name}: ${gelesen} Anzeigen im Notbetrieb gelesen, ${neu} neu gespeichert`,
    {
      costUsd: notbetrieb.kostenUsd,
      data: { portal: portal.id, gelesen, neu, url: notbetrieb.url, selektoren: s ?? null },
    },
  );

  console.log(
    `\n   So repariert man den Adapter ${portal.id} dauerhaft:\n` +
      `   Seite:        ${notbetrieb.url ?? "-"}\n` +
      `   Kachel:       ${s?.kachel ?? "-"}\n` +
      `   Titellink:    ${s?.titel_link ?? "-"}\n` +
      `   Firma:        ${s?.firma || "(keine gefunden)"}\n` +
      `   Nummer:       ${s?.id_muster || "(keine gefunden)"}\n` +
      `   Begruendung:  ${s?.begruendung ?? "-"}\n` +
      `   Kosten dieses Notbetriebs: ${(notbetrieb.kostenUsd * 100).toFixed(2)} US-Cent.\n` +
      `   Das Portal bleibt auf "adapter_broken", bis der Adapter nachgezogen ist.\n`,
  );
}

/** Traegt ein, warum ein Portal ausgefallen ist - spaeter sichtbar in der Oberflaeche. */
async function portalFehlerVermerken(seite: Page, portal: Portal, e: Error): Promise<void> {
  const gesperrt = e instanceof BlockadeFehler;
  const art = gesperrt
    ? "Portal sperrt"
    : e instanceof AdapterFehler
      ? "Seite umgebaut"
      : "unerwarteter Fehler";
  const bild = await screenshot(seite, `${portal.id}-fehler`);

  await db
    .from("portals")
    .update({
      status: gesperrt ? "blocked" : "adapter_broken",
      status_note: `${art}: ${e.message}`.slice(0, 500),
    })
    .eq("id", portal.id);

  await log("scout", gesperrt ? "warn" : "error", `${portal.display_name}: ${art} - ${e.message}`, {
    data: { portal: portal.id, art, screenshot: bild ?? null },
  });

  if (gesperrt) {
    console.log(
      `\n!  ${portal.display_name} macht dicht. Apply AI versucht nicht, das zu umgehen -\n` +
        `   das Portal steht jetzt auf "blocked" und wird uebersprungen, bis du es\n` +
        `   in der Datenbank wieder auf "ok" setzt.\n`,
    );
  }
}
