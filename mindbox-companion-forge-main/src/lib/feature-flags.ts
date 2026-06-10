// Feature flags for capabilities that aren't wired up yet. Flip to true once
// the underlying hardware/integration exists.

// There is no real battery telemetry source yet (the device link is still TBD),
// so battery is not surfaced as a meaningful metric anywhere in the UI. The
// simulator can still send a battery value for testing; this flag only controls
// whether the user-facing app treats it as relevant.
export const BATTERY_TRACKING_ENABLED = false;
