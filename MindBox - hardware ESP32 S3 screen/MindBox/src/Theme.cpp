#include "Theme.h"

namespace Theme {

static bool    s_dark = true;
static Palette s_pal  = DARK;

// Accent presets (site downlink themeId 0-4). Preset 0 keeps the ORIGINAL
// constants verbatim (accent/pressed/phase/track/alert values unchanged);
// presets 1-4 derive their track (~22%) / pressed (~70%) variants with rgb24Dim.
// Preset 4's alert leaves the shared amber (its accent IS amber) for a red that
// reads on both dark and light faces.
static const AccentSet ACCENTS[5] = {
  { // 0 — Nothing red (the original scheme, copied verbatim)
    rgb24(0xE5352B), rgb24(0xB02018),                    // accent, pressed
    rgb24(0xE5484D), rgb24(0x2EC4B6), rgb24(0x4C82E8),   // focus, break, long
    rgb24(0x3A2222), rgb24(0x133331), rgb24(0x1A2A45),   // tracks
    rgb24(0xF0A000) },                                   // alert
  { // 1 — Ocean
    rgb24(0x2D9CDB), rgb24Dim(0x2D9CDB, 70),
    rgb24(0x38B6E0), rgb24(0x2EC48A), rgb24(0x7A6FF0),
    rgb24Dim(0x38B6E0, 22), rgb24Dim(0x2EC48A, 22), rgb24Dim(0x7A6FF0, 22),
    rgb24(0xF0A000) },
  { // 2 — Forest
    rgb24(0x3E9B4F), rgb24Dim(0x3E9B4F, 70),
    rgb24(0x4CAF50), rgb24(0xC4A62E), rgb24(0x2E86C4),
    rgb24Dim(0x4CAF50, 22), rgb24Dim(0xC4A62E, 22), rgb24Dim(0x2E86C4, 22),
    rgb24(0xF0A000) },
  { // 3 — Violet
    rgb24(0x8E44AD), rgb24Dim(0x8E44AD, 70),
    rgb24(0xA55EEA), rgb24(0x2EC4B6), rgb24(0xE05585),
    rgb24Dim(0xA55EEA, 22), rgb24Dim(0x2EC4B6, 22), rgb24Dim(0xE05585, 22),
    rgb24(0xF0A000) },
  { // 4 — High contrast (accent is amber, so alert shifts to red)
    rgb24(0xFFB000), rgb24Dim(0xFFB000, 70),
    rgb24(0xFFC400), rgb24(0x00E0FF), rgb24(0xFF5CF0),
    rgb24Dim(0xFFC400, 22), rgb24Dim(0x00E0FF, 22), rgb24Dim(0xFF5CF0, 22),
    rgb24(0xFF3B30) },
};

static uint8_t s_accent = 0;

const Palette& palette() { return s_pal; }
bool isDark()            { return s_dark; }

void setDark(bool dark) {
  s_dark = dark;
  s_pal  = dark ? DARK : LIGHT;
}

void toggle() { setDark(!s_dark); }

const AccentSet& accents() { return ACCENTS[s_accent]; }
uint8_t accentPreset()     { return s_accent; }

void setAccentPreset(uint8_t p) { s_accent = p > 4 ? 4 : p; }

} // namespace Theme
