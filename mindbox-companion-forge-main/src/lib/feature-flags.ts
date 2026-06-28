// Feature flags for capabilities that aren't wired up yet. Flip to true once
// the underlying hardware/integration exists.

// There is no real battery telemetry source yet (the device link is still TBD),
// so battery is not surfaced as a meaningful metric anywhere in the UI. The
// simulator can still send a battery value for testing; this flag only controls
// whether the user-facing app treats it as relevant.
export const BATTERY_TRACKING_ENABLED = false;

// Developer-only tooling (e.g. the device Simulator) is kept out of the primary
// navigation for end users. It stays reachable by direct URL; this flag only
// controls whether it appears in the menus. On in dev builds, off in production.
export const SHOW_DEV_TOOLS = import.meta.env.DEV;
