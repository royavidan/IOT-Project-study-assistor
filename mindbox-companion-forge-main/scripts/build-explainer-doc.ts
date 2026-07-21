/**
 * Builds docs/MindBox-Project-Explainer.pdf from the HTML chapter fragments in
 * docs/project-explainer/ (sorted by filename) + explainer.css.
 *
 * A light, readable, English project explainer. Same puppeteer pattern as
 * build-submission-doc.ts, but LTR English.
 *
 *   bun run doc:explainer
 *   npx tsx scripts/build-explainer-doc.ts
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import puppeteer from "puppeteer";

const DIR = path.resolve(import.meta.dirname ?? ".", "../docs/project-explainer");
const OUT_PDF = path.resolve(DIR, "../MindBox-Project-Explainer.pdf");
const OUT_HTML = path.resolve(DIR, "../MindBox-Project-Explainer.html");

function buildHtml(): string {
  const css = fs.readFileSync(path.join(DIR, "explainer.css"), "utf8");
  const fragments = fs
    .readdirSync(DIR)
    .filter((f) => /^\d+.*\.html$/.test(f))
    .sort();
  if (fragments.length === 0) {
    console.error(`No chapter fragments found in ${DIR}`);
    process.exit(1);
  }
  console.log(`Chapters: ${fragments.join(", ")}`);
  const body = fragments.map((f) => fs.readFileSync(path.join(DIR, f), "utf8")).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>MindBox — Project Explainer</title>
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
      margin: { top: "16mm", bottom: "16mm", left: "15mm", right: "15mm" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#aab;text-align:center;font-family:Segoe UI,Arial;">' +
        'MindBox — Project Explainer · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
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
