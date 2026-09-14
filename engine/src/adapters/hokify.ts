/**
 * hokify - der erste Portal-Adapter.
 *
 * Ablauf, so wie ein Mensch es machen wuerde:
 *   1. Suchseite oeffnen (hokify.at/jobs/m/<suchwort>/<ort>) - genau die
 *      Adresse, auf der man landet, wenn man das Suchfeld ausfuellt
 *   2. Nachladen, bis genug Treffer in der Liste stehen
 *   3. Aus jeder Trefferkachel Titel, Firma und die Job-Nummer lesen
 *   4. Nur die noch unbekannten Anzeigen einzeln aufmachen und den
 *      vollen Text mitnehmen
 *
 * Warum die Adresse statt des Suchfelds: hokify baut daraus dieselbe Seite,
 * aber ohne Autovervollstaendigung im Ortsfeld, an der man haengenbleiben kann.
 * Geklickt wird trotzdem genug - Nachladen und jede Anzeige einzeln.
 *
 * Gepruefte Anhaltspunkte auf der Seite (Stand 2026-08-25):
 *   Trefferkachel     div.post-link  bzw. [data-cy="jobList"]
 *   Titel + Adresse   h2 a[href^="/job/"]
 *   Firma             [data-cy="companyName"]
 *   Anstellungsart    [data-cy^="employmentType"]
 *   Nachladen         Knopf mit der Aufschrift "LADEN"
 */
import type { Page } from "playwright";
import type { Adapter, AdapterKontext, RohJob } from "./typen.ts";
import {
  AdapterFehler,
  blockadePruefen,
  cookiesAblehnen,
  seiteOeffnen,
  warte,
} from "../lib/browser.ts";
import { kopfbereich, mailAusSeite, ortAusText, textAufraeumen } from "./hilfen.ts";

const BASIS = "https://hokify.at";

/** Aus "geringfuegig" wird das Suchwort, das hokify erwartet. */
const SUCHWORT: Record<string, string> = {
  geringfuegig: "geringfügig",
  geringfügig: "geringfügig",
  teilzeit: "Teilzeit",
  vollzeit: "Vollzeit",
};

type Kachel = { externalId: string; url: string; title: string; company?: string };

/** Die Suchadresse - genau die, die das Suchfeld auf hokify erzeugt. */
function sucheUrl(suchwort: string, ort: string): string {
  return `${BASIS}/jobs/m/${encodeURIComponent(suchwort.toLowerCase())}/${encodeURIComponent(
    ort.toLowerCase(),
  )}`;
}

export const hokify: Adapter = {
  id: "hokify",

  suchadressen(portal) {
    const ort = portal.filters.ort ?? "Wien";
    const arten = portal.filters.anstellung ?? ["geringfuegig", "Teilzeit"];
    return arten.map((art) => sucheUrl(SUCHWORT[art.toLowerCase()] ?? art, ort));
  },

  async suchen(ctx: AdapterKontext): Promise<RohJob[]> {
    const ort = ctx.portal.filters.ort ?? "Wien";
    const arten = ctx.portal.filters.anstellung ?? ["geringfuegig", "Teilzeit"];

    // Erst alle Trefferlisten durchgehen und sammeln, dann erst Details holen.
    const gesammelt = new Map<string, Kachel>();

    for (const art of arten) {
      const wort = SUCHWORT[art.toLowerCase()] ?? art;
      const kacheln = await trefferlisteLesen(ctx, wort, ort);
      for (const k of kacheln) if (!gesammelt.has(k.externalId)) gesammelt.set(k.externalId, k);
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
        jobs.push(await detailLesen(ctx, kachel));
        await ctx.melde(`  ${i + 1}/${neue.length}  ${kachel.title.slice(0, 60)}`);
      } catch (e) {
        // Eine kaputte Anzeige darf den ganzen Lauf nicht kippen.
        await ctx.melde(`  ${i + 1}/${neue.length}  uebersprungen: ${(e as Error).message}`);
      }
      await warte();
    }
    return jobs;
  },
};

/** Eine Suchseite oeffnen, nachladen und die Kacheln auslesen. */
async function trefferlisteLesen(
  ctx: AdapterKontext,
  suchwort: string,
  ort: string,
): Promise<Kachel[]> {
  const { page } = ctx;
  const url = sucheUrl(suchwort, ort);

  await seiteOeffnen(page, url, "hokify");
  await cookiesAblehnen(page);

  const liste = page.locator("div.post-link");
  try {
    await liste.first().waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    throw new AdapterFehler(
      "hokify",
      `Keine Trefferkacheln auf ${url} gefunden - die Seite wurde vermutlich umgebaut.`,
    );
  }

  const ueberschrift = await page.locator("h1").first().innerText().catch(() => "");
  await ctx.melde(`Suche "${suchwort}" in ${ort}: ${ueberschrift.trim() || "Trefferliste offen"}`);

  // Nachladen, solange der Knopf da ist und noch nicht genug Treffer stehen.
  const genug = ctx.maxNeueJobs * 2;
  for (let runde = 0; runde < 6; runde++) {
    if ((await liste.count()) >= genug) break;
    const knopf = page.getByRole("button", { name: /laden/i }).first();
    if (!(await knopf.isVisible({ timeout: 1500 }).catch(() => false))) break;
    const vorher = await liste.count();
    await knopf.click().catch(() => {});
    await warte(1200, 2200);
    if ((await liste.count()) === vorher) break; // nichts mehr nachgekommen
  }

  await blockadePruefen(page, "hokify");

  const kacheln = await liste.evaluateAll((knoten) =>
    knoten.map((k) => {
      const a = k.querySelector('h2 a[href*="/job/"]');
      const href = a?.getAttribute("href") ?? "";
      return {
        href,
        title: (a?.textContent ?? "").trim(),
        company: (k.querySelector('[data-cy="companyName"]')?.textContent ?? "").trim() || undefined,
      };
    }),
  );

  const ergebnis: Kachel[] = [];
  for (const k of kacheln) {
    const id = k.href.match(/\/job\/(\d+)/)?.[1];
    if (!id || !k.title) continue;
    ergebnis.push({
      externalId: id,
      url: `${BASIS}/job/${id}`,
      title: k.title,
      company: k.company,
    });
  }
  return ergebnis;
}

/** Eine einzelne Anzeige oeffnen und den vollen Text mitnehmen. */
async function detailLesen(ctx: AdapterKontext, kachel: Kachel): Promise<RohJob> {
  const { page } = ctx;
  await seiteOeffnen(page, kachel.url, "hokify");

  const titel =
    (await page.locator("h1").first().innerText().catch(() => "")).trim() || kachel.title;

  const firma =
    (await page.locator('[data-cy="companyName"]').first().innerText().catch(() => "")).trim() ||
    kachel.company;

  const text = (await page.locator("main").first().innerText().catch(() => "")).trim();
  if (!text) {
    throw new AdapterFehler("hokify", `Anzeige ${kachel.url} hat keinen lesbaren Text.`);
  }

  const arten = await page
    .locator('[data-cy^="employmentType"]')
    .allInnerTexts()
    .catch(() => [] as string[]);
  const anstellung =
    arten
      .map((a) => a.replace(/[,\s]+$/g, "").trim())
      .filter(Boolean)
      .join(", ") || anstellungAusText(titel, text);

  return {
    externalId: kachel.externalId,
    url: kachel.url,
    title: titel,
    company: firma,
    location: ortAusText(text, titel, firma),
    employment: anstellung,
    description: textAufraeumen(text, "Jobs finden"),
    contactEmail: await mailAusSeite(page),
    postedAt: undefined, // hokify zeigt nur "vor X Tagen" - kommt spaeter, wenn noetig
  };
}

/** Anstellungsarten, die hokify verwendet. */
const ANSTELLUNGSARTEN = [
  "Geringfügig",
  "Teilzeit",
  "Vollzeit",
  "Studentenjob",
  "Ferialjob",
  "Praktikum",
  "Lehrstelle",
];

/**
 * Nicht jede hokify-Anzeige hat das Feld fuer die Anstellungsart. Dann steht
 * es meist im Titel ("Mitarbeiter Service in Teilzeit") oder im Kopf der Seite.
 */
function anstellungAusText(titel: string, text: string): string | undefined {
  const suchraum = [titel, ...kopfbereich(text)].join("\n");
  const gefunden = ANSTELLUNGSARTEN.filter((a) => new RegExp(`\\b${a}`, "i").test(suchraum));
  return gefunden.length ? gefunden.join(", ") : undefined;
}
