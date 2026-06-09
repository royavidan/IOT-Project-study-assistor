import "@tanstack/react-start/server-only";

import { getServerConfig } from "@/lib/config.server";

export type EmailAttachment = {
  filename: string;
  content: Buffer;
};

export type EmailSendResult = { sent: true; id: string } | { sent: false; reason: string };

/** Sends email via Resend when RESEND_API_KEY is configured. */
export async function sendEmail({
  to,
  subject,
  html,
  attachments,
}: {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL ?? "MindBox <onboarding@resend.dev>";

  if (!apiKey) {
    return {
      sent: false,
      reason: "RESEND_API_KEY is not configured. Add it to .env to enable report emails.",
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
      to: [to],
      subject,
      html,
      attachments: attachments?.map((a) => ({
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

/** @deprecated Use sendEmail */
export const sendHtmlEmail = sendEmail;

export function getAppBaseUrl(): string {
  const { appBaseUrl } = getServerConfig();
  return (appBaseUrl ?? "http://localhost:8080").replace(/\/$/, "");
}
