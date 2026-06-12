import "@tanstack/react-start/server-only";

import PDFDocument from "pdfkit";

import { buildReportHtml, summarize, type ReportMeta } from "@/features/reports/export";
import { computeWellbeing } from "@/lib/wellbeing";
import type { Session } from "@/lib/types";

function fmtNum(value: number | null, suffix = ""): string {
  return value == null ? "—" : `${value}${suffix}`;
}

const TABLE_HEADERS = [
  "Date",
  "Start",
  "Min",
  "Mode",
  "Status",
  "FLE",
  "Breaks",
  "Noise",
  "Temp",
  "Light",
] as const;

const COL_WIDTHS = [52, 34, 26, 58, 46, 26, 30, 30, 30, 34];

function sessionRow(s: Session): string[] {
  return [
    s.date,
    s.start,
    String(s.durationMin),
    s.mode,
    s.status,
    String(s.focusScore),
    String(s.breaks),
    fmtNum(s.noiseAvg),
    fmtNum(s.tempC),
    fmtNum(s.lightLux),
  ];
}

function buildReportPdfWithPdfkit(sessions: Session[], meta: ReportMeta): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "A4" });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const sum = summarize(sessions);
    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc.fontSize(20).fillColor("#1a1a1a").text("MindBox — Focus History Report");
    doc.moveDown(0.35);
    doc
      .fontSize(10)
      .fillColor("#666666")
      .text(`For ${meta.user} · ${meta.from} → ${meta.to} · generated ${meta.generatedAt}`, {
        width: contentWidth,
      });
    doc.moveDown(1);

    const cards: Array<{ label: string; value: string }> = [
      { label: "Sessions", value: String(sum.sessionCount) },
      { label: "Total focus", value: `${(sum.totalFocusMin / 60).toFixed(1)} h` },
      { label: "Avg Focus Load Est.", value: String(sum.avgFocusScore) },
      { label: "Avg noise", value: fmtNum(sum.avgNoise) },
      { label: "Avg temp", value: fmtNum(sum.avgTempC, "°C") },
      { label: "Avg light", value: fmtNum(sum.avgLightLux, " lux") },
    ];

    const cardGap = 10;
    const cardWidth = (contentWidth - cardGap * (cards.length - 1)) / cards.length;
    const cardHeight = 46;
    const cardsY = doc.y;

    cards.forEach((card, index) => {
      const x = doc.page.margins.left + index * (cardWidth + cardGap);
      doc
        .roundedRect(x, cardsY, cardWidth, cardHeight, 6)
        .lineWidth(1)
        .strokeColor("#e2e2e2")
        .stroke();
      doc
        .fontSize(9)
        .fillColor("#666666")
        .text(card.label, x + 10, cardsY + 8, { width: cardWidth - 16, lineBreak: false });
      doc
        .fontSize(14)
        .fillColor("#1a1a1a")
        .text(card.value, x + 10, cardsY + 22, { width: cardWidth - 16, lineBreak: false });
    });

    doc.y = cardsY + cardHeight + 18;

    const startX = doc.page.margins.left;
    let y = doc.y;

    doc.fontSize(9).fillColor("#333333");
    let x = startX;
    TABLE_HEADERS.forEach((header, i) => {
      doc.text(header, x, y, { width: COL_WIDTHS[i], lineBreak: false });
      x += COL_WIDTHS[i];
    });
    y += 14;
    doc
      .moveTo(startX, y)
      .lineTo(startX + COL_WIDTHS.reduce((a, b) => a + b, 0), y)
      .strokeColor("#eeeeee")
      .stroke();
    y += 6;

    doc.fontSize(8).fillColor("#1a1a1a");

    const writeRow = (cells: string[]) => {
      if (y > doc.page.height - doc.page.margins.bottom - 24) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      x = startX;
      cells.forEach((cell, i) => {
        doc.text(cell, x, y, { width: COL_WIDTHS[i], lineBreak: false });
        x += COL_WIDTHS[i];
      });
      y += 12;
    };

    if (sessions.length === 0) {
      writeRow(["No sessions in this range.", "", "", "", "", "", "", "", "", ""]);
    } else {
      for (const s of sessions) {
        writeRow(sessionRow(s));
      }
    }

    doc.y = y + 16;
    doc
      .fontSize(8)
      .fillColor("#777777")
      .text(
        "Focus Load Estimate is a transparent heuristic on a 0–100 scale, derived from session length and observed attention/environment patterns. It is not a validated scientific or clinical measurement.",
        { width: contentWidth },
      );

    const wb = computeWellbeing(sessions);
    if (wb.ready) {
      doc.moveDown(0.8);
      doc.fontSize(11).fillColor("#1a1a1a").text("Wellbeing patterns");
      doc.fontSize(8).fillColor("#444444");
      const signals = [
        { title: "Recovery balance", s: wb.recovery },
        { title: "Circadian alignment", s: wb.circadian },
        { title: "Routine consistency", s: wb.consistency },
      ];
      for (const { title, s } of signals) {
        if (!s.ready) continue;
        doc.text(`${title}: ${s.score}/100 (${s.status}) — ${s.headline}`, { width: contentWidth });
      }
      doc
        .moveDown(0.5)
        .fillColor("#777777")
        .text(
          "Report data: sessions, Focus Load Estimate, environment readings and derived wellbeing patterns. No health, clinical, or battery data is included.",
          { width: contentWidth },
        );
    }

    doc.end();
  });
}

async function buildReportPdfFromHtml(html: string): Promise<Buffer> {
  const puppeteer = await import("puppeteer");
  const browser = await puppeteer.default.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    // The report HTML is fully self-contained (inline styles, no network
    // fetches), so "load" is sufficient. Puppeteer's setContent type also
    // excludes networkidle0/2.
    await page.setContent(html, { waitUntil: "load" });
    const bytes = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
    });
    return Buffer.from(bytes);
  } finally {
    await browser.close();
  }
}

/** Same report as the on-site print dialog, rendered to PDF for email attachment. */
export async function buildReportPdf(sessions: Session[], meta: ReportMeta): Promise<Buffer> {
  const html = buildReportHtml(sessions, meta);

  try {
    return await buildReportPdfFromHtml(html);
  } catch {
    return buildReportPdfWithPdfkit(sessions, meta);
  }
}
