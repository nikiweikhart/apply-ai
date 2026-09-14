/**
 * willhaben Jobs - Portal Nummer zwei.
 *
 * Angenehmer zu lesen als hokify: willhaben kennzeichnet fast jedes Feld mit
 * einem `data-testid`, und diese Kennungen sind für Testzwecke gedacht, also
 * stabiler als Gestaltungs-Klassen.
 *
 * Ablauf:
 *   1. Cookie-Banner ablehnen (willhaben nutzt Didomi, 460 Partner - der
 *      Knopf heißt "Ablehnen und Schließen")
 *   2. Suchseite je Anstellungsart aufrufen
 *   3. Nach unten scrollen, damit die Liste nachlädt
 *   4. Anzeigenlinks einsammeln, die neuen einzeln öffnen
 *
 * Geprüfte Anhaltspunkte (Stand 2026-08-25):
 *   Anzeigenlink     a[href^="/jobs/job/<name>/<nummer>"]
 *   Ablehnen-Knopf   #didomi-notice-disagree-button
 *   Detailseite:
 *     Titel          h1
 *     Firma          a[href^="/jobs/firma/"]
 *     Anstellung     [data-testid="jobaddetail-jobdetails-employment-mode"]
 *     Ort            [data-testid="jobaddetail-jobdetails-employment-locations"]
 *     Online seit    [data-testid="jobaddetail-adinfobar-online-since"]
 *
 * Die Zahlen für die Anstellungsart hat der Browser selbst herausgefunden,
 * indem er die Filterknöpfe gedrückt und die Adresszeile abgelesen hat.
 */
import type { Page } from "playwright";
import type { Adapter, AdapterKontext, RohJob } from "./typen.ts";
import { AdapterFehler, blockadePruefen, cookiesAblehnen, seiteOeffnen, warte } from "../lib/browser.ts";
import { mailAusSeite, nachladenDurchScrollen, relativeZeit, textAufraeumen } from "./hilfen.ts";

const BASIS = "https://www.willhaben.at";

/** willhabens interne Nummern für die Anstellungsart. */
const ANSTELLUNG_NUMMER: Record<string, string> = {
  geringfuegig: "11796",
  geringfügig: "11796",
  teilzeit: "113",
};

/** Bundesland-Nummern. Ohne die zeigt willhaben ganz Österreich. */
const REGION_NUMMER: Record<string, string> = {
  wien: "14486",
};

type Kachel = { externalId: string; url: string; title: string; company?: string };

/** Die Suchadresse fuer eine Anstellungsart und eine Seite der Trefferliste. */
function sucheUrl(anstellung: string, ort: string, seite: number): string {
  const nummer = ANSTELLUNG_NUMMER[anstellung.toLowerCase()];
  const region = REGION_NUMMER[ort.toLowerCase()];
  const teile = [
    nummer ? `employment_type=${nummer}` : "",
    `location=${encodeURIComponent(ort)}`,
    region ? `region=${region}` : "",
    seite > 1 ? `page=${seite}` : "",
  ].filter(Boolean);
  return `${BASIS}/jobs/suche?${teile.join("&")}`;
}

export const willhaben: Adapter = {
  id: "willhaben",

  suchadressen(portal) {
    const ort = portal.filters.ort ?? "Wien";
    const arten = portal.filters.anstellung ?? ["geringfuegig", "Teilzeit"];
    return arten.map((art) => sucheUrl(art, ort, 1));
  },

  async suchen(ctx: AdapterKontext): Promise<RohJob[]> {
    const ort = ctx.portal.filters.ort ?? "Wien";
    const arten = ctx.portal.filters.anstellung ?? ["geringfuegig", "Teilzeit"];

    const gesammelt = new Map<string, Kachel>();
    for (const art of arten) {
      for (const k of await trefferlisteLesen(ctx, art, ort)) {
        if (!gesammelt.has(k.externalId)) gesammelt.set(k.externalId, k);
      }
      await warte();
    }

    const alle = [...gesammelt.values()];
    const neue = alle.filter((k) => ctx.istNeu(k.externalId)).slice(0, ctx.maxNeueJobs);
    await ctx.melde(
      `${alle.length} Treffer insgesamt, davon ${neue.length} neu - die werden jetzt aufgemacht.`,
    );

    const jobs: RohJob[] = [];
    for (const [i, kachel] of neue.entries()) {
      try {
        jobs.push(await detailLesen(ctx.page, kachel));
        await ctx.melde(`  ${i + 1}/${neue.length}  ${kachel.title.slice(0, 60)}`);
      } catch (e) {
        await ctx.melde(`  ${i + 1}/${neue.length}  uebersprungen: ${(e as Error).message}`);
      }
      await warte();
    }
    return jobs;
  },
};

async function trefferlisteLesen(
  ctx: AdapterKontext,
  anstellung: string,
  ort: string,
): Promise<Kachel[]> {
  const { page } = ctx;

  const links = 'a[href^="/jobs/job/"]';
  const ergebnis = new Map<string, Kachel>();

  // willhaben blaettert in Seiten, statt beim Scrollen nachzuladen: eine Seite
  // zeigt rund zehn Anzeigen. Also so lange weiterblaettern, bis genug
  // beisammen ist oder nichts Neues mehr kommt.
  for (let seite = 1; seite <= 6; seite++) {
    const url = sucheUrl(anstellung, ort, seite);

    await seiteOeffnen(page, url, "willhaben");
    if (seite === 1) await cookiesAblehnen(page);

    try {
      await page.locator(links).first().waitFor({ state: "attached", timeout: 15_000 });
    } catch {
      if (seite === 1) {
        throw new AdapterFehler(
          "willhaben",
          `Keine Anzeigenlinks auf ${url} - die Seite wurde vermutlich umgebaut.`,
        );
      }
      break; // spaetere Seite leer = Ende der Liste
    }

    if (seite === 1) {
      const ueberschrift = await page.locator("h1").first().innerText().catch(() => "");
      await ctx.melde(
        `Suche "${anstellung}" in ${ort}: ${ueberschrift.trim() || "Trefferliste offen"}`,
      );
      await blockadePruefen(page, "willhaben");
    }

    // Ein Teil der Kacheln erscheint erst beim Scrollen.
    await nachladenDurchScrollen(page, links, 30, 4);

    const roh = await page.locator(links).evaluateAll((knoten) =>
      knoten.map((a) => ({
        href: a.getAttribute("href") ?? "",
        text: (a.textContent ?? "").trim(),
      })),
    );

    // Der Firmenname steht in der Trefferliste sauber gekennzeichnet:
    // data-testid="jobsresultlist-row-3-adId-13259791-company-name".
    // Auf der Detailseite ist er schwerer zu fassen - dort heisst der
    // Firmenlink oft nur "Zum Firmenprofil".
    const firmen = await page
      .locator('[data-testid*="-company-name"]')
      .evaluateAll((knoten) =>
        knoten.map((el) => ({
          testid: el.getAttribute("data-testid") ?? "",
          text: (el.textContent ?? "").trim(),
        })),
      );
    const firmaZuId = new Map<string, string>();
    for (const f of firmen) {
      const id = f.testid.match(/adId-(\d+)/)?.[1];
      if (id && f.text) firmaZuId.set(id, f.text);
    }

    const vorher = ergebnis.size;
    for (const r of roh) {
      const id = r.href.match(/\/jobs\/job\/[^/]+\/(\d+)/)?.[1];
      if (!id) continue;
      // Denselben Link gibt es pro Kachel mehrfach (Bild, Titel). Der laengste
      // Text ist die Ueberschrift - der Rest ist "mehr anzeigen" und Aehnliches.
      const vorhanden = ergebnis.get(id);
      if (!vorhanden || r.text.length > vorhanden.title.length) {
        ergebnis.set(id, {
          externalId: id,
          url: `${BASIS}${r.href}`,
          title: r.text,
          company: firmaZuId.get(id) ?? vorhanden?.company,
        });
      }
    }

    if (ergebnis.size === vorher) break; // nichts Neues auf dieser Seite
    if (ergebnis.size >= ctx.maxNeueJobs * 2) break;
    await warte(1200, 2200);
  }

  return [...ergebnis.values()];
}

async function detailLesen(page: Page, kachel: Kachel): Promise<RohJob> {
  await seiteOeffnen(page, kachel.url, "willhaben");

  const feld = async (testid: string) =>
    (
      await page
        .locator(`[data-testid="${testid}"]`)
        .first()
        .innerText()
        .catch(() => "")
    )
      .replace(/\s+/g, " ")
      .trim() || undefined;

  const titel =
    (await page.locator("h1").first().innerText().catch(() => "")).trim() || kachel.title;

  // Auf der Detailseite heissen die Firmenlinks oft nur "Zum Firmenprofil"
  // oder "Alle Jobs" - solche Fuellwoerter aussortieren und sonst den Namen
  // nehmen, den die Trefferliste schon geliefert hat.
  const firmenLinks = await page
    .locator('a[href^="/jobs/firma/"]')
    .allInnerTexts()
    .catch(() => [] as string[]);
  const FUELLWORT = /^(zum firmenprofil|alle jobs|firmenprofil|mehr erfahren)/i;
  const firma =
    firmenLinks.map((f) => f.trim()).find((f) => f && !FUELLWORT.test(f)) ?? kachel.company ?? "";

  const text = (await page.locator("body").first().innerText().catch(() => "")).trim();
  if (!text) throw new AdapterFehler("willhaben", `Anzeige ${kachel.url} hat keinen lesbaren Text.`);

  const onlineSeit = (await feld("jobaddetail-adinfobar-online-since")) ?? "";

  return {
    externalId: kachel.externalId,
    url: kachel.url,
    title: titel,
    company: firma || undefined,
    location: await feld("jobaddetail-jobdetails-employment-locations"),
    employment: await feld("jobaddetail-jobdetails-employment-mode"),
    description: textAufraeumen(text, titel),
    contactEmail: await mailAusSeite(page, "body"),
    postedAt: relativeZeit(onlineSeit),
  };
}
