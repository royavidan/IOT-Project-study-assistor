#pragma once
// ============================================================================
// Theme.h — colours & typography for the pomodoro UI.
//
// Visual language: "Nothing" — dark charcoal background, crisp white text, and a
// SINGLE red accent used sparingly (selection dot, live progress). Monospaced
// type + dot-matrix timer live in Fonts.h / DotFont.h. Single source of truth
// for colour; hex values converted to RGB565 for LovyanGFX. The legacy phase /
// tile colour names are kept (so existing call sites compile) but collapsed onto
// the monochrome + accent scheme.
//
// The accent family is now RUNTIME-SELECTABLE: the site downlinks themeId 0-4
// and the C_* names below are macros over the active AccentSet, so no call site
// in Display/TimerScreen/Keyboard needed edits. Preset 0 is the original
// Nothing-red palette, byte-for-byte.
// ============================================================================
#include <stdint.h>
#include "types.h"   // Mode + the firmware structs (canonical owner)

// 24-bit 0xRRGGBB -> RGB565.
constexpr uint16_t rgb24(uint32_t c) {
  return (uint16_t)((((c >> 19) & 0x1F) << 11) |
                    (((c >> 10) & 0x3F) << 5)  |
                    (((c >> 3)  & 0x1F)));
}

// Dim a 24-bit colour toward black by pct/100 (per-channel scale), then convert.
// Used to derive the ring TRACK (~22% — always visible under the vivid arc) and
// the pressed-control variant (~70%) for the non-default accent presets.
constexpr uint16_t rgb24Dim(uint32_t c, uint32_t pct) {
  return rgb24(((((c >> 16) & 0xFF) * pct / 100) << 16) |
               ((((c >> 8)  & 0xFF) * pct / 100) << 8)  |
               (((c        & 0xFF) * pct / 100)));
}

// One selectable accent family (site downlink themeId 0-4). "brk" not "break"
// (reserved word). Tracks are the dimmed phase colours (Apple Activity-ring
// model: a coloured stroke on a dark face — see phaseTrack below).
struct AccentSet {
  uint16_t accent;       // selection dot / highlights
  uint16_t ctrlPressed;  // pressed-control variant of the accent
  uint16_t focus;        // focus interval ring
  uint16_t brk;          // short-break ring
  uint16_t longBreak;    // long-break ring
  uint16_t focusTrack;   // heavily-dimmed ring tracks
  uint16_t breakTrack;
  uint16_t longTrack;
  uint16_t alert;        // interference warning — distinct from any ring hue
};

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

// Runtime theme state (dark/light palette + accent preset) — Theme.cpp.
namespace Theme {
  const Palette& palette();          // the active palette
  bool isDark();
  void setDark(bool dark);
  void toggle();

  const AccentSet& accents();        // the active accent family
  uint8_t accentPreset();            // 0..4 (0 = original Nothing red)
  void setAccentPreset(uint8_t p);   // clamped to 0..4; RAM only (caller persists)
}

// Legacy colour names — now macros over the active AccentSet so every existing
// call site follows the selected preset with zero edits.
#define C_ACCENT       (Theme::accents().accent)
#define C_CTRL_PRESSED (Theme::accents().ctrlPressed)
#define C_FOCUS        (Theme::accents().focus)
#define C_BREAK        (Theme::accents().brk)
#define C_LONG_BREAK   (Theme::accents().longBreak)
#define C_FOCUS_TRACK  (Theme::accents().focusTrack)
#define C_BREAK_TRACK  (Theme::accents().breakTrack)
#define C_LONG_TRACK   (Theme::accents().longTrack)
#define C_ALERT        (Theme::accents().alert)
// Legacy tile names retained for compatibility (Nothing menu has no coloured tiles) — collapse to the accent.
#define C_TILE_GRAY    C_ACCENT
#define C_TILE_GREEN   C_ACCENT
#define C_TILE_ORANGE  C_ACCENT

// Per-phase colour for the session ring/label: focus / short break / long break.
inline uint16_t phaseColor(Mode m, bool longBreak) {
  if (m == MODE_WORK) return C_FOCUS;
  return longBreak ? C_LONG_BREAK : C_BREAK;
}

// Ring TRACK — the phase colour heavily darkened, so the FULL ring is always visible under the vivid progress
// arc (Apple's Activity-ring model: a coloured stroke on a DARK face — Apple's HIG requires rings on black,
// never a fully-tinted screen, which fatigues the eye). Only the touch TimerScreen uses these.
inline uint16_t phaseTrack(Mode m, bool longBreak) {
  if (m == MODE_WORK) return C_FOCUS_TRACK;
  return longBreak ? C_LONG_TRACK : C_BREAK_TRACK;
}

inline const char* phaseName(Mode m, bool longBreak) {
  if (m == MODE_WORK) return "focus";
  return longBreak ? "long break" : "break";
}

// Nothing menu has no coloured tiles; any badge glyph is drawn monochrome.
inline uint16_t tileColor(uint8_t icon) { (void)icon; return rgb24(0x707070); }
