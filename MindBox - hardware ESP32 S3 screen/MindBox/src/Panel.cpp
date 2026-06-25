#include "Panel.h"
#include <Arduino.h>

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

#if USE_TOUCH
  { // FT6336 capacitive touch on I2C (LCDWIKI ES3C28P/ES3N28P)
    auto cfg = _touch_instance.config();
    cfg.x_min           = 0;
    cfg.x_max           = SCR_W - 1;
    cfg.y_min           = 0;
    cfg.y_max           = SCR_H - 1;
    cfg.pin_int         = PIN_TOUCH_INT;
    cfg.bus_shared      = false;
    cfg.offset_rotation = TOUCH_OFFSET_ROTATION;
    cfg.i2c_port        = TOUCH_I2C_PORT;
    cfg.i2c_addr        = TOUCH_I2C_ADDR;
    cfg.pin_sda         = PIN_TOUCH_SDA;
    cfg.pin_scl         = PIN_TOUCH_SCL;
    cfg.freq            = TOUCH_FREQ;
    _touch_instance.config(cfg);
    _panel_instance.setTouch(&_touch_instance);
  }
#endif
}

LGFX_Hosyond_S3_28 lcd;
LGFX_Sprite        spr(&lcd);

namespace Panel {

static bool s_useSprite = false;
static bool s_spritePsram = false;   // true = sprite fell back to PSRAM (slow draw)

void begin() {
#if USE_TOUCH
  // FT6336 has no reset field in the LGFX touch config — pulse TP_RST manually
  // before lcd.init() (which initialises the touch controller).
  pinMode(PIN_TOUCH_RST, OUTPUT);
  digitalWrite(PIN_TOUCH_RST, LOW);  delay(10);
  digitalWrite(PIN_TOUCH_RST, HIGH); delay(120);
#endif
  lcd.init();
  lcd.setRotation(SCR_ROTATION);
  lcd.setColorDepth(16);
  spr.setColorDepth(16);
  // Draw into INTERNAL RAM, not PSRAM. Drawing a full frame into a PSRAM-backed sprite is ~10x
  // slower — every glyph/shape pixel is a high-latency PSRAM read-modify-write (that was the
  // ~340ms/frame stall; the DMA push itself was only ~34ms). This runs before Cloud::begin()
  // brings up Wi-Fi, so the ~150KB internal block is usually still free.
  spr.setPsram(false);
  s_useSprite   = (spr.createSprite(SCR_W, SCR_H) != nullptr);
  s_spritePsram = false;
  if (!s_useSprite && psramFound()) {     // didn't fit in internal RAM -> PSRAM fallback (slower, but works)
    spr.setPsram(true);
    s_useSprite   = (spr.createSprite(SCR_W, SCR_H) != nullptr);
    s_spritePsram = s_useSprite;
  }
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
