import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { FileText, FileSpreadsheet, FileJson, Mail } from "lucide-react";

import { ErrorState, LoadingState } from "@/components/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSessionScope } from "@/hooks/use-session-scope";
import {
  sessionsToCsv,
  sessionsToJson,
  summarize,
  type ReportMeta,
} from "@/features/reports/export";
import { dateKeyDaysAgo } from "@/lib/dates";
import { printReportHtml } from "@/features/reports/print-report";
import { emailReport } from "@/features/reports/report-email.functions";
import { getReportHtml } from "@/features/reports/report.functions";

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

interface Props {
  student?: string;
}

export function ExportsView({ student }: Props) {
  const { user, viewingStudent, isReviewerView, scopedSessions, sessionsQuery } =
    useSessionScope(student);

  const [from, setFrom] = useState(() => dateKeyDaysAgo(29));
  const [to, setTo] = useState(() => dateKeyDaysAgo(0));
  const [note, setNote] = useState<string | null>(null);
  const [noteKind, setNoteKind] = useState<"success" | "error">("success");

  const emailMutation = useMutation({
    mutationFn: () => emailReport({ data: { from, to } }),
    onSuccess: (result) => {
      setNoteKind("success");
      setNote(
        `PDF report emailed to ${result.recipients.join(", ")} (${result.sent} recipient${result.sent === 1 ? "" : "s"}).`,
      );
    },
    onError: (err) => {
      setNoteKind("error");
      setNote(err instanceof Error ? err.message : "Failed to email report.");
    },
  });

  // The rich report is assembled server-side (Focus Model + insights + academic
  // + AI summary), so the print path fetches the finished HTML then prints it.
  const pdfMutation = useMutation({
    mutationFn: () => getReportHtml({ data: { from, to } }),
    onSuccess: ({ html }) => {
      const result = printReportHtml(html, `mindbox-report_${from}_to_${to}.html`);
      setNoteKind(result.ok ? "success" : "error");
      setNote(
        !result.ok
          ? result.reason
          : result.method === "print"
            ? "Print dialog opened — choose “Save as PDF” or your preferred printer."
            : "Downloaded an HTML report — open it in your browser, then Print → Save as PDF.",
      );
    },
    onError: (err) => {
      setNoteKind("error");
      setNote(err instanceof Error ? err.message : "Failed to build the report.");
    },
  });

  const filtered = useMemo(
    () => scopedSessions.filter((s) => s.date >= from && s.date <= to),
    [scopedSessions, from, to],
  );

  const reportSubject = isReviewerView
    ? (viewingStudent?.displayName ?? "Student")
    : (user?.email ?? "MindBox user");

  const meta = useMemo<ReportMeta>(
    () => ({
      user: reportSubject,
      from,
      to,
      generatedAt: new Date().toISOString(),
    }),
    [reportSubject, from, to],
  );

  const summary = useMemo(() => summarize(filtered), [filtered]);
  const stamp = `${from}_to_${to}`;

  const exportCsv = () => {
    setNoteKind("success");
    download(`mindbox-sessions_${stamp}.csv`, sessionsToCsv(filtered), "text/csv;charset=utf-8");
    setNote(`Exported ${filtered.length} session(s) to CSV.`);
  };

  const exportJson = () => {
    setNoteKind("success");
    download(`mindbox-sessions_${stamp}.json`, sessionsToJson(filtered, meta), "application/json");
    setNote(`Exported ${filtered.length} session(s) to JSON.`);
  };

  const exportPdf = () => {
    setNoteKind("success");
    setNote("Building your full report (Focus Model, insights, academic + AI summary)…");
    pdfMutation.mutate();
  };

  const formats = [
    {
      id: "csv",
      label: "CSV",
      icon: FileSpreadsheet,
      desc: "Spreadsheet-friendly rows: time, duration, mode, status, focus & environment stats.",
      action: exportCsv,
      cta: "Download CSV",
    },
    {
      id: "pdf",
      label: "PDF report",
      icon: FileText,
      desc: "Formatted summary + table. Opens the print dialog → choose Save as PDF (no pop-up needed).",
      action: exportPdf,
      cta: "Open PDF report",
    },
    {
      id: "json",
      label: "JSON",
      icon: FileJson,
      desc: "Raw session data + summary for your own analysis.",
      action: exportJson,
      cta: "Download JSON",
    },
  ];

  if (sessionsQuery.isLoading) return <LoadingState label="Loading your sessions…" />;
  if (sessionsQuery.isError) {
    return (
      <ErrorState
        title="Could not load sessions to export"
        description={sessionsQuery.error instanceof Error ? sessionsQuery.error.message : undefined}
        onRetry={() => void sessionsQuery.refetch()}
      />
    );
  }

  return (
    <>
      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="grid gap-1.5">
            <Label htmlFor="exp-from">From</Label>
            <Input
              id="exp-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-[160px]"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="exp-to">To</Label>
            <Input
              id="exp-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-[160px]"
            />
          </div>
          <div className="ml-auto text-right">
            <p className="text-xs text-muted-foreground">In range</p>
            <p className="text-2xl font-semibold tabular-nums">
              {summary.sessionCount}
              <span className="text-sm font-normal text-muted-foreground">
                {" "}
                session{summary.sessionCount === 1 ? "" : "s"} ·{" "}
                {(summary.totalFocusMin / 60).toFixed(1)} h
              </span>
            </p>
          </div>
        </CardContent>
      </Card>

      {note && (
        <p
          role="status"
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            noteKind === "success"
              ? "border-success/30 bg-success/10 text-success"
              : "border-danger/30 bg-danger-muted/40 text-danger"
          }`}
        >
          {note}
        </p>
      )}

      {!isReviewerView && (
        <Card className="mb-6 border-sync/20 bg-sync-muted/20">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-medium">Email PDF report</p>
              <p className="text-xs text-muted-foreground">
                Sends the PDF to your account email and every active reviewer on your list. Requires{" "}
                Gmail SMTP (<code className="rounded bg-muted px-1">SMTP_USER</code> +{" "}
                <code className="rounded bg-muted px-1">SMTP_PASS</code>) in{" "}
                <code className="rounded bg-muted px-1">.env</code>.
              </p>
            </div>
            <Button
              variant="default"
              size="sm"
              disabled={emailMutation.isPending || summary.sessionCount === 0}
              onClick={() => emailMutation.mutate()}
            >
              <Mail className="h-4 w-4" />
              {emailMutation.isPending ? "Sending…" : "Email PDF"}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {formats.map((f) => (
          <Card key={f.id}>
            <CardHeader className="flex-row items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-muted text-muted-foreground">
                <f.icon className="h-4 w-4" aria-hidden />
              </div>
              <CardTitle className="text-base">{f.label}</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">{f.desc}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={f.action}
                disabled={summary.sessionCount === 0 && f.id !== "pdf"}
                className="shrink-0"
              >
                {f.cta}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Reports include start time, duration, mode, status, Focus Load Estimate, and average
        environment stats (noise, temperature, light). The Focus Load Estimate is a heuristic, not a
        validated measurement.
      </p>
    </>
  );
}
