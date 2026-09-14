/**
 * Duenne Huelle um nodemailer - eine Bewerbungsmail verschicken, mit dem
 * Lebenslauf im Anhang.
 *
 * Zwei Sicherheitsnetze liegen bewusst NICHT hier, sondern im aufrufenden
 * Code (agents/mail.ts): `env.dryRun` (gar nichts verschicken) und
 * `env.mailTestMode` (an die eigene statt an die Firmen-Adresse schicken).
 * Diese Datei kennt nur "verschicke genau das an genau die Adresse" - so
 * bleibt bei einem Test klar sichtbar, wo im Code die Sicherung sitzt.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env.ts";

function pruefeEingerichtet() {
  if (!env.mailAddress || !env.mailPassword) {
    throw new Error(
      "MAIL_ADDRESS oder MAIL_APP_PASSWORD fehlt in der .env - " +
        "ohne die beiden kann Apply AI keine Mail verschicken.",
    );
  }
}

let transporter: Transporter | null = null;

function holeTransporter(): Transporter {
  pruefeEingerichtet();
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.mailSmtpHost,
      port: 465,
      secure: true,
      auth: { user: env.mailAddress, pass: env.mailPassword },
    });
  }
  return transporter;
}

export type Bewerbungsmail = {
  an: string;
  betreff: string;
  text: string;
};

/**
 * Verschickt eine Bewerbung mit dem hinterlegten Lebenslauf im Anhang.
 * Gibt die Message-ID zurueck, die spaeter beim Antwort-Abgleich (Phase 7b)
 * nuetzlich wird.
 */
export async function verschicke(mail: Bewerbungsmail): Promise<string> {
  pruefeEingerichtet();
  const lebenslauf = await readFile(env.cvPath).catch((e) => {
    throw new Error(`Lebenslauf nicht lesbar unter ${env.cvPath}: ${(e as Error).message}`);
  });

  const info = await holeTransporter().sendMail({
    from: env.mailAddress,
    to: mail.an,
    subject: mail.betreff,
    text: mail.text,
    attachments: [
      {
        filename: basename(env.cvPath),
        content: lebenslauf,
        contentType: "application/pdf",
      },
    ],
  });

  return info.messageId;
}
