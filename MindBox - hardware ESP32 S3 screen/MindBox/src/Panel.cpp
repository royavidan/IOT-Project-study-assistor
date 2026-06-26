#include "Panel.h"
#include <Arduino.h>
#include "esp_heap_caps.h"

LGFX_Hosyond_S3_28::LGFX_Hosyond_S3_28() {
  { // SPI bus for the panel
    auto cfg = _bus_instance.config();
    cfg.spi_host    = TFT_SPI_HOST;
    cfg.spi_mode    = 0;
    // LovyanGFX defaults freq_write to 16 MHz with no DMA, so a full 320x240x16bpp push takes
    // ~80 ms — that is the input->screen lag (and why fast taps get dropped: touch is only sampled
    // once per slow frame). 40 MHz + DMA cuts the push to ~30 ms. Bump to 80 MHz if the panel stays
    // clean (short traces on this board usually tolerate it).
    cfg.freq_write  = 40000000;
    cfg.freq_read   = 16000000;
    cfg.dma_channel = SPI_DMA_CH_AUTO;   // DMA the sprite push instead of CPU-bound byte-banging
    cfg.pin_sclk = PIN_TFT_SCLK;
    cfg.pin_mosi = PIN_TFT_MOSI;
    cfg.pin_miso = PIN_TFT_MISO;
    cfg.pin_dc   = PIN_TFT_DC;
    _bus_instance.config(cfg);
    _panel_instance.setBus(&_bus_instance);
  }
  { // Panel
    auto cfg = _panel_instance.config();
    cfg.pin_cs       = PIN_TFT_CS;
    cfg.pin_rst      = PIN_TFT_RST;
    cfg.panel_width  = TFT_PANEL_W;
    cfg.panel_height = TFT_PANEL_H;
    cfg.offset_x     = 0;
    cfg.offset_y     = 0;
    _panel_instance.config(cfg);
  }
  { // PWM backlight
    auto cfg = _light_instance.config();
    cfg.pin_bl      = PIN_TFT_BL;
    cfg.freq        = 12000;
    cfg.pwm_channel = 7;
    _light_instance.config(cfg);
    _panel_instance.light(&_light_instance);
  }
  setPanel(&_panel_instance);

  // No LovyanGFX touch here on purpose — the FT6336 is read over Arduino Wire in Touch.cpp (shared single I2C
  // master with the ToF). The TP_RST pulse for the FT6336 still happens in Panel::begin() below.
}

LGFX_Hosyond_S3_28 lcd;
LGFX_Sprite        spr(&lcd);

namespace Panel {

static bool s_useSprite = false;
static bool s_spritePsram = false;   // true = sprite fell back to PSRAM (slow draw)

void begin() {
#if USE_TOUCH
  // Pulse the FT6336 reset (TP_RST) once at boot so the controller is ready before Touch.cpp reads it over
  // Wire. (LovyanGFX no longer drives the touch, so nothing else resets it.)
  pinMode(PIN_TOUCH_RST, OUTPUT);
  digitalWrite(PIN_TOUCH_RST, LOW);  delay(10);
  digitalWrite(PIN_TOUCH_RST, HIGH); delay(120);
#endif
  lcd.init();
  lcd.setRotation(SCR_ROTATION);
  lcd.setColorDepth(16);
  // 8-bit (RGB332) sprite: the UI is near-monochrome (charcoal + white + one red), so 16-bit colour is
  // wasted. 8bpp HALVES the buffer 150KB->75KB, freeing ~75KB of INTERNAL RAM for the Wi-Fi/HTTP stack
  // (which was running the heap out -> OOM panics). LovyanGFX converts RGB332->RGB565 on pushSprite.
  spr.setColorDepth(8);
  // Keep the buffer in INTERNAL RAM, not PSRAM. A PSRAM-backed sprite is ~10x slower to draw into (every
  // pixel a high-latency read-modify-write — the old ~340ms/frame stall); at 75KB it now fits comfortably
  // alongside Wi-Fi. This runs before Cloud::begin() brings up Wi-Fi.
  spr.setPsram(false);
  s_useSprite   = (spr.createSprite(SCR_W, SCR_H) != nullptr);
  s_spritePsram = false;
  if (!s_useSprite && psramFound()) {     // didn't fit in internal RAM -> PSRAM fallback (slower, but works)
    spr.setPsram(true);
    s_useSprite   = (spr.createSprite(SCR_W, SCR_H) != nullptr);
    s_spritePsram = s_useSprite;
  }
  // Heap breadcrumb: confirms the 8-bit buffer landed in internal RAM and how much internal heap is left
  // (was ~62KB with the old 16-bit buffer; should be ~137KB now). 'largest' flags any fragmentation.
  Serial.printf("[panel] sprite %s %s  free internal=%u largest=%u\n",
                s_useSprite ? "8bpp" : "DIRECT",
                s_spritePsram ? "PSRAM" : "INTERNAL",
                (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL),
                (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL));
}

bool usingSprite()   { return s_useSprite; }
bool spriteInPsram() { return s_spritePsram; }

lgfx::LovyanGFX* canvas() {
  return s_useSprite ? (lgfx::LovyanGFX*)&spr : (lgfx::LovyanGFX*)&lcd;
}

void push() { if (s_useSprite) spr.pushSprite(0, 0); }

void setBrightness(uint8_t pct) {
  if (pct > 100) pct = 100;
  lcd.setBrightness((uint8_t)map(pct, 0, 100, 10, 255));   // keep a dim floor, never fully off
}

} // namespace Panel
