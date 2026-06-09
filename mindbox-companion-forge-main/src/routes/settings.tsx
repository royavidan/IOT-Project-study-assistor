import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — MindBox" }] }),
  component: Settings,
});

const rows = [
  { id: "notifs", label: "Session reminders", desc: "Gentle nudges at scheduled study times." },
  { id: "haptics", label: "Device haptics", desc: "Subtle vibrations when work/break starts." },
  { id: "share", label: "Share with reviewers", desc: "Auto-send weekly summaries." },
  { id: "dark", label: "Reduce motion", desc: "Calmer animations across the app." },
];

function Settings() {
  return (
    <>
      <PageHeader title="Settings" description="Tune the experience to fit your routine." />
      <Card>
        <CardContent className="divide-y divide-border p-0">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-4 px-5 py-4">
              <div>
                <Label htmlFor={r.id} className="text-sm font-medium">{r.label}</Label>
                <p className="text-xs text-muted-foreground">{r.desc}</p>
              </div>
              <Switch id={r.id} defaultChecked />
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
