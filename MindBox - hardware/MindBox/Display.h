#pragma once
// ============================================================================
// Display — OLED abstraction (auto-detects SH1106 or SSD1306) + all screens.
// One Adafruit_GFX* drives either panel, so screen code is driver-agnostic.
// Swap panels by editing Display.cpp only.
// ============================================================================
#include "types.h"

namespace Display {
  bool        init();          // false if no panel found (box runs headless)
  bool        present();
  const char* driverName();    // "SH1106" | "SSD1306" | "none"

  void render(const UiModel& m);   // draw the screen for the current state
  void renderMenu(const MenuView& m);  // pointer menu lists + duration editor

  // low-level primitives (also used by the diagnostics screen)
  void clear();
  void show();
  void text(int x, int y, int size, const char* s);
  void center(const char* s, int y, int size);
  void bar(int x, int y, int w, int h, float frac);
}
