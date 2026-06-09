import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { StateBadge } from "@/components/StateBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/device")({
  head: () => ({ meta: [{ title: "Device Setup — MindBox" }] }),
  component: Device,
});

const steps = [
  { n: 1, title: "Power on", body: "Hold the side button for 3 seconds until the ring pulses." },
  { n: 2, title: "Connect Wi-Fi", body: "Choose your network in the pairing dialog." },
  { n: 3, title: "Pair this app", body: "Enter the 6-digit code shown on the device." },
];

function Device() {
  return (
    <>
      <PageHeader
        title="Device setup"
        description="Pair your MindBox in under a minute."
        actions={<StateBadge state="sync" />}
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <StateBadge state="work" />
          <StateBadge state="break" />
          <StateBadge state="sync" />
          <StateBadge state="warning" />
          <StateBadge state="danger" />
          <StateBadge state="idle" />
        </CardContent>
      </Card>

      <ol className="space-y-3">
        {steps.map((s) => (
          <li key={s.n}>
            <Card>
              <CardContent className="flex items-start gap-4 p-5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sync-muted text-sm font-semibold text-sync">
                  {s.n}
                </span>
                <div className="flex-1">
                  <p className="text-sm font-semibold">{s.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>

      <div className="mt-6 flex justify-end">
        <Button>Begin pairing</Button>
      </div>
    </>
  );
}
