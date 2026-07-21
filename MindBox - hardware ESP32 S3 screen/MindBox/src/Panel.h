#pragma once
// ============================================================================
// Panel (HAL) — the LovyanGFX device for the LCDWIKI ES3C28P/ES3N28P board:
// ILI9341 SPI panel + PWM backlight + (USE_TOUCH) FT6336 capacitive touch on I2C.
// Owns the panel instance `lcd` and the off-screen `spr` used for flicker-free
// frames. Pins come from config.h — never hard-code them here.
// ============================================================================
#ifndef LGFX_USE_V1
#define LGFX_USE_V1            // must be set in every TU before LovyanGFX is included
#endif
#include <LovyanGFX.hpp>
#include "config.h"

class LGFX_Hosyond_S3_28 : public lgfx::LGFX_Device {
  lgfx::Panel_ILI9341 _panel_instance;
  lgfx::Bus_SPI       _bus_instance;
  lgfx::Light_PWM     _light_instance;
  // NB: no LovyanGFX touch instance. The FT6336 is read directly over Arduino Wire in Touch.cpp so it shares
  // ONE I2C master with the VL53L1X ToF (no two-master pad contention). LovyanGFX must NOT also drive touch
  // on a second I2C port, or the pins fight — see Touch.cpp / Sensors.cpp.
public:
  LGFX_Hosyond_S3_28();
};

extern LGFX_Hosyond_S3_28 lcd;
extern LGFX_Sprite        spr;

namespace Panel {
  void begin();                  // init panel, rotation, allocate sprite
  bool usingSprite();
  lgfx::LovyanGFX* canvas();     // draw target: &spr if available, else &lcd
  void push();                   // present the sprite (no-op if drawing direct)
  bool spriteInPsram();          // true = sprite fell back to PSRAM (slower per-pixel draw)
  void setBrightness(uint8_t pct); // backlight 0..100% (PWM via Light_PWM)
}
