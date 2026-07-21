// Device accent-theme presets — the SITE-SIDE MIRROR of the firmware table
// `ACCENTS[]` in `MindBox - hardware ESP32 S3 screen/MindBox/src/Theme.cpp`.
// Only the preset ID travels on the wire (downlink `themeId`); the box owns
// the actual RGB565 values and derives pressed/track variants itself. Keep the
// two tables in sync BY ID — the hex values here exist for the settings-page
// swatches and for documentation.

export interface DeviceThemePreset {
  id: number;
  name: string;
  /** Idle-screen + controls accent. */
  accent: string;
  /** Focus / break / long-break phase hues (timer ring + labels). */
  focus: string;
  break: string;
  longBreak: string;
}

export const DEVICE_THEME_PRESETS: readonly DeviceThemePreset[] = [
  // id 0 = the firmware's original compile-time colors (default).
  {
    id: 0,
    name: "Signal Red",
    accent: "#E5352B",
    focus: "#E5484D",
    break: "#2EC4B6",
    longBreak: "#4C82E8",
  },
  {
    id: 1,
    name: "Ocean",
    accent: "#2D9CDB",
    focus: "#38B6E0",
    break: "#2EC48A",
    longBreak: "#7A6FF0",
  },
  {
    id: 2,
    name: "Forest",
    accent: "#3E9B4F",
    focus: "#4CAF50",
    break: "#C4A62E",
    longBreak: "#2E86C4",
  },
  {
    id: 3,
    name: "Violet",
    accent: "#8E44AD",
    focus: "#A55EEA",
    break: "#2EC4B6",
    longBreak: "#E05585",
  },
  {
    id: 4,
    name: "High contrast",
    accent: "#FFB000",
    focus: "#FFC400",
    break: "#00E0FF",
    longBreak: "#FF5CF0",
  },
];

export const DEVICE_THEME_MAX_ID = DEVICE_THEME_PRESETS.length - 1;

/** Clamp anything from the DB to a valid preset id (default 0). */
export function clampThemeId(value: unknown): number {
  const n = typeof value === "number" ? Math.round(value) : Number.NaN;
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(DEVICE_THEME_MAX_ID, n));
}
