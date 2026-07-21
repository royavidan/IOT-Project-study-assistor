import { useEffect, useMemo, useRef, useState } from "react";

import { isInQuietHours } from "@/lib/quiet-hours";
import { useAuth } from "@/lib/auth/auth-context";
import { filterSessionsByUser } from "@/lib/session-scope";
import { useSettings } from "@/lib/queries/settings";
import { useSessions } from "@/lib/queries/sessions";
import { toDateKey } from "@/lib/streak";

const INACTIVITY_MS = 8 * 60 * 60 * 1000;
const DISMISS_KEY = "mindbox-nudge-dismissed-at";

export interface MotivationNudgeState {
  show: boolean;
  message: string;
  dismiss: () => void;
  requestBrowserNotification: () => Promise<void>;
  browserNotificationsEnabled: boolean;
}

function lastSessionEndMs(
  sessions: { date: string; start: string; durationMin: number; endedAt?: string }[],
): number | null {
  let latest: number | null = null;
  for (const s of sessions) {
    let endMs: number;
    if (s.endedAt) {
      endMs = new Date(s.endedAt).getTime();
    } else {
      const [hh, mm] = s.start.split(":").map((x) => Number.parseInt(x, 10));
      const d = new Date(s.date + "T00:00:00");
      d.setHours(hh || 0, mm || 0, 0, 0);
      endMs = d.getTime() + s.durationMin * 60 * 1000;
    }
    if (latest == null || endMs > latest) latest = endMs;
  }
  return latest;
}

export function useMotivationNudge(): MotivationNudgeState {
  const { user } = useAuth();
  const { data: settings } = useSettings();
  const sessionsQuery = useSessions();
  const [dismissedAt, setDismissedAt] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    return Number.parseInt(localStorage.getItem(DISMISS_KEY) ?? "0", 10) || 0;
  });
  const notifiedRef = useRef(false);

  const nudge = useMemo(() => {
    if (!settings?.notificationsEnabled) return null;
    if (isInQuietHours(new Date(), settings.quietHoursStart, settings.quietHoursEnd)) {
      return null;
    }

    const sessions = filterSessionsByUser(sessionsQuery.data ?? [], user?.id, user?.id);
    const now = new Date();
    const today = toDateKey(now);
    const hasSessionToday = sessions.some((s) => s.date === today);
    if (hasSessionToday) return null;

    const lastEnd = lastSessionEndMs(sessions);
    if (lastEnd == null) {
      return "Start a short focus block today to build your routine.";
    }

    if (Date.now() - lastEnd < INACTIVITY_MS) return null;

    const hours = Math.round((Date.now() - lastEnd) / (60 * 60 * 1000));
    return `It's been about ${hours} hours since your last session. A quick focus block keeps your momentum going.`;
  }, [settings, sessionsQuery.data, user?.id]);

  const show = !!nudge && Date.now() - dismissedAt > INACTIVITY_MS / 2;

  useEffect(() => {
    if (!show || !nudge || notifiedRef.current) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    notifiedRef.current = true;
    try {
      new Notification("MindBox — gentle nudge", { body: nudge, tag: "mindbox-nudge" });
    } catch {
      // ignore — some browsers block without user gesture
    }
  }, [show, nudge]);

  const dismiss = () => {
    const ts = Date.now();
    setDismissedAt(ts);
    localStorage.setItem(DISMISS_KEY, String(ts));
  };

  const requestBrowserNotification = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "granted") return;
    await Notification.requestPermission();
  };

  return {
    show,
    message: nudge ?? "",
    dismiss,
    requestBrowserNotification,
    browserNotificationsEnabled:
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "granted",
  };
}
