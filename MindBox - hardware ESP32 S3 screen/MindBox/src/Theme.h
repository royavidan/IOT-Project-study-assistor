#pragma once
// ============================================================================
// Theme.h — colours & typography for the pomodoro UI.
//
// Visual language: "Nothing" — dark charcoal background, crisp white text, and a
// SINGLE red accent used sparingly (selection dot, live progress). Monospaced
// type + dot-matrix timer live in Fonts.h / DotFont.h. Single source of truth
// for colour; hex values converted to RGB565 for LovyanGFX. The legacy phase /
// tile colour names are kept (so existing call sites compile) but collapsed onto
// the monochrome + red scheme.
// ============================================================================
#include <stdint.h>
#include "types.h"   // Mode + the firmware structs (canonical owner)

// 24-bit 0xRRGGBB -> RGB565.
constexpr uint16_t rgb24(uint32_t c) {
  return (uint16_t)((((c >> 19) & 0x1F) << 11) |
                    (((c >> 10) & 0x3F) << 5)  |
                    (((c >> 3)  & 0x1F)));
}

// The one accent — Nothing's red dot. Everything else is mono (palette below).
constexpr uint16_t C_ACCENT       = rgb24(0xE5352B); // signal red — the single accent
constexpr uint16_t C_CTRL_PRESSED = rgb24(0xB02018); // darker red (pressed)

// Per-phase Pomodoro colours (the Pomofocus convention) — used by the session/timer ring + label so focus
// vs break reads at a glance. Distinct hues (red/teal/blue) stay separable even down-converted to the 8-bit
// (RGB332) sprite. C_ACCENT above stays the lone selection-dot red everywhere ELSE (menus / keyboard).
constexpr uint16_t C_FOCUS        = rgb24(0xE5484D); // focus = red  (vivid on the dark face, not harsh)
constexpr uint16_t C_BREAK        = rgb24(0x2EC4B6); // short break = teal
constexpr uint16_t C_LONG_BREAK   = rgb24(0x4C82E8); // long break = blue
// Legacy tile names retained for compatibility (Nothing menu has no coloured tiles) — collapse to the accent.
constexpr uint16_t C_TILE_GRAY    = C_ACCENT;
constexpr uint16_t C_TILE_GREEN   = C_ACCENT;
constexpr uint16_t C_TILE_ORANGE  = C_ACCENT;

struct Palette {
  uint16_t bg;       // screen background (charcoal / paper)
  uint16_t text;     // primary text (crisp white / charcoal)
  uint16_t muted;    // secondary / stat text, unlit dots
  uint16_t segment;  // tracks / unlit fills
  uint16_t divider;  // grid lines / hairlines
};

constexpr Palette DARK  = { rgb24(0x1A1A1A), rgb24(0xF5F5F5), rgb24(0x707070),
                            rgb24(0x2A2A2A), rgb24(0x3A3A3A) };
constexpr Palette LIGHT = { rgb24(0xF2F2F2), rgb24(0x1A1A1A), rgb24(0x8A8A8A),
                            rgb24(0xE0E0E0), rgb24(0xCFCFCF) };

// Per-phase colour for the session ring/label: focus red, short break teal, long break blue.
inline uint16_t phaseColor(Mode m, bool longBreak) {
  if (m == MODE_WORK) return C_FOCUS;
  return longBreak ? C_LONG_BREAK : C_BREAK;
}

// Ring TRACK — the phase colour heavily darkened, so the FULL ring is always visible under the vivid progress
// arc (Apple's Activity-ring model: a coloured stroke on a DARK face — Apple's HIG requires rings on black,
// never a fully-tinted screen, which fatigues the eye). Only the touch TimerScreen uses these.
constexpr uint16_t C_FOCUS_TRACK = rgb24(0x3A2222); // dark red track
constexpr uint16_t C_BREAK_TRACK = rgb24(0x133331); // dark teal track
constexpr uint16_t C_LONG_TRACK  = rgb24(0x1A2A45); // dark blue track
inline uint16_t phaseTrack(Mode m, bool longBreak) {
  if (m == MODE_WORK) return C_FOCUS_TRACK;
  return longBreak ? C_LONG_TRACK : C_BREAK_TRACK;
}
constexpr uint16_t C_ALERT = rgb24(0xF0A000); // interference warning — warm amber, distinct from any ring hue

inline const char* phaseName(Mode m, bool longBreak) {
  if (m == MODE_WORK) return "focus";
  return longBreak ? "long break" : "break";
}

// Nothing menu has no coloured tiles; any badge glyph is drawn monochrome.
inline uint16_t tileColor(uint8_t icon) { (void)icon; return rgb24(0x707070); }

// Runtime theme state (dark/light) — defined in Theme.cpp.
namespace Theme {
  const Palette& palette();   // the active palette
  bool isDark();
  void setDark(bool dark);
  void toggle();
}
