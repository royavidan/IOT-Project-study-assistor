#pragma once
// ============================================================================
// Display — the screen API the firmware draws through, on the S3 ILI9341 TFT
// (LovyanGFX). Same surface as the sibling's OLED Display so StateMachine /
// Menu / Diagnostics port unchanged. The low-level primitives interpret the
// old 128x64 OLED coordinate space and scale it onto the TFT, so the inline
// diagnostic / Wi-Fi setup screens render without edits. Native, styled
// renderers handle the menu (renderMenu) and the RUNNING timer (render).
// Device + sprite live in Panel.*.
// ============================================================================
#include "types.h"

namespace Display {
  bool        init();          // brings up the panel; always true on the TFT
  bool        present();
  const char* driverName();    // "ILI9341"

  void render(const UiModel& m);       // per-state screens (RUNNING -> TimerScreen)
  void renderMenu(const MenuView& m);  // native styled list + duration editor

  // Agenda day page (ST_AGENDA pager). nowMin = owner-local minutes-of-day for
  // the now/next highlight (day 0 only), or -1. dayIdx 0 = today, 1..6 = a
  // paged week day; header = "TODAY" or "Sun 20/7"; hasPrev/hasNext draw the
  // ‹/› swipe affordances. Read-only; back exits.
  void renderAgenda(const AgendaItem* items, uint8_t count, int nowMin,
                    uint8_t dayIdx, const char* header, bool hasPrev, bool hasNext);
  // Scheduled-start splash (ST_AUTOSTART): title + countdown + "tap to cancel".
  void renderAutoStart(const char* title, int secsLeft);
  // Remote message / ring splash (ST_MESSAGE): big title, wrapped body,
  // "tap to dismiss" + auto-dismiss countdown. Modeled on renderAutoStart.
  void renderMessage(const char* title, const char* body, int secsLeft);
  // Post-focus homework quick-update (ST_HOMEWORK): up to HW_MAX_ITEMS rows
  // (title + progress bar + pct) and a Skip row; sel == count highlights Skip.
  void renderHomework(const HwItem* items, uint8_t count, uint8_t sel);

  // low-level primitives (OLED-coordinate space, scaled to the TFT)
  void clear();
  void show();
  void text(int x, int y, int size, const char* s);
  void center(const char* s, int y, int size);
  void bar(int x, int y, int w, int h, float frac);

  // Touch helpers (valid after the most recent renderMenu()):
  int  rowHitTest(int x, int y);  // visible row index under a point, or -1
  int  selectedRow();             // visible index of the cursor row, or -1
  bool backHit(int x, int y);     // true if the point is on the Back button
}
