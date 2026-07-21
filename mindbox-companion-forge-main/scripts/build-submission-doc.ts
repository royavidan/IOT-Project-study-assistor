/**
 * Builds docs/MindBox-Submission-Guide.pdf from the HTML chapter fragments in
 * docs/submission-guide/ (sorted by filename) + guide.css.
 *
 * This is a STANDALONE submission/demo guide, separate from the system guide
 * (build-system-doc.ts). Same puppeteer pattern: headless, setContent "load",
 * A4, printBackground, RTL Hebrew. Run with the dev deps installed:
 *
 *   bun run doc:submission        (alias in package.json)
 *   npx tsx scripts/build-submission-doc.ts
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import puppeteer from "puppeteer";

const GUIDE_DIR = path.resolve(import.meta.dirname ?? ".", "../docs/submission-guide");
const OUT_PDF = path.resolve(GUIDE_DIR, "../MindBox-Submission-Guide.pdf");
const OUT_HTML = path.resolve(GUIDE_DIR, "../MindBox-Submission-Guide.html");

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
<title>MindBox — מדריך הגשה ותסריט הדגמה</title>
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
        'MindBox — מדריך הגשה · <span class="pageNumber"></span>/<span class="totalPages"></span></div>',
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
