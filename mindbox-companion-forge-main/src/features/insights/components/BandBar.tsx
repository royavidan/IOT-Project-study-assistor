import { cn } from "@/lib/utils";
import type { Band } from "@/lib/env-quality";

const TONE: Record<Band, { marker: string; text: string; shade: string }> = {
  ideal: { marker: "bg-success", text: "text-success", shade: "bg-success/25" },
  okay: { marker: "bg-warning", text: "text-warning", shade: "bg-warning/25" },
  poor: { marker: "bg-danger", text: "text-danger", shade: "bg-danger/25" },
};

/**
 * A single environment factor shown as a track with the ideal range shaded and a
 * marker at the current value (Awair-style). `position`/`idealStart`/`idealEnd`
 * are 0–1 fractions of the display domain, precomputed by the caller.
 */
export function BandBar({
  label,
  valueText,
  bandLabel,
  band,
  position,
  idealStart,
  idealEnd,
  targetLabel,
  tip,
}: {
  label: string;
  valueText: string;
  bandLabel: string;
  band: Band;
  position: number;
  idealStart: number;
  idealEnd: number;
  targetLabel: string;
  tip: string | null;
}) {
  const tone = TONE[band];
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const left = `${clamp(position) * 100}%`;
  const shadeLeft = `${clamp(idealStart) * 100}%`;
  const shadeWidth = `${clamp(idealEnd - idealStart) * 100}%`;

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm tabular-nums text-muted-foreground">
          {valueText} · <span className={cn("font-medium", tone.text)}>{bandLabel}</span>
        </span>
      </div>
      <div className="relative h-2.5 w-full rounded-full bg-muted">
        {/* ideal target range */}
        <span
          className={cn("absolute inset-y-0 rounded-full", tone.shade)}
          style={{ left: shadeLeft, width: shadeWidth }}
          aria-hidden
        />
        {/* current-value marker */}
        <span
          className={cn(
            "absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background",
            tone.marker,
          )}
          style={{ left }}
          aria-hidden
        />
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 text-xs text-muted-foreground">
        <span>Ideal: {targetLabel}</span>
        {tip && <span className={tone.text}>{tip}</span>}
      </div>
    </div>
  );
}
