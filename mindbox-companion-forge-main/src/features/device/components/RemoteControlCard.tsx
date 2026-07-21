// Remote control for a paired MindBox: start/end a session, ring it, or send
// a short message to its screen. Commands ride the 60s config poll (one per
// poll, acked on the next), so the card is honest about latency and shows the
// Queued -> Sent -> Done lifecycle live (5s refetch).

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BellRing, Play, Send, Square } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSettings } from "@/lib/queries/settings";
import { sendDeviceCommand } from "../commands.functions";
import { DEVICE_COMMAND_TEXT_MAX_BYTES, sanitizeCommandText } from "../command-encode";
import { sanitizeDeviceString } from "../device-string";
import { useRecentDeviceCommands, type DeviceCommandPhase } from "../queries";

const DURATIONS = [15, 25, 45, 60] as const;

const PHASE_META: Record<DeviceCommandPhase, { label: string; className: string }> = {
  queued: { label: "Queued", className: "bg-muted text-muted-foreground" },
  sent: { label: "Sent to device", className: "bg-sync-muted text-sync" },
  done: { label: "Done", className: "bg-success/10 text-success" },
  expired: { label: "Expired", className: "bg-danger/10 text-danger" },
};

function commandLabel(type: string, arg: number | null, text: string | null): string {
  if (type === "start") return arg && arg > 0 ? `Start ${arg}m block` : "Start session";
  if (type === "end") return "End session";
  if (type === "ring") return "Ring device";
  if (type === "message") return `Message: “${text ?? ""}”`;
  return type;
}

export function RemoteControlCard({ deviceId }: { deviceId: string }) {
  const queryClient = useQueryClient();
  const { data: recent } = useRecentDeviceCommands(deviceId);
  const { data: settings } = useSettings();
  const [duration, setDuration] = useState<number>(25);
  const [messageText, setMessageText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: (input: {
      type: "start" | "end" | "ring" | "message";
      durationMin?: number;
      text?: string;
    }) => sendDeviceCommand({ data: { deviceId, ...input } }),
    onSuccess: (_res, input) => {
      setError(null);
      if (input.type === "message") setMessageText("");
      void queryClient.invalidateQueries({ queryKey: ["device-commands", deviceId] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Could not queue the command.");
    },
  });

  // Live byte budget so the user sees what actually fits the device screen.
  // rawBytes counts BEFORE truncation, so overflow is visible instead of the
  // counter pinning at the cap while the tail is silently cut.
  const sanitized = sanitizeCommandText(messageText);
  const rawBytes = new TextEncoder().encode(sanitizeDeviceString(messageText)).length;
  const overBudget = rawBytes > DEVICE_COMMAND_TEXT_MAX_BYTES;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">Remote control</CardTitle>
        <CardDescription>
          Your MindBox checks in about once a minute — commands can take up to 60 seconds to arrive.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label>Start a focus session</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={send.isPending}
              onClick={() => send.mutate({ type: "start" })}
            >
              <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Start session
            </Button>
            <span className="text-xs text-muted-foreground">
              {settings
                ? `${settings.deviceCycles} × ${settings.deviceFocusMin}m focus · ${settings.deviceBreakMin}m break · ${settings.deviceLongBreakMin}m long break`
                : "your configured rhythm"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-muted-foreground">Or a quick block:</span>
            <ToggleGroup
              type="single"
              value={String(duration)}
              onValueChange={(v) => v && setDuration(Number(v))}
              variant="outline"
              className="grid grid-cols-4"
            >
              {DURATIONS.map((d) => (
                <ToggleGroupItem key={d} value={String(d)} className="min-h-9 px-3 text-xs">
                  {d}m
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Button
              size="sm"
              variant="secondary"
              disabled={send.isPending}
              onClick={() => send.mutate({ type: "start", durationMin: duration })}
            >
              Start block
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Set the rhythm in Settings → MindBox device. Ignored if a session is already running.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={send.isPending}
            onClick={() => send.mutate({ type: "end" })}
          >
            <Square className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            End session
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={send.isPending}
            onClick={() => send.mutate({ type: "ring" })}
          >
            <BellRing className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Ring my device
          </Button>
        </div>

        <form
          className="space-y-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (sanitized) send.mutate({ type: "message", text: messageText.trim() });
          }}
        >
          <Label htmlFor="device-message">Send a message to the screen</Label>
          <div className="flex gap-2">
            <Input
              id="device-message"
              value={messageText}
              maxLength={80}
              placeholder="Dinner at 7!"
              onChange={(e) => setMessageText(e.target.value)}
            />
            <Button type="submit" size="sm" disabled={send.isPending || !sanitized}>
              <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Send
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {rawBytes}/{DEVICE_COMMAND_TEXT_MAX_BYTES}
            {overBudget ? " — too long, the end will be trimmed" : ""} — the box shows it with a
            chime (respects quiet hours and exam mode).
          </p>
        </form>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        {recent && recent.length > 0 && (
          <div className="space-y-1.5 border-t border-border pt-3">
            <p className="text-xs font-medium text-muted-foreground">Recent commands</p>
            <ul className="space-y-1">
              {recent.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{commandLabel(c.type, c.arg, c.text)}</span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${PHASE_META[c.phase].className}`}
                  >
                    {PHASE_META[c.phase].label}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
