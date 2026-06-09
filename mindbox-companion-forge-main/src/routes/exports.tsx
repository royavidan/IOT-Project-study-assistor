import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, FileSpreadsheet, FileJson } from "lucide-react";

export const Route = createFileRoute("/exports")({
  head: () => ({ meta: [{ title: "Exports — MindBox" }] }),
  component: Exports,
});

const formats = [
  { id: "csv", label: "CSV", icon: FileSpreadsheet, desc: "Spreadsheet-friendly summary." },
  { id: "pdf", label: "PDF report", icon: FileText, desc: "Weekly review for a tutor or parent." },
  { id: "json", label: "JSON", icon: FileJson, desc: "Raw session data for analysis." },
] as const;

function Exports() {
  return (
    <>
      <PageHeader title="Exports" description="Download or share your focus history." />
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
              <Button variant="outline" size="sm">Export</Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
