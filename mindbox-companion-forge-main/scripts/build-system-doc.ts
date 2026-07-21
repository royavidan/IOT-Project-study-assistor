/**
 * Builds docs/MindBox-System-Guide.pdf from the HTML chapter fragments in
 * docs/system-guide/ (sorted by filename) + guide.css.
 *
 * Same puppeteer pattern as src/features/reports/build-report-pdf.server.ts
 * (headless, setContent "load", A4, printBackground). Run with the dev deps
 * installed:
 *
 *   bun run doc          (alias in package.json)
 *   npx tsx scripts/build-system-doc.ts
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import puppeteer from "puppeteer";

const GUIDE_DIR = path.resolve(import.meta.dirname ?? ".", "../docs/system-guide");
const OUT_PDF = path.resolve(GUIDE_DIR, "../MindBox-System-Guide.pdf");
const OUT_HTML = path.resolve(GUIDE_DIR, "../MindBox-System-Guide.html");

function buildHtml(): string {
  const css = fs.readFileSync(path.join(GUIDE_DIR, "guide.css"), "utf8");
  const fragments = fs
    .readdirSync(GUIDE_DIR)
    .filter((f) => /^\d+.*\.html$/.test(f))
    .sort();
  if (fragments.length === 0) {
    console.error(`No chapter fragments found in ${GUIDE_DIR}`);
    process.exit(1);
  }
  console.log(`Chapters: ${fragments.join(", ")}`);
  const body = fragments.map((f) => fs.readFileSync(path.join(GUIDE_DIR, f), "utf8")).join("\n");
  return `<!doctype html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<title>MindBox — System Guide</title>
<style>${css}</style>
</head>
<body>
${body}
</body>
</html>`;
}

async function main(): Promise<void> {
  const html = buildHtml();
  fs.writeFileSync(OUT_HTML, html, "utf8");
  console.log(`HTML written: ${OUT_HTML}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({
      path: OUT_PDF,
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", bottom: "16mm", left: "12mm", right: "12mm" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#888;text-align:center;">' +
        'MindBox System Guide — <span class="pageNumber"></span>/<span class="totalPages"></span></div>',
    });
    console.log(`PDF written: ${OUT_PDF}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
