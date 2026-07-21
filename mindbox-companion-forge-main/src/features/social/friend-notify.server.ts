import "@tanstack/react-start/server-only";

import { getAppBaseUrl, sendEmail, type EmailSendResult } from "@/lib/email/send-html.server";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shell(body: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /></head>
<body style="margin:0;background:#f6f7f9;padding:24px;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;color:#1a1a1a;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:14px;padding:28px;">
    ${body}
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0 12px;" />
    <p style="color:#9aa0a6;font-size:12px;line-height:1.5;margin:0;">
      MindBox — calm focus, one session at a time. You're receiving this because someone
      used your email on MindBox. If this wasn't expected, you can safely ignore it.
    </p>
  </div>
</body>
</html>`;
}

/** "X sent you a friend request" — recipient already has a MindBox account. */
export async function sendFriendRequestEmail({
  toEmail,
  toName,
  fromName,
}: {
  toEmail: string;
  toName?: string | null;
  fromName: string;
}): Promise<EmailSendResult> {
  const appUrl = getAppBaseUrl();
  const who = escapeHtml(fromName);
  const greeting = toName ? `Hi ${escapeHtml(toName)},` : "Hi there,";

  return sendEmail({
    to: toEmail,
    subject: `${fromName} wants to focus with you on MindBox 🎯`,
    html: shell(`
      <p style="font-size:16px;margin:0 0 12px;">${greeting}</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">
        <strong>${who}</strong> just sent you a friend request on MindBox. Accept it to compare
        focus streaks on the leaderboard and cheer each other on. 💪
      </p>
      <p style="margin:0 0 20px;">
        <a href="${appUrl}/friends"
           style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;
                  padding:11px 20px;border-radius:10px;font-size:14px;font-weight:600;">
          View the request
        </a>
      </p>
      <p style="color:#666;font-size:13px;line-height:1.5;margin:0;">
        No pressure — your focus data stays private unless you choose to share it.
      </p>
    `),
  });
}

/** "X accepted your friend request" — sent to the original requester. */
export async function sendFriendAcceptedEmail({
  toEmail,
  toName,
  accepterName,
}: {
  toEmail: string;
  toName?: string | null;
  accepterName: string;
}): Promise<EmailSendResult> {
  const appUrl = getAppBaseUrl();
  const who = escapeHtml(accepterName);
  const greeting = toName ? `Hi ${escapeHtml(toName)},` : "Hi there,";

  return sendEmail({
    to: toEmail,
    subject: `${accepterName} accepted your MindBox friend request 🎉`,
    html: shell(`
      <p style="font-size:16px;margin:0 0 12px;">${greeting}</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">
        Good news — <strong>${who}</strong> accepted your friend request. You'll now see each
        other on the focus leaderboard. Time for some friendly competition. 🔥
      </p>
      <p style="margin:0 0 4px;">
        <a href="${appUrl}/leaderboard"
           style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;
                  padding:11px 20px;border-radius:10px;font-size:14px;font-weight:600;">
          Open the leaderboard
        </a>
      </p>
    `),
  });
}
