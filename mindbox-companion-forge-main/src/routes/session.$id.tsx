import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { ErrorState, LoadingState } from "@/components/EmptyState";
import { DeleteSessionDialog } from "@/features/sessions/components/DeleteSessionDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/InfoHint";
import { useSessionDetail } from "@/features/sessions/session-detail";
import { useAuth } from "@/lib/auth/auth-context";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";

export const Route = createFileRoute("/session/$id")({
  head: () => ({ meta: [{ title: "Session detail — MindBox" }] }),
  component: SessionDetail,
});

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString();
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function fmtEnv(value: number | null, suffix = ""): string {
  return value == null ? "—" : `${value}${suffix}`;
}

function SessionDetail() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const { data, isLoading, isError, error, refetch } = useSessionDetail(id);

  if (isLoading) return <LoadingState label="Loading session…" />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Could not load session"
        description={error instanceof Error ? error.message : undefined}
        onRetry={() => void refetch()}
      />
    );
  }

  const { meta, series } = data;
  const isReviewerView = !!meta.userId && meta.userId !== user?.id;
  const hasSeries = series.length > 0;
  const hasEnv = series.some((p) => p.noise != null || p.tempC != null || p.lightLux != null);

  return (
    <>
      <PageHeader
        title={`${meta.mode} session`}
        description={`${fmtTime(meta.startedAt)} · ${meta.status}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!isReviewerView && <DeleteSessionDialog sessionId={id} />}
            <Button variant="outline" size="sm" asChild>
              <Link to="/progress" search={{ tab: "sessions" }}>
                <ArrowLeft className="h-4 w-4" /> Back to sessions
              </Link>
            </Button>
          </div>
        }
      />

      {isReviewerView && (
        <p className="mb-4 flex items-center gap-2 rounded-lg border border-info/20 bg-info/5 px-4 py-3 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4 shrink-0 text-info" aria-hidden />
          Read-only reviewer view — you cannot edit or delete this session.
        </p>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Focus time" value={`${Math.round(meta.actualFocusSec / 60)} min`} />
        <Stat label="Target" value={`${Math.round(meta.targetDurationSec / 60)} min`} />
        <Stat label="Avg Focus Load Est." value={String(meta.focusLoadAvg)} />
        <Stat label="Breaks" value={String(meta.breaks)} />
        <Stat label="Presence breaks" value={String(meta.presenceInterruptions)} />
        <Stat label="Avg noise" value={fmtEnv(meta.noiseAvg)} />
      </div>

      <Card className="mb-6">
        <CardHeader className="flex-row items-center gap-2">
          <CardTitle className="text-base">Focus Load Estimate over time</CardTitle>
          <InfoHint label="About Focus Load Estimate">
            A transparent 0–100 heuristic from session length, noise, light and presence
            interruptions. Not a validated scientific measurement. Ambient noise (0–1) is overlaid
            to show how the environment tracked your estimated load.
          </InfoHint>
        </CardHeader>
        <CardContent>
          {hasSeries ? (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--color-border)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="tMin"
                    tick={{ fontSize: 11 }}
                    stroke="var(--color-muted-foreground)"
                    unit="m"
                  />
                  <YAxis
                    yAxisId="focus"
                    domain={[0, 100]}
                    tick={{ fontSize: 11 }}
                    stroke="var(--color-muted-foreground)"
                  />
                  <YAxis
                    yAxisId="noise"
                    orientation="right"
                    domain={[0, 1]}
                    tick={{ fontSize: 11 }}
                    stroke="var(--color-muted-foreground)"
                  />
                  <RTooltip
                    contentStyle={{
                      background: "var(--color-popover)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Line
                    yAxisId="focus"
                    type="monotone"
                    dataKey="focus"
                    name="Focus Load Est."
                    stroke="var(--color-sync)"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                  {hasEnv && (
                    <Line
                      yAxisId="noise"
                      type="monotone"
                      dataKey="noise"
                      name="Noise (0–1)"
                      stroke="var(--color-warning)"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      dot={false}
                      connectNulls
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No per-minute samples for this session (manually logged sessions only store averages).
              The summary above still applies.
            </p>
          )}
        </CardContent>
      </Card>

      {hasEnv && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Environment over time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--color-border)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="tMin"
                    tick={{ fontSize: 11 }}
                    stroke="var(--color-muted-foreground)"
                    unit="m"
                  />
                  <YAxis
                    yAxisId="temp"
                    tick={{ fontSize: 11 }}
                    stroke="var(--color-muted-foreground)"
                    unit="°"
                  />
                  <YAxis
                    yAxisId="light"
                    orientation="right"
                    tick={{ fontSize: 11 }}
                    stroke="var(--color-muted-foreground)"
                  />
                  <RTooltip
                    contentStyle={{
                      background: "var(--color-popover)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Line
                    yAxisId="temp"
                    type="monotone"
                    dataKey="tempC"
                    name="Temp (°C)"
                    stroke="var(--color-break)"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                  <Line
                    yAxisId="light"
                    type="monotone"
                    dataKey="lightLux"
                    name="Light (lux)"
                    stroke="var(--color-work)"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Avg temp {fmtEnv(meta.tempC, "°C")} · avg light {fmtEnv(meta.lightLux, " lux")} (Story
              8).
            </p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
