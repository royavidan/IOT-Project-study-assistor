#include "LedRing.h"
#include "config.h"

#if HAS_LED_RING
#include <Adafruit_NeoPixel.h>
static Adafruit_NeoPixel ring(LED_COUNT, PIN_LED_RING, NEO_GRB + NEO_KHZ800);
#endif

namespace LedRing {

void init() {
#if HAS_LED_RING
  ring.begin(); ring.setBrightness(60); ring.clear(); ring.show();
#endif
}

void show(SysState st, Mode m, float frac) {
#if HAS_LED_RING
  ring.clear();
  uint32_t col = (st == ST_ERROR) ? ring.Color(150, 0, 0)
               : (m == MODE_WORK) ? ring.Color(0, 120, 40)
                                  : ring.Color(0, 60, 120);
  if (frac < 0) frac = 0; if (frac > 1) frac = 1;
  int lit = (int)(LED_COUNT * frac);
  for (int i = 0; i < lit; i++) ring.setPixelColor(i, col);
  ring.show();
#else
  (void)st; (void)m; (void)frac;   // no-op until HAS_LED_RING
#endif
}

void status(uint8_t r, uint8_t g, uint8_t b) {
#if HAS_LED_RING
  ring.clear();
  for (int i = 0; i < LED_COUNT; i++) ring.setPixelColor(i, ring.Color(r, g, b));
  ring.show();
#else
  (void)r; (void)g; (void)b;
#endif
}

} // namespace LedRing
