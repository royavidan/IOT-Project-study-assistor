#include "Theme.h"

namespace Theme {

static bool    s_dark = true;
static Palette s_pal  = DARK;

const Palette& palette() { return s_pal; }
bool isDark()            { return s_dark; }

void setDark(bool dark) {
  s_dark = dark;
  s_pal  = dark ? DARK : LIGHT;
}

void toggle() { setDark(!s_dark); }

} // namespace Theme
