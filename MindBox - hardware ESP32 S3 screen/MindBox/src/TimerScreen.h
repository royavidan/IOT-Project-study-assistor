#pragma once
// ============================================================================
// TimerScreen — the RUNNING-state renderer (Tomato32 styling), model-driven.
//   USE_TOUCH 1 : two-panel layout (timer+dots | label+buttons)
//   USE_TOUCH 0 : centred numerals inside a progress ring
// Everything is derived from the UiModel; no session state of its own.
// ============================================================================
#include "config.h"
#include "types.h"

namespace TimerScreen {

// Touch control hit-test result (touch build only).
enum TimerAction { TA_NONE = -1, TA_RESET = 0, TA_PAUSE = 1, TA_SKIP = 2, TA_MENU = 3 };

void render(const UiModel& m);

#if USE_TOUCH
int hitTest(int x, int y);   // a TimerAction, or TA_NONE
#endif

} // namespace TimerScreen
