/**
 * karriere.at - Portal Nummer vier.
 *
 * Dort inserieren die grossen Ketten. Bot-Risiko laut Bauplan "mittel", beim
 * Bau am 2026-08-25 aber keinerlei Sperre und nicht einmal ein Cookie-Banner.
 *
 * Dieselbe Bauart wie hokify: fertige Suchseiten unter
 * `karriere.at/jobs/<suchwort>/<ort>`. Gemessen fuer Wien:
 *   geringfuegig 13 Stellen, samstagsjob 2, teilzeit 487.
 *
 * Geprüfte Anhaltspunkte (Stand 2026-08-25):
 *   Suchseite      karriere.at/jobs/<suchwort>/<ort>, Blaettern ueber ?page=2
 *   Anzeigenlink   karriere.at/jobs/<nummer>
 *   Detailseite    keine data-testid - die Felder stehen als beschriftete
 *                  Textbloecke ("Anstellungsart" ueber dem Wert), deshalb
 *                  `feldAusText` aus hilfen.ts
 */
import type { Page } from "playwright";
import type { Adapter, AdapterKontext, RohJob } from "./typen.ts";
import { AdapterFehler, blockadePruefen, cookiesAblehnen, seiteOeffnen, warte } from "../lib/browser.ts";
import { feldAusText, mailAusSeite, ortAusText, textAufraeumen } from "./hilfen.ts";

const BASIS = "https://www.karriere.at";

/** Suchworte, falls in der Portal-Einstellung keine stehen. */
const STANDARD_SUCHWORTE = ["geringfuegig", "samstagsjob", "teilzeit"];

type Kachel = { externalId: string; url: string; title: string };

/** Die Suchadresse - karriere.at baut sie wie hokify aus Wort und Ort. */
function sucheUrl(suchwort: string, ort: string, seite: number): string {
  return `${BASIS}/jobs/${encodeURIComponent(suchwort)}/${encodeURIComponent(ort)}${
    seite > 1 ? `?page=${seite}` : ""
  }`;
}

export const karriere: Adapter = {
  id: "karriere",

  suchadressen(portal) {
    const ort = (portal.filters.ort ?? "Wien").toLowerCase();
    const suchworte = (portal.filters as { suchworte?: string[] }).suchworte ?? STANDARD_SUCHWORTE;
    return suchworte.map((w) => sucheUrl(w, ort, 1));
  },

  async suchen(ctx: AdapterKontext): Promise<RohJob[]> {
    const ort = (ctx.portal.filters.ort ?? "Wien").toLowerCase();
    const suchworte =
      (ctx.portal.filters as { suchworte?: string[] }).suchworte ?? STANDARD_SUCHWORTE;

    const gesammelt = new Map<string, Kachel>();
    let suchenOk = 0;
    for (const wort of suchworte) {
      try {
        for (const k of await trefferlisteLesen(ctx, wort, ort)) {
          if (!gesammelt.has(k.externalId)) gesammelt.set(k.externalId, k);
        }
        suchenOk++;
      } catch (e) {
        await ctx.melde(`Suchwort "${wort}" uebersprungen: ${(e as Error).message}`);
      }
      await warte();
    }
    if (suchenOk === 0) {
      throw new AdapterFehler("karriere", `Keines der Suchworte hat funktioniert.`);
    }

    const alle = [...gesammelt.values()];
    const neue = alle.filter((k) => ctx.istNeu(k.externalId)).slice(0, ctx.maxNeueJobs);
    await ctx.melde(
      `${alle.length} Treffer insgesamt, davon ${neue.length} neu - die werden jetzt aufgemacht.`,
    );

    const jobs: RohJob[] = [];
    for (const [i, kachel] of neue.entries()) {
      try {
        jobs.push(await detailLesen(ctx.page, kachel, ort));
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
  suchwort: string,
  ort: string,
): Promise<Kachel[]> {
  const { page } = ctx;
  const ergebnis = new Map<string, Kachel>();

  for (let seite = 1; seite <= 4; seite++) {
    const url = sucheUrl(suchwort, ort, seite);
    await seiteOeffnen(page, url, "karriere");
    if (seite === 1) await cookiesAblehnen(page);
    await page.waitForTimeout(1500);

    const treffer = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]"))
        .map((a) => ({
          href: (a as HTMLAnchorElement).href,
          text: (a.textContent ?? "").trim(),
        }))
        .filter((x) => /karriere\.at\/jobs\/\d+/.test(x.href)),
    );

    if (seite === 1) {
      if (treffer.length === 0) {
        throw new AdapterFehler(
          "karriere",
          `Keine Anzeigenlinks auf ${url} - Suchwort ungueltig oder Seite umgebaut.`,
        );
      }
      const ueberschrift = (await page.locator("h1").first().innerText().catch(() => "")).trim();
      await ctx.melde(`Suche "${suchwort}" in ${ort}: ${ueberschrift || "Trefferliste offen"}`);
      await blockadePruefen(page, "karriere");
    }

    const vorher = ergebnis.size;
    for (const t of treffer) {
      const id = t.href.match(/\/jobs\/(\d+)/)?.[1];
      if (!id) continue;
      const vorhanden = ergebnis.get(id);
      if (!vorhanden || t.text.length > vorhanden.title.length) {
        ergebnis.set(id, { externalId: id, url: `${BASIS}/jobs/${id}`, title: t.text });
      }
    }

    if (ergebnis.size === vorher) break;
    if (ergebnis.size >= ctx.maxNeueJobs * 2) break;
    await warte(1200, 2200);
  }

  return [...ergebnis.values()];
}

async function detailLesen(page: Page, kachel: Kachel, ort: string): Promise<RohJob> {
  await seiteOeffnen(page, kachel.url, "karriere");

  const titel =
    (await page.locator("h1").first().innerText().catch(() => "")).trim() || kachel.title;

  const text = (await page.locator("body").first().innerText().catch(() => "")).trim();
  if (!text) throw new AdapterFehler("karriere", `Anzeige ${kachel.url} hat keinen lesbaren Text.`);

  // Der Firmenlink zeigt auf karriere.at/f/<name> - nicht auf "/firmen",
  // das ist nur der Menuepunkt und hat keinen Text.
  const firmenLinks = await page
    .locator('a[href*="karriere.at/f/"]')
    .allInnerTexts()
    .catch(() => [] as string[]);
  const firma = firmenLinks.map((f) => f.trim()).find(Boolean) ?? "";

  return {
    externalId: kachel.externalId,
    url: kachel.url,
    title: titel,
    company: firma || undefined,
    // "Dienstort" ist die Beschriftung, die karriere.at verwendet. Aeltere
    // Anzeigen haben das Feld nicht - dann bleibt die Suchstadt, die ohnehin
    // stimmt, weil danach gesucht wurde.
    location:
      feldAusText(text, "Dienstort") ??
      ortAusText(text, titel, firma) ??
      ort.charAt(0).toUpperCase() + ort.slice(1),
    employment: feldAusText(text, "Anstellungsart"),
    description: textAufraeumen(text, "Für Arbeitgeber"),
    contactEmail: await mailAusSeite(page, "body"),
    postedAt: undefined,
  };
}
