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

// Study Planner — auto-scheduled study blocks. Controls whether the "Auto-plan
// study time" entry points appear (in the calendar header + FAB). Flip to true
// to launch; the underlying feature is fully built.
export const STUDY_PLANNER_ENABLED = true;

// LLM Study Planner — the Gemini-backed "Smart (AI)" engine inside the plan
// sheet. Requires GEMINI_API_KEY on the server. Kill switch: flipping this off
// hides the AI option and every plan falls back to the heuristic engine.
export const LLM_PLANNER_ENABLED = true;
