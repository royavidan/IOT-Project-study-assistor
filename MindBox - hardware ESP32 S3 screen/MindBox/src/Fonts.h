#pragma once
// ============================================================================
// Fonts.h — single place that chooses the UI typeface. The whole firmware draws
// through the FONT_* aliases, so swapping families is a one-file change.
//
// "Nothing" wants a clean monospaced face. We default to LovyanGFX's bundled
// FreeMono (zero extra files, ships immediately). To use the exact JetBrains
// Mono: generate Adafruit-GFX headers (fontconvert) into src/fonts/, include
// them below, and point the FONT_* aliases at them — nothing else changes.
//   #include "fonts/JetBrainsMono_9pt7b.h"   etc.
//   #define FONT_M (&JetBrainsMono_12pt7b)
//
// The timer numerals are NOT a font — they're drawn as a dot-matrix in
// DotFont.h (Nothing's dot-matrix timer).
// ============================================================================
#ifndef LGFX_USE_V1
#define LGFX_USE_V1
#endif
#include <LovyanGFX.hpp>

#define USE_JETBRAINS_MONO 0   // flip to 1 once src/fonts/JetBrainsMono_*pt7b.h exist

#if USE_JETBRAINS_MONO
#include "fonts/JetBrainsMono_9pt7b.h"
#include "fonts/JetBrainsMono_12pt7b.h"
#include "fonts/JetBrainsMono_18pt7b.h"
#include "fonts/JetBrainsMono_24pt7b.h"
#define FONT_S  (&JetBrainsMono_9pt7b)
#define FONT_M  (&JetBrainsMono_12pt7b)
#define FONT_L  (&JetBrainsMono_18pt7b)
#define FONT_XL (&JetBrainsMono_24pt7b)
#else
#define FONT_S  (&fonts::FreeMono9pt7b)
#define FONT_M  (&fonts::FreeMono12pt7b)
#define FONT_L  (&fonts::FreeMono18pt7b)
#define FONT_XL (&fonts::FreeMonoBold24pt7b)
#endif
