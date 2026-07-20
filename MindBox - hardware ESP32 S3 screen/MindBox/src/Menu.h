#pragma once
// ============================================================================
// Menu — pointer menus: rotate = cursor, side short = select, side long = back.
// Owns all pre-session navigation and the RUNNING overlay (Pause / End).
// ============================================================================
#include "types.h"

namespace Menu {
  void begin(Mode* mode, int* workMin, int* breakMin, int* cycleCount, DeviceConfig* cfg);
  void setContext(bool wifi, bool paired, const char* deviceId);
  void invalidate();
  void setLiveFocusSec(uint32_t sec);
  void setExamInfo(int16_t days, const char* title);   // root "EXAM Nd" badge; days < 0 clears
  void setCloudStats(int16_t streakDays, int32_t weekMin); // STATS rows; -1 = unknown ("--")

  int activeDurationMin();

  void resetToRoot();

  MenuAction tick(int rotDir, int sideBtn);
  const MenuView& view();
  bool            dirty();
  void            clearDirty();

  void pausedReset(PauseReason reason);
  MenuAction pausedTick(int rotDir, int sideBtn);
  const MenuView& pausedView();

  void runningOpen();
  void runningDismiss();
  bool runningActive();
  MenuAction runningTick(int rotDir, int sideBtn);
  const MenuView& runningView();

  void resumePromptReset(int remainMin, Mode m, int focusDone, int cycleTotal, bool setActive);
  MenuAction resumePromptTick(int rotDir, int sideBtn);
  const MenuView& resumePromptView();

  void cycleOfferReset(Mode nextMode, int nextMin, int focusDone, int cycleTotal);
  MenuAction cycleOfferTick(int rotDir, int sideBtn);
  const MenuView& cycleOfferView();
}
