// A lightweight, device-local default for "who you usually study with", used to
// pre-select new sessions (simulator today; a device-side default later). It's a
// local convenience preference — the authoritative value always lives per-session
// on the row — so it needs no migration or server round-trip.

import { useCallback, useEffect, useState } from "react";

import type { Companions } from "@/lib/types";

const KEY = "mindbox:default-companions";

export function getDefaultCompanions(): Companions {
  if (typeof window === "undefined") return "solo";
  return window.localStorage.getItem(KEY) === "with_others" ? "with_others" : "solo";
}

export function setDefaultCompanions(value: Companions): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, value);
}

/** Read + update the local default. SSR-safe (starts "solo", hydrates on mount). */
export function useDefaultCompanions(): [Companions, (value: Companions) => void] {
  const [value, setValue] = useState<Companions>("solo");
  useEffect(() => setValue(getDefaultCompanions()), []);
  const update = useCallback((next: Companions) => {
    setDefaultCompanions(next);
    setValue(next);
  }, []);
  return [value, update];
}
