/**
 * explorer - die Notbetriebsart, wenn ein Adapter nicht mehr passt.
 *
 * Jeder Portal-Adapter haengt an Anhaltspunkten wie `div.post-link`. Baut das
 * Portal seine Seite um, findet der Adapter nichts mehr und wirft einen
 * AdapterFehler. Ohne Explorer stuende Apply AI dann still, bis jemand
 * nachschaut - bei einem Bot, der nachts allein laeuft, kann das Wochen dauern.
 *
 * Der Explorer springt genau dann ein. Er kennt kein Portal, sondern geht vor
 * wie ein Mensch, der eine fremde Seite zum ersten Mal sieht:
 *
 *   1. Seite oeffnen und einen Abriss davon machen (lib/abriss.ts) - welche
 *      Links sehen nach Anzeigen aus, welche Kaesten wiederholen sich?
 *   2. Claude Haiku legt anhand des Abrisses fest, woran man sich festhalten
 *      soll: Kachel, Titellink, Firma, Nummer in der Adresse.
 *   3. Der Vorschlag wird sofort auf der echten Seite ausprobiert. Kommt
 *      nichts Brauchbares heraus, bekommt Claude den Grund zu lesen und darf
 *      es genau einmal neu versuchen. Danach ist Schluss.
 *   4. Die gefundenen Anzeigen werden einzeln aufgemacht. Firma, Ort und
 *      Anstellungsart liest Claude aus dem Text - der haengt an keinem
 *      Seitenaufbau und ueberlebt jeden Umbau.
 *
 * Wichtig: Der Explorer ist Notbetrieb, kein Dauerzustand. Er kostet pro Lauf
 * ein paar Cent statt fast nichts, und er ist langsamer. Deshalb meldet er
 * jedes Mal, was er gefunden hat, damit der Adapter richtig repariert werden
 * kann.
 *
 * Die Grenzen bleiben unangetastet: derselbe Browser, dieselben Pausen, und
 * bei einer Sperre bricht er genauso ab wie der Scout.
 */
import type { Page } from "playwright";
import { claude, kosten } from "../lib/claude.ts";
import { MODELS } from "../lib/env.ts";
import { abrissAlsText, abrissLesen } from "../lib/abriss.ts";
import { AdapterFehler, cookiesAblehnen, seiteOeffnen, warte } from "../lib/browser.ts";
import { mailAusSeite, ortAusText, textAufraeumen } from "../adapters/hilfen.ts";
import type { AdapterKontext, RohJob } from "../adapters/typen.ts";

/** Woran der Explorer sich auf einer Trefferliste festhaelt. */
export type Selektoren = {
  kachel: string;
  titel_link: string;
  firma: string;
  id_muster: string;
  begruendung: string;
};

export type Kachel = { externalId: string; url: string; title: string; company?: string };

export type Erkundung = {
  jobs: RohJob[];
  /** Was der Explorer benutzt hat - Vorlage fuer die Reparatur des Adapters. */
  selektoren?: Selektoren;
  /** Die Adresse, auf der es geklappt hat. */
  url?: string;
  kostenUsd: number;
};

// ------------------------------------------------------------- Antwortformate

const FORMAT_SELEKTOREN = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    properties: {
      kachel: {
        type: "string",
        description:
          "CSS-Ausdruck fuer EINE Trefferkachel. Muss mehrfach auf der Seite " +
          "vorkommen - einmal pro Anzeige. Nimm bevorzugt einen der " +
          "vorgeschlagenen Kaesten.",
      },
      titel_link: {
        type: "string",
        description:
          "CSS-Ausdruck INNERHALB der Kachel fuer den Link zur Anzeige, etwa " +
          "a[href*=\"/job/\"]. Sein Text ist der Stellentitel.",
      },
      firma: {
        type: "string",
        description:
          "CSS-Ausdruck innerhalb der Kachel fuer den Firmennamen. " +
          "Leerer Text, wenn die Kachel keinen zeigt.",
      },
      id_muster: {
        type: "string",
        description:
          "Regulaerer Ausdruck, der die Anzeigennummer aus der Adresse holt. " +
          "Die gesuchte Nummer steht in der ersten Klammer, etwa /job/(\\d+) " +
          "oder [?&]jk=([a-z0-9]+). Leerer Text, wenn keine Nummer erkennbar ist.",
      },
      begruendung: {
        type: "string",
        description: "Ein Satz auf Deutsch: warum diese Wahl.",
      },
    },
    required: ["kachel", "titel_link", "firma", "id_muster", "begruendung"],
    additionalProperties: false,
  },
};

const FORMAT_FELDER = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    properties: {
      firma: { type: "string", description: "Name des Unternehmens, sonst leerer Text." },
      ort: {
        type: "string",
        description:
          "Arbeitsort, moeglichst mit Postleitzahl (Beispiel: 1190 Wien). Sonst leerer Text.",
      },
      anstellung: {
        type: "string",
        description:
          "Anstellungsart, so wie sie dasteht: geringfuegig, Teilzeit, " +
          "Vollzeit. Mehrere durch Komma trennen. Sonst leerer Text.",
      },
    },
    required: ["firma", "ort", "anstellung"],
    additionalProperties: false,
  },
};

const ANWEISUNG_SELEKTOREN = `
Du bekommst den Abriss einer Trefferliste auf einem oesterreichischen
Jobportal. Der bisherige Auslesecode passt nicht mehr, weil die Seite
umgebaut wurde.

Deine Aufgabe: Sag, woran man sich jetzt festhalten kann, um jede einzelne
Stellenanzeige mit Titel und Adresse aus der Liste zu holen.

So entscheidest du:
  - Nimm den Kasten, der moeglichst genau einmal pro Anzeige vorkommt.
    "10x auf der Seite, davon 10 mit Anzeigenlink" ist gut. "1x auf der
    Seite, davon 25 mit Anzeigenlink" ist ein Rahmen um die ganze Liste -
    damit bekommt man alle Anzeigen als einen Klumpen und kann sie nicht
    voneinander trennen.
  - Bevorzuge Kennzeichnungen (data-testid, data-cy) vor Klassennamen:
    Klassennamen aendern sich bei jedem Umbau, Kennzeichnungen selten.
  - Der Titellink zeigt auf die Anzeige selbst, nicht auf die Firmenseite
    und nicht auf "merken" oder "teilen".
  - Werbekacheln und Newsletter-Kaesten sind keine Stellenanzeigen.

Antworte nur im vorgegebenen Format.
`.trim();

const ANWEISUNG_FELDER = `
Du bekommst den sichtbaren Text einer einzelnen Stellenanzeige.
Hol drei Angaben heraus: Firma, Arbeitsort und Anstellungsart.

Nimm nur, was wirklich dasteht. Rate nichts dazu - ein leerer Text ist
besser als eine erfundene Angabe. Der Arbeitsort ist der Ort, an dem
gearbeitet wird, nicht der Firmensitz und nicht die Adresse der Zentrale.
`.trim();

// ------------------------------------------------------------- Hauptablauf

/**
 * Ein vollstaendiger Erkundungslauf: Adressen der Reihe nach durchgehen, bis
 * eine Trefferliste zu lesen ist, dann die neuen Anzeigen aufmachen.
 */
export async function erkundungslauf(ctx: AdapterKontext, adressen: string[]): Promise<Erkundung> {
  let kostenGesamt = 0;

  for (const [i, adresse] of adressen.entries()) {
    await ctx.melde(`Erkundung ${i + 1}/${adressen.length}: ${adresse}`);

    let ergebnis: { kacheln: Kachel[]; selektoren: Selektoren; kostenUsd: number };
    try {
      ergebnis = await trefferlisteErkunden(ctx, adresse);
    } catch (e) {
      // Eine Sperre reicht der Explorer durch - dagegen hilft er nicht,
      // und dagegen soll er auch nicht helfen.
      if ((e as Error).name === "BlockadeFehler") throw e;
      await ctx.melde(`  nichts zu holen: ${(e as Error).message}`);
      continue;
    }
    kostenGesamt += ergebnis.kostenUsd;

    const { kacheln, selektoren } = ergebnis;
    await ctx.melde(
      `  ${kacheln.length} Anzeigen erkannt ueber "${selektoren.kachel}" - ${selektoren.begruendung}`,
    );

    const neue = kacheln.filter((k) => ctx.istNeu(k.externalId)).slice(0, ctx.maxNeueJobs);
    await ctx.melde(`  davon ${neue.length} neu - die werden jetzt aufgemacht.`);

    const jobs: RohJob[] = [];
    for (const [n, kachel] of neue.entries()) {
      try {
        const { job, kostenUsd } = await detailErkunden(ctx, kachel);
        kostenGesamt += kostenUsd;
        jobs.push(job);
        await ctx.melde(`  ${n + 1}/${neue.length}  ${kachel.title.slice(0, 60)}`);
      } catch (e) {
        await ctx.melde(`  ${n + 1}/${neue.length}  uebersprungen: ${(e as Error).message}`);
      }
      await warte();
    }

    return { jobs, selektoren, url: adresse, kostenUsd: kostenGesamt };
  }

  return { jobs: [], kostenUsd: kostenGesamt };
}

/**
 * Eine Trefferliste oeffnen und herausfinden, wie man sie ausliest.
 * Wirft AdapterFehler, wenn auch der zweite Versuch nichts bringt.
 */
export async function trefferlisteErkunden(
  ctx: AdapterKontext,
  adresse: string,
): Promise<{ kacheln: Kachel[]; selektoren: Selektoren; kostenUsd: number }> {
  const { page } = ctx;
  const portal = ctx.portal.id;

  await seiteOeffnen(page, adresse, portal);
  await cookiesAblehnen(page);
  // Viele Listen bauen sich erst nach dem Laden auf - sonst zaehlen wir Luft.
  await warte(1500, 2500);

  const abriss = await abrissLesen(page);
  const abrissText = abrissAlsText(abriss);
  let kostenGesamt = 0;
  let rueckmeldung = "";

  for (let versuch = 1; versuch <= 2; versuch++) {
    const { selektoren, kostenUsd } = await selektorenFragen(abrissText, rueckmeldung);
    kostenGesamt += kostenUsd;

    const kacheln = await kachelnLesen(page, selektoren);
    if (kacheln.length >= 2) return { kacheln, selektoren, kostenUsd: kostenGesamt };

    rueckmeldung =
      `Dein Vorschlag hat nicht funktioniert: mit kachel="${selektoren.kachel}" und ` +
      `titel_link="${selektoren.titel_link}" kamen ${kacheln.length} verwertbare Anzeigen ` +
      `heraus. Nimm einen anderen Kasten oder einen anderen Titellink.`;
    await ctx.melde(`  Versuch ${versuch} brachte ${kacheln.length} Anzeigen - noch einmal.`);
  }

  throw new AdapterFehler(
    portal,
    `Auch der Explorer kommt auf ${adresse} zu keiner lesbaren Trefferliste.`,
  );
}

// ------------------------------------------------------------- Einzelschritte

/** Fragt Claude, woran man sich festhalten soll. */
async function selektorenFragen(
  abrissText: string,
  rueckmeldung: string,
): Promise<{ selektoren: Selektoren; kostenUsd: number }> {
  const antwort = await claude.messages.create({
    model: MODELS.fast,
    max_tokens: 700,
    system: [{ type: "text", text: ANWEISUNG_SELEKTOREN }],
    messages: [
      {
        role: "user",
        content: rueckmeldung ? `${abrissText}\n\n---\n${rueckmeldung}` : abrissText,
      },
    ],
    output_config: { format: FORMAT_SELEKTOREN },
  });

  const roh = antwort.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  return {
    selektoren: JSON.parse(roh) as Selektoren,
    kostenUsd: kosten(MODELS.fast, antwort.usage.input_tokens, antwort.usage.output_tokens),
  };
}

/**
 * Probiert den Vorschlag auf der echten Seite aus.
 *
 * Ein CSS-Ausdruck aus einer Antwort kann Unsinn sein - `querySelectorAll`
 * wirft dann. Deshalb steht jeder Zugriff in einem eigenen try, und was
 * nicht geht, liefert einfach nichts, statt den Lauf abzubrechen.
 */
async function kachelnLesen(page: Page, sel: Selektoren): Promise<Kachel[]> {
  const roh = await page.evaluate(
    ({ kachel, titelLink, firma }) => {
      let knoten: Element[] = [];
      try {
        knoten = Array.from(document.querySelectorAll(kachel));
      } catch {
        return [] as { href: string; title: string; company?: string }[];
      }
      return knoten.map((k) => {
        let a: Element | null = null;
        try {
          a = titelLink ? k.querySelector(titelLink) : k.querySelector("a[href]");
        } catch {
          a = k.querySelector("a[href]");
        }
        let f: Element | null = null;
        try {
          f = firma ? k.querySelector(firma) : null;
        } catch {
          f = null;
        }
        return {
          // .href statt getAttribute: der Browser macht daraus von selbst
          // eine vollstaendige Adresse, auch bei "/job/123".
          href: (a as HTMLAnchorElement | null)?.href ?? "",
          title: (a?.textContent ?? "").replace(/\s+/g, " ").trim(),
          company: (f?.textContent ?? "").replace(/\s+/g, " ").trim() || undefined,
        };
      });
    },
    { kachel: sel.kachel, titelLink: sel.titel_link, firma: sel.firma },
  );

  // Ein Muster aus einer Antwort kann kaputt sein - dann wird es weggelassen.
  let muster: RegExp | undefined;
  try {
    if (sel.id_muster) muster = new RegExp(sel.id_muster);
  } catch {
    muster = undefined;
  }

  const gesehen = new Set<string>();
  const kacheln: Kachel[] = [];
  for (const r of roh) {
    if (!r.href || !r.title) continue;
    if (!/^https?:/i.test(r.href)) continue;
    const id = kennungAusUrl(r.href, muster);
    if (!id || gesehen.has(id)) continue;
    gesehen.add(id);
    kacheln.push({ externalId: id, url: r.href, title: r.title, company: r.company });
  }
  return kacheln;
}

/**
 * Die Nummer der Anzeige aus der Adresse holen. Sie ist der Schluessel, an
 * dem der Scout Bekanntes von Neuem unterscheidet - ohne sie waere jede
 * Anzeige bei jedem Lauf wieder neu.
 *
 * Drei Wege, in dieser Reihenfolge: das vorgeschlagene Muster, die laengste
 * Zahl im Pfad, und zuletzt der Pfad selbst.
 */
function kennungAusUrl(url: string, muster?: RegExp): string | undefined {
  if (muster) {
    const treffer = url.match(muster);
    const gefunden = treffer?.[1] ?? treffer?.[0];
    if (gefunden) return gefunden.slice(0, 60);
  }
  let pfad: string;
  try {
    pfad = new URL(url).pathname;
  } catch {
    return undefined;
  }
  const zahlen = pfad.match(/\d{4,}/g);
  if (zahlen && zahlen.length > 0) {
    return [...zahlen].sort((a, b) => b.length - a.length)[0];
  }
  const rest = pfad.replace(/\/$/, "");
  return rest.length > 1 ? rest.slice(-60) : undefined;
}

/**
 * Eine einzelne Anzeige aufmachen und auslesen.
 *
 * Der Text wird ohne jeden Anhaltspunkt geholt (`main`, sonst `body`) - das
 * geht auf jeder Seite. Die drei Angaben, die im Text verstreut stehen,
 * holt Claude heraus; beim Ort springt zusaetzlich die Textsuche aus
 * `hilfen.ts` ein, falls Claude nichts findet.
 */
export async function detailErkunden(
  ctx: AdapterKontext,
  kachel: Kachel,
): Promise<{ job: RohJob; kostenUsd: number }> {
  const { page } = ctx;
  await seiteOeffnen(page, kachel.url, ctx.portal.id);

  let text = (await page.locator("main").first().innerText().catch(() => "")).trim();
  if (text.length < 200) {
    text = (await page.locator("body").innerText().catch(() => "")).trim();
  }
  if (!text) throw new AdapterFehler(ctx.portal.id, `${kachel.url} hat keinen lesbaren Text.`);

  const titel =
    (await page.locator("h1").first().innerText().catch(() => "")).trim() || kachel.title;

  const antwort = await claude.messages.create({
    model: MODELS.fast,
    max_tokens: 300,
    system: [{ type: "text", text: ANWEISUNG_FELDER }],
    messages: [{ role: "user", content: `Titel: ${titel}\n\n${text.slice(0, 6000)}` }],
    output_config: { format: FORMAT_FELDER },
  });

  const roh = antwort.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  const felder = JSON.parse(roh) as { firma: string; ort: string; anstellung: string };

  return {
    job: {
      externalId: kachel.externalId,
      url: kachel.url,
      title: titel,
      company: felder.firma.trim() || kachel.company,
      location: felder.ort.trim() || ortAusText(text, titel, kachel.company),
      employment: felder.anstellung.trim() || undefined,
      description: textAufraeumen(text),
      contactEmail: await mailAusSeite(page),
    },
    kostenUsd: kosten(MODELS.fast, antwort.usage.input_tokens, antwort.usage.output_tokens),
  };
}
