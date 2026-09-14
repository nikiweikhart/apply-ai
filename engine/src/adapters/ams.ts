/**
 * AMS "alle jobs" - Portal Nummer drei.
 *
 * Das staatliche Portal. Rechtlich am unbedenklichsten zu durchsuchen, kein
 * Konto nötig, und die Detailseiten sind die saubersten von allen: jedes Feld
 * steht als beschriftetes Wertepaar da (Unternehmen, Arbeitsort, Arbeitszeit).
 *
 * Zwei Eigenheiten, die Zeit gekostet haben:
 *
 *   1. Die Adresse aus dem Bauplan (`/public/emps/jobs`) liefert eine
 *      **Fehlerseite**. AMS verlangt zwingend die fünf `JOB_OFFER_TYPE`-
 *      Angaben mit - das sind die Quellen (AMS, WKO, Bundesagentur, ...).
 *      Ohne sie bricht die Suche ab.
 *   2. AMS kennt nur Vollzeit und Teilzeit, kein "geringfügig". Teilzeit in
 *      Wien allein sind über 4.400 Stellen - viel zu viel. Deshalb sucht der
 *      Adapter mit Stichworten ("Samstag", "Aushilfe", "Studenten"), die in
 *      der Portal-Einstellung stehen und dort änderbar sind.
 *
 * Geprüfte Anhaltspunkte (Stand 2026-08-25):
 *   Suchadresse    /public/emps/jobs?location=<ort>&WORKING_TIME=T&query=<wort>
 *                  + fünfmal JOB_OFFER_TYPE
 *   Anzeigenlink   a[href^="/public/emps/jobs/<uuid>"]
 *   Cookie-Banner  Knopf "Nicht Einverstanden"
 *   Detailseite    [data-testid="key-value-pair-label"] / "-content" im Wechsel
 *   Überschrift    h1, Form: "Titel\nbei Firma"
 */
import type { Page } from "playwright";
import type { Adapter, AdapterKontext, RohJob } from "./typen.ts";
import { AdapterFehler, blockadePruefen, cookiesAblehnen, seiteOeffnen, warte } from "../lib/browser.ts";
import { mailAusSeite, textAufraeumen } from "./hilfen.ts";

const BASIS = "https://jobs.ams.at";

/** Die Quellen, aus denen "alle jobs" speist. Ohne sie: Fehlerseite. */
const QUELLEN = ["SB_WKO", "IJ", "BA", "BZ", "TN"];

/** Stichworte, falls in der Portal-Einstellung keine stehen. */
const STANDARD_STICHWORTE = ["Samstag", "Aushilfe", "Studenten"];

type Kachel = { externalId: string; url: string; title: string };

export const ams: Adapter = {
  id: "ams",

  async suchen(ctx: AdapterKontext): Promise<RohJob[]> {
    const ort = ctx.portal.filters.ort ?? "Wien";
    const stichworte =
      (ctx.portal.filters as { stichworte?: string[] }).stichworte ?? STANDARD_STICHWORTE;

    const gesammelt = new Map<string, Kachel>();
    for (const wort of stichworte) {
      for (const k of await trefferlisteLesen(ctx, wort, ort)) {
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

function sucheUrl(ort: string, stichwort: string, seite: number): string {
  const teile = [
    "sortField=_SCORE",
    "sortOrder=desc",
    `location=${encodeURIComponent(ort)}`,
    `query=${encodeURIComponent(stichwort)}`,
    "WORKING_TIME=T", // Teilzeit; "geringfuegig" kennt das AMS nicht
    ...QUELLEN.map((q) => `JOB_OFFER_TYPE=${q}`),
    seite > 1 ? `page=${seite}` : "",
  ].filter(Boolean);
  return `${BASIS}/public/emps/jobs?${teile.join("&")}`;
}

async function trefferlisteLesen(
  ctx: AdapterKontext,
  stichwort: string,
  ort: string,
): Promise<Kachel[]> {
  const { page } = ctx;
  const links = 'a[href^="/public/emps/jobs/"]';
  const ergebnis = new Map<string, Kachel>();

  for (let seite = 1; seite <= 4; seite++) {
    const url = sucheUrl(ort, stichwort, seite);
    await seiteOeffnen(page, url, "ams");
    if (seite === 1) await cookiesAblehnen(page);

    const ueberschrift = (await page.locator("h1").first().innerText().catch(() => "")).trim();
    if (/fehler/i.test(ueberschrift)) {
      throw new AdapterFehler(
        "ams",
        `AMS liefert eine Fehlerseite für ${url} - vermutlich fehlen Suchangaben.`,
      );
    }
    if (seite === 1) {
      await ctx.melde(`Suche "${stichwort}" in ${ort}: ${ueberschrift || "Trefferliste offen"}`);
      await blockadePruefen(page, "ams");
    }

    const treffer = await page.locator(links).evaluateAll((knoten) =>
      knoten.map((a) => ({
        href: a.getAttribute("href") ?? "",
        text: (a.textContent ?? "").trim(),
      })),
    );

    const vorher = ergebnis.size;
    for (const t of treffer) {
      // Die Kennung ist eine lange Zeichenfolge mit Bindestrichen, keine Zahl.
      const id = t.href.match(/\/public\/emps\/jobs\/([0-9a-f-]{20,})/i)?.[1];
      if (!id) continue;
      const vorhanden = ergebnis.get(id);
      if (!vorhanden || t.text.length > vorhanden.title.length) {
        ergebnis.set(id, { externalId: id, url: `${BASIS}${t.href}`, title: t.text });
      }
    }

    if (ergebnis.size === vorher) break;
    if (ergebnis.size >= ctx.maxNeueJobs * 2) break;
    await warte(1200, 2200);
  }

  return [...ergebnis.values()];
}

async function detailLesen(page: Page, kachel: Kachel): Promise<RohJob> {
  await seiteOeffnen(page, kachel.url, "ams");

  // Die Überschrift hat die Form "Titel\nbei Firma".
  const ueberschrift = (await page.locator("h1").first().innerText().catch(() => "")).trim();
  const [titelZeile, ...restZeilen] = ueberschrift.split("\n");
  const titel = (titelZeile ?? "").trim() || kachel.title;
  const firmaAusTitel = restZeilen.join(" ").replace(/^bei\s+/i, "").trim();

  // Beschriftung und Wert stehen als zwei getrennte Elemente im Wechsel.
  const beschriftungen = await page
    .locator('[data-testid="key-value-pair-label"]')
    .allInnerTexts()
    .catch(() => [] as string[]);
  const werte = await page
    .locator('[data-testid="key-value-pair-content"]')
    .allInnerTexts()
    .catch(() => [] as string[]);

  const felder = new Map<string, string>();
  for (let i = 0; i < beschriftungen.length; i++) {
    const name = (beschriftungen[i] ?? "").replace(/:$/, "").trim().toLowerCase();
    const wert = (werte[i] ?? "").replace(/\s+/g, " ").trim();
    if (name && wert) felder.set(name, wert);
  }

  const text = (await page.locator("body").first().innerText().catch(() => "")).trim();
  if (!text) throw new AdapterFehler("ams", `Anzeige ${kachel.url} hat keinen lesbaren Text.`);

  return {
    externalId: kachel.externalId,
    url: kachel.url,
    title: titel,
    company: felder.get("unternehmen") ?? (firmaAusTitel || undefined),
    location: felder.get("arbeitsort"),
    employment: felder.get("arbeitszeit"),
    description: textAufraeumen(text, "Details"),
    contactEmail: await mailAusSeite(page, "body"),
    postedAt: datumAusFeld(felder.get("inseriert/aktualisiert")),
  };
}

/** AMS schreibt echte Daten hin, im Format 27.08.2026. */
function datumAusFeld(wert?: string): string | undefined {
  const m = wert?.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return undefined;
  const datum = new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`);
  return Number.isNaN(datum.getTime()) ? undefined : datum.toISOString();
}
