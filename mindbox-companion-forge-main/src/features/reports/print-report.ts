export type PrintReportResult =
  | { ok: true; method: "print" | "download" }
  | { ok: false; reason: string };

function downloadReportHtml(html: string, filename: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Opens the system print dialog for a self-contained HTML report without
 * `window.open()` (avoids pop-up blockers). Falls back to downloading the HTML.
 */
export function printReportHtml(html: string, filename = "mindbox-report.html"): PrintReportResult {
  if (typeof document === "undefined") {
    return { ok: false, reason: "Print is only available in the browser." };
  }

  try {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("title", "MindBox report");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0";

    document.body.appendChild(iframe);

    const win = iframe.contentWindow;
    const doc = iframe.contentDocument ?? win?.document;
    if (!win || !doc) {
      iframe.remove();
      downloadReportHtml(html, filename);
      return {
        ok: true,
        method: "download",
      };
    }

    doc.open();
    doc.write(html);
    doc.close();

    const cleanup = () => {
      iframe.remove();
    };

    win.onafterprint = cleanup;

    // Allow layout before print; onafterprint may not fire in every browser.
    window.setTimeout(() => {
      win.focus();
      win.print();
      window.setTimeout(cleanup, 60_000);
    }, 300);

    return { ok: true, method: "print" };
  } catch {
    try {
      downloadReportHtml(html, filename);
      return { ok: true, method: "download" };
    } catch {
      return { ok: false, reason: "Could not open the print dialog or download the report." };
    }
  }
}
