import { useEffect } from "react";

import { useSettings } from "@/lib/queries/settings";

/** Applies the `reduce-motion` class to <html> when the user prefers calmer UI. */
export function ReduceMotionRoot() {
  const { data: settings } = useSettings();

  useEffect(() => {
    const root = document.documentElement;
    if (settings?.reduceMotion) root.classList.add("reduce-motion");
    else root.classList.remove("reduce-motion");
    return () => root.classList.remove("reduce-motion");
  }, [settings?.reduceMotion]);

  return null;
}
