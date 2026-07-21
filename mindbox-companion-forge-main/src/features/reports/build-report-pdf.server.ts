import "@tanstack/react-start/server-only";

import PDFDocument from "pdfkit";

import { buildReportHtml, type ReportModel } from "./report-model";

/** Primary path: headless Chrome renders the self-contained HTML (incl. SVG charts) → PDF bytes. */
async function buildReportPdfFromHtml(html: string): Promise<Buffer> {
  const puppeteer = await import("puppeteer");
  // On hosts where Puppeteer can't bundle a working Chrome (e.g. arm64, where
  // Google ships no Chrome-for-Testing build), point it at a system Chromium via
  // PUPPETEER_EXECUTABLE_PATH. Unset → Puppeteer's own download.
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
  const browser = await puppeteer.default.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    // Fully self-contained HTML (inline styles + inline SVG, no network fetches).
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

/**
 * Fallback when headless Chrome is unavailable on the host: a text-only pdfkit
 * document from the SAME model (no charts — those need the HTML/Chrome path).
 * Still renders the narrative, stats, focus/load summary, and the session log /
 * session dynamics, so the emailed PDF degrades to "text-rich", never blank.
 */
function buildReportPdfFallback(model: ReportModel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const cw = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const title =
      model.scope === "session" ? "MindBox — Session Report" : "MindBox — Weekly Focus Report";
    doc.fontSize(20).fillColor("#1a1a1a").text(title);
    doc
      .moveDown(0.3)
      .fontSize(10)
      .fillColor("#666666")
      .text(
        `For ${model.meta.user} · ${model.meta.from} → ${model.meta.to} · generated ${model.meta.generatedAt}`,
        {
          width: cw,
        },
      );
    doc.moveDown(0.8);

    if (model.narrative) {
      doc.fontSize(12).fillColor("#1a1a1a").text(model.narrative.headline, { width: cw });
      doc.fontSize(9).fillColor("#333333");
      for (const p of model.narrative.paragraphs) doc.moveDown(0.2).text(p, { width: cw });
      doc.moveDown(0.6);
    }
    if (model.stats?.length) {
      doc
        .fontSize(9)
        .fillColor("#333333")
        .text(model.stats.map((s) => `${s.label}: ${s.value}`).join("     "), { width: cw });
      doc.moveDown(0.5);
    }
    if (model.focus) {
      doc
        .fontSize(9)
        .fillColor("#333333")
        .text(
          `Focus energy: ${model.focus.energyScore}/100 (${model.focus.headline}) — ${model.focus.reliability}`,
          {
            width: cw,
          },
        );
      doc.moveDown(0.4);
    }
    if (model.overload) {
      doc
        .fontSize(9)
        .fillColor("#333333")
        .text(
          `Load: ${model.overload.level}${model.overload.rules.length ? " — " + model.overload.rules.join("; ") : ""}`,
          {
            width: cw,
          },
        );
      doc.moveDown(0.6);
    }

    if (model.scope === "weekly" && model.sessions?.length) {
      doc.fontSize(11).fillColor("#1a1a1a").text("Session log");
      doc.moveDown(0.2).fontSize(8).fillColor("#1a1a1a");
      const startX = doc.page.margins.left;
      const widths = [62, 38, 28, 66, 56, 30, 34];
      let y = doc.y;
      const writeRow = (cells: string[]) => {
        if (y > doc.page.height - doc.page.margins.bottom - 24) {
          doc.addPage();
          y = doc.page.margins.top;
        }
        let x = startX;
        cells.forEach((c, i) => {
          doc.text(c, x, y, { width: widths[i], lineBreak: false });
          x += widths[i];
        });
        y += 12;
      };
      writeRow(["Date", "Start", "Min", "Mode", "Status", "Load", "Tired"]);
      for (const s of model.sessions)
        writeRow([
          s.date,
          s.start,
          String(s.durationMin),
          s.mode,
          s.status,
          String(s.focusScore),
          s.tiredness != null ? String(s.tiredness) : "—",
        ]);
      doc.y = y + 10;
    }

    if (model.scope === "session" && model.sessionDetail) {
      const d = model.sessionDetail;
      doc.fontSize(11).fillColor("#1a1a1a").text("Session");
      doc
        .moveDown(0.2)
        .fontSize(9)
        .fillColor("#333333")
        .text(
          `${d.mode} · ${d.durationMin} min · ${d.status} · ${d.breaks} breaks · ${d.presenceInterruptions} interruptions`,
          {
            width: cw,
          },
        );
      doc
        .moveDown(0.2)
        .text(
          `Avg load ${d.dynamics.loadMean.toFixed(0)}, peak ${d.dynamics.loadPeak.toFixed(0)}, trend ${d.dynamics.loadSlope > 0 ? "+" : ""}${d.dynamics.loadSlope.toFixed(0)}/10min`,
          { width: cw },
        );
      if (d.checkin)
        doc
          .moveDown(0.2)
          .text(
            `Check-in: tiredness ${d.checkin.tiredness}/5${d.checkin.note ? ` — “${d.checkin.note}”` : ""}`,
            {
              width: cw,
            },
          );
      doc.moveDown(0.4);
    }

    doc
      .moveDown(0.6)
      .fontSize(8)
      .fillColor("#777777")
      .text(
        "Focus Load and the Focus Model are transparent estimates (0–100) with uncertainty — not validated scientific or clinical measurements.",
        { width: cw },
      );
    doc.end();
  });
}

/** Render a report model to PDF bytes: Chrome (with charts) first, text-only pdfkit on failure. */
export async function buildReportPdf(model: ReportModel): Promise<Buffer> {
  const html = buildReportHtml(model);
  try {
    return await buildReportPdfFromHtml(html);
  } catch {
    return buildReportPdfFallback(model);
  }
}
