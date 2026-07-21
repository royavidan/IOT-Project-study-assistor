import "@tanstack/react-start/server-only";

import nodemailer from "nodemailer";

import { getServerConfig } from "@/lib/config.server";

export type EmailAttachment = {
  filename: string;
  content: Buffer;
};

export type EmailSendResult = { sent: true; id: string } | { sent: false; reason: string };

type MailPayload = {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
};

function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());
}

function smtpFromAddress(): string {
  const user = process.env.SMTP_USER?.trim();
  return (
    process.env.SMTP_FROM?.trim() ||
    process.env.RESEND_FROM_EMAIL?.trim() ||
    (user ? `MindBox <${user}>` : "MindBox <noreply@localhost>")
  );
}

/** Sends via Gmail (or any SMTP server) when SMTP_USER + SMTP_PASS are set. */
async function sendViaSmtp(payload: MailPayload): Promise<EmailSendResult> {
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  if (!user || !pass) {
    return {
      sent: false,
      reason: "SMTP_USER and SMTP_PASS are not configured.",
    };
  }

  const port = Number(process.env.SMTP_PORT ?? 587);
  const secure =
    process.env.SMTP_SECURE === "true" || process.env.SMTP_SECURE === "1" || port === 465;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST?.trim() || "smtp.gmail.com",
    port,
    secure,
    auth: { user, pass },
  });

  try {
    const info = await transporter.sendMail({
      from: smtpFromAddress(),
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      attachments: payload.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
      })),
    });
    return { sent: true, id: info.messageId || "smtp" };
  } catch (e) {
    const message = e instanceof Error ? e.message : "SMTP send failed.";
    return {
      sent: false,
      reason: `SMTP error: ${message}. For Gmail, use an App Password (not your login password).`,
    };
  }
}

/** Sends via Resend when RESEND_API_KEY is configured (requires a verified domain for production). */
async function sendViaResend(payload: MailPayload): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim() ?? "MindBox <onboarding@resend.dev>";

  if (!apiKey) {
    return {
      sent: false,
      reason:
        "Email is not configured. Add SMTP_USER + SMTP_PASS (Gmail App Password) or RESEND_API_KEY to .env.",
    };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [payload.to],
      subject: payload.subject,
      html: payload.html,
      attachments: payload.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content.toString("base64"),
      })),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    return { sent: false, reason: `Resend API error (${res.status}): ${body}` };
  }

  const json = (await res.json()) as { id?: string };
  return { sent: true, id: json.id ?? "unknown" };
}

/**
 * Sends HTML email (optional attachments). Prefers Gmail SMTP when configured;
 * falls back to Resend. SMTP works without a custom domain — ideal for coursework.
 */
export async function sendEmail(payload: MailPayload): Promise<EmailSendResult> {
  if (smtpConfigured()) {
    return sendViaSmtp(payload);
  }
  return sendViaResend(payload);
}

/** @deprecated Use sendEmail */
export const sendHtmlEmail = sendEmail;

export function getAppBaseUrl(): string {
  const { appBaseUrl } = getServerConfig();
  return (appBaseUrl ?? "http://localhost:8080").replace(/\/$/, "");
}
