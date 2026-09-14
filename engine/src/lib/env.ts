/**
 * Liest die Zugangsdaten aus der .env-Datei und meckert verstaendlich,
 * wenn etwas fehlt - statt spaeter mit einem kryptischen Fehler abzustuerzen.
 */

function required(name: string, hinweis: string): string {
  const wert = process.env[name];
  if (!wert || wert.trim() === "" || wert.startsWith("sk-ant-...")) {
    throw new Error(
      `In der Datei .env fehlt "${name}".\n` +
        `   ${hinweis}\n` +
        `   Vorlage: .env.example ins Projekt kopieren als .env und ausfuellen.`,
    );
  }
  return wert.trim();
}

function optional(name: string): string | undefined {
  const wert = process.env[name];
  return wert && wert.trim() !== "" ? wert.trim() : undefined;
}

export const env = {
  get anthropicKey() {
    return required("ANTHROPIC_API_KEY", "Schluessel holen auf console.anthropic.com -> API Keys.");
  },
  get supabaseUrl() {
    return required("SUPABASE_URL", "Supabase -> Project Settings -> API -> Project URL.");
  },
  get supabaseKey() {
    return required("SUPABASE_SERVICE_KEY", "Supabase -> Project Settings -> API -> service_role key.");
  },
  telegramToken: optional("TELEGRAM_BOT_TOKEN"),
  telegramChatId: optional("TELEGRAM_CHAT_ID"),
  mailAddress: optional("MAIL_ADDRESS"),
  mailPassword: optional("MAIL_APP_PASSWORD"),
  mailSmtpHost: optional("MAIL_SMTP_HOST") ?? "smtp.gmail.com",
  mailImapHost: optional("MAIL_IMAP_HOST") ?? "imap.gmail.com",
  /**
   * Testwoche (Phase 7): Bewerbungen gehen an die eigene Adresse statt an die
   * Firma, damit man sieht, wie eine Bewerbung ankommt, bevor etwas Echtes
   * rausgeht. Standard: an - erst nach `MAIL_TEST_MODE=0` in der .env geht es
   * wirklich an Firmen.
   */
  mailTestMode: process.env.MAIL_TEST_MODE !== "0",
  /** Pfad zum Lebenslauf-PDF, das jeder Bewerbungsmail angehaengt wird. */
  get cvPath() {
    return required("CV_PDF_PATH", "Pfad zum eigenen Lebenslauf-PDF, Schraegstriche statt Backslashes.");
  },
  /** Browser sichtbar anzeigen, damit man zuschauen kann. */
  headful: process.env.HEADFUL === "1",
  /**
   * Von jeder aufgerufenen Seite ein Bildschirmfoto ablegen. Ersatz fuers
   * Zuschauen ueberall dort, wo kein Fenster aufgehen kann - also auch
   * spaeter in GitHub Actions.
   */
  schritteFotografieren: process.env.SHOTS === "1",
  /** Alles tun ausser wirklich abschicken. Standard: an. */
  dryRun: process.env.DRY_RUN !== "0",
};

/** Modelle an einer Stelle, damit man sie nicht im Code suchen muss. */
export const MODELS = {
  /** Navigieren und Bewerten - guenstig, laeuft oft. */
  fast: "claude-haiku-4-5",
  /**
   * Anschreiben. Bis 2026-09-07 lief hier Opus 5 (5-25 $/Mio Token). Ein
   * Vergleich zur selben Anzeige zeigte Sonnet 5 mindestens gleichwertig
   * und bei weniger als einem Zehntel der Kosten - Opus schrieb das ganze
   * Anschreiben zudem ohne Umlaute (ae/oe/ue statt ä/ö/ü), Sonnet nicht.
   * Nikis Entscheidung: nur noch Sonnet 5, Opus raus.
   */
  good: "claude-sonnet-5",
} as const;

/** Preise in Dollar pro 1 Million Token, fuer die Kostenzaehlung. */
export const PREISE: Record<string, { ein: number; aus: number }> = {
  "claude-haiku-4-5": { ein: 1.0, aus: 5.0 },
  "claude-sonnet-5": { ein: 2.0, aus: 10.0 },
};
