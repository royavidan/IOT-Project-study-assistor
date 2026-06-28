import { useEffect, useState } from "react";

/**
 * Reactive CSS media query. SSR-safe: returns `false` on the server and the
 * first client render, then updates after mount (so it must only gate things
 * that aren't visible until interaction, e.g. a modal vs a drawer).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
