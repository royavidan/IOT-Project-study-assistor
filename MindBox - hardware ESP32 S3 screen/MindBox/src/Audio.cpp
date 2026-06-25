#include "Audio.h"
#include "config.h"

// ============================================================================
// All audio hardware compiles only when the onboard mic and/or speaker are in
// use. With neither flag set, the API below degrades to safe no-ops.
// ============================================================================
#if (HAS_I2S_MIC || HAS_SPEAKER)

#include <math.h>
#include "driver/i2s_std.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"

// ---- I2S channel handles + shared (cross-core) state -----------------------
static i2s_chan_handle_t s_tx = nullptr;   // speaker (DAC)
static i2s_chan_handle_t s_rx = nullptr;   // mic (ADC)
static volatile float    s_micLevel = 0.0f;
static volatile bool     s_micReady = false;
static volatile uint8_t  s_volume   = 1;   // 0=low 1=med 2=high
static QueueHandle_t     s_chimeQ   = nullptr;
// Diagnostics (read by Audio::probe): did the ES8311 ACK at boot, and last raw I2S window stats.
static volatile bool     s_codecAcked = false;
static volatile int      s_rawMin = 0, s_rawMax = 0;
static volatile float    s_rawRms = 0.0f;
static volatile float    s_rawDc  = 0.0f;   // mean (DC bias) of the last mic window

static const int   FRAMES   = 256;         // samples per I2S block (~16 ms @16 kHz)
static const float TWO_PI_F = 6.28318531f;

#if HAS_SPEAKER
  #define AUDIO_DOUT_GPIO ((gpio_num_t)PIN_I2S_DOUT)
#else
  #define AUDIO_DOUT_GPIO I2S_GPIO_UNUSED
#endif
#if HAS_I2S_MIC
  #define AUDIO_DIN_GPIO ((gpio_num_t)PIN_I2S_DIN)
#else
  #define AUDIO_DIN_GPIO I2S_GPIO_UNUSED
#endif

// ============================================================================
// Software-I2C to the ES8311 (boot only). Open-drain on the touch bus pins
// (IO16/IO15), which already carry pull-ups. Done before Display::init() claims
// the bus for LovyanGFX, after which we release the pins and never touch I2C again.
// ============================================================================
static inline void sdaHi() { pinMode(PIN_CODEC_SDA, INPUT_PULLUP); }
static inline void sdaLo() { pinMode(PIN_CODEC_SDA, OUTPUT); digitalWrite(PIN_CODEC_SDA, LOW); }
static inline void sclHi() { pinMode(PIN_CODEC_SCL, INPUT_PULLUP); }
static inline void sclLo() { pinMode(PIN_CODEC_SCL, OUTPUT); digitalWrite(PIN_CODEC_SCL, LOW); }
static inline void i2cDelay() { delayMicroseconds(4); }     // ~125 kHz

static void i2cStart() { sdaHi(); sclHi(); i2cDelay(); sdaLo(); i2cDelay(); sclLo(); i2cDelay(); }
static void i2cStop()  { sdaLo(); sclHi(); i2cDelay(); sdaHi(); i2cDelay(); }

static bool i2cWriteByte(uint8_t b) {
  for (int i = 0; i < 8; i++) {
    if (b & 0x80) sdaHi(); else sdaLo();
    i2cDelay(); sclHi(); i2cDelay(); sclLo(); i2cDelay();
    b <<= 1;
  }
  sdaHi();                                   // release for ACK
  i2cDelay(); sclHi(); i2cDelay();
  bool ack = (digitalRead(PIN_CODEC_SDA) == 0);
  sclLo(); i2cDelay();
  return ack;
}

static bool es8311Write(uint8_t reg, uint8_t val) {
  i2cStart();
  bool ok = i2cWriteByte((ES8311_ADDR << 1) | 0);
  ok &= i2cWriteByte(reg);
  ok &= i2cWriteByte(val);
  i2cStop();
  return ok;
}

// ES8311 mono init for MCLK=256·fs, 16-bit I2S, mic ADC (+ DAC out). Register values
// follow Espressif's esp-bsp es8311_init for analog-mic capture. Verify on hardware via
// Device -> Diagnostics ("8311:ACK rdy:1 pp:" should jump on sound) or serial 'a'; if the
// mic is quiet/loud, adjust ADC gain reg 0x16 (0..3) / digital volume reg 0x17.
static void es8311Init() {
  s_codecAcked = es8311Write(0x00, 0x1F);  // reset all + CSM off; remember if the codec ACKed
  delay(20);
  es8311Write(0x00, 0x00);  // clear reset / enable state machine (esp-bsp reset sequence)
  es8311Write(0x45, 0x00);  // general
  // ⚠ THE mic-silence fix: 0x30 left the ADC clocks OFF (CLKADC_ON bit3 + ANACLKADC_ON bit1
  // clear), so the codec ACKed and I2S streamed frames but the ADC never converted -> flat
  // samples (pp~0). 0x3F = MCLK from pin + ALL clocks on (matches esp-bsp es8311_init).
  es8311Write(0x01, 0x3F);  // clkmgr: MCLK from pin + all clocks on (incl. ADC)
  es8311Write(0x02, 0x00);  // clkmgr: pre_div=1 / pre_multi=1 (256fs coeff row)
  es8311Write(0x03, 0x10);  // ADC FDMODE / OSR
  es8311Write(0x16, 0x02);  // ADC gain scale-up +12dB (bits2:0: 0/6/12/18dB). Dynamic-range balance:
                            // +18dB (0x03) clipped loud sound (>~80dB, samples pinned at ±32767); 0dB
                            // floored quiet rooms (30dB SPL fell below 1 LSB, read ~38). +12dB centers
                            // the window — usable ~35..88dB SPL, the range that matters for focus.
  es8311Write(0x04, 0x10);  // DAC OSR
  es8311Write(0x05, 0x00);  // ADC/DAC clock dividers
  es8311Write(0x06, 0x03);  // SCLK (slave) settings
  es8311Write(0x07, 0x00);
  es8311Write(0x08, 0xFF);
  es8311Write(0x09, 0x0C);  // SDP IN : 16-bit, I2S (Philips)
  es8311Write(0x0A, 0x0C);  // SDP OUT: 16-bit, I2S (Philips)
  es8311Write(0x0B, 0x00);
  es8311Write(0x0C, 0x00);
  es8311Write(0x10, 0x03);  // system: VMID / analog bias
  es8311Write(0x11, 0x7B);  // system: enable analog
  es8311Write(0x00, 0x80);  // CSM: slave mode, power-up state machine
  es8311Write(0x0D, 0x01);  // power up analog
  es8311Write(0x0E, 0x02);  // enable ADC modulator + PGA
  es8311Write(0x0F, 0x44);  // analog
  es8311Write(0x12, 0x00);  // power up DAC
  es8311Write(0x13, 0x10);  // enable DAC output to amp
  es8311Write(0x1B, 0x0A);  // ADC controls
  es8311Write(0x1C, 0x6A);
  es8311Write(0x44, 0x08);  // route ADC (mic) -> I2S SDOUT
  es8311Write(0x14, 0x1A);  // select mic input + PGA gain
  es8311Write(0x37, 0x08);  // ADC ramp
  es8311Write(0x32, 0xBF);  // DAC volume (~0 dB)
  es8311Write(0x17, 0xC8);  // ADC digital volume (esp-bsp level, +headroom; was 0xBF ~0 dB)
  sdaHi(); sclHi();         // release the bus for LovyanGFX touch
}

// ============================================================================
// Chime synthesis — short tone sequences played on the speaker (task-side only)
// ============================================================================
struct Note { uint16_t freq; uint16_t ms; };   // freq 0 = gap (silence)

static const Note CH_START[]    = { {660, 80}, {0, 30}, {990, 150} };
static const Note CH_PAUSE[]    = { {523, 120}, {0, 60}, {392, 150} };
static const Note CH_RESUME[]   = { {784, 90}, {0, 30}, {1047, 140} };
static const Note CH_COMPLETE[] = { {660, 110}, {0, 40}, {880, 110}, {0, 40}, {1175, 220} };
static const Note CH_TEST[]     = { {880, 220} };

static const Note* s_seq   = nullptr;
static int         s_seqLen = 0, s_seqIdx = 0, s_noteLeft = 0;
static float       s_phase  = 0.0f;
static int         s_tail   = 0;            // silent blocks with amp still on (anti-pop)

static int samplesForMs(uint16_t ms) {
  return (int)((uint32_t)ms * AUDIO_SAMPLE_RATE / 1000);
}

static int16_t volAmp() {
  static const int16_t amps[3] = { 2200, 6800, 13000 };
  return amps[s_volume > 2 ? 2 : s_volume];
}

static void startChime(uint8_t kind) {
  switch (kind) {
    case Audio::CHIME_START:    s_seq = CH_START;    s_seqLen = 3; break;
    case Audio::CHIME_PAUSE:    s_seq = CH_PAUSE;    s_seqLen = 3; break;
    case Audio::CHIME_RESUME:   s_seq = CH_RESUME;   s_seqLen = 3; break;
    case Audio::CHIME_COMPLETE: s_seq = CH_COMPLETE; s_seqLen = 5; break;
    case Audio::CHIME_TEST:     s_seq = CH_TEST;     s_seqLen = 1; break;
    default: return;
  }
  s_seqIdx = 0;
  s_noteLeft = samplesForMs(s_seq[0].ms);
  s_phase = 0.0f;
  s_tail = 0;
}

// Fill one TX block; returns true if the amp should be enabled this block.
static bool fillTx(int16_t* buf, int frames) {
  bool active = (s_seq != nullptr);
  int16_t amp = volAmp();
  for (int i = 0; i < frames; i++) {
    int16_t s = 0;
    if (s_seq) {
      const Note& nt = s_seq[s_seqIdx];
      if (nt.freq > 0) {
        s = (int16_t)(amp * sinf(s_phase));
        s_phase += TWO_PI_F * nt.freq / AUDIO_SAMPLE_RATE;
        if (s_phase > TWO_PI_F) s_phase -= TWO_PI_F;
      }
      if (--s_noteLeft <= 0) {
        s_seqIdx++;
        if (s_seqIdx >= s_seqLen) { s_seq = nullptr; s_tail = frames; } // anti-pop tail
        else { s_noteLeft = samplesForMs(s_seq[s_seqIdx].ms); s_phase = 0.0f; }
      }
    } else if (s_tail > 0) {
      s_tail--;                              // emit silence, keep amp on this block
    }
    buf[i] = s;
  }
  return active || (s_tail > 0);
}

// ============================================================================
// Audio task (core 0): drain mic -> RMS, feed speaker -> chimes/silence.
// Blocking I2S calls are safe here — this is not the UI loop / watchdog task.
// ============================================================================
static void audioTask(void*) {
  static int16_t rxbuf[FRAMES];
  static int16_t txbuf[FRAMES];
  double acc = 0, accSum = 0; uint32_t accN = 0;   // Σv² and Σv (Σv removes the DC bias)
  int wmin = 32767, wmax = -32768;

  for (;;) {
#if HAS_I2S_MIC
    size_t got = 0;
    if (s_rx && i2s_channel_read(s_rx, rxbuf, sizeof(rxbuf), &got, pdMS_TO_TICKS(100)) == ESP_OK && got) {
      int n = (int)(got / sizeof(int16_t));
      for (int i = 0; i < n; i++) {
        int v = rxbuf[i];
        if (v < wmin) wmin = v;
        if (v > wmax) wmax = v;
        acc    += (double)v * v;
        accSum += v;
      }
      accN += n;
      if (accN >= (uint32_t)AUDIO_SAMPLE_RATE) {           // ~1 s window
        // Loudness is the AC component only. An I2S mic carries a large constant DC
        // bias, so sqrt(mean(v²)) ≈ |DC| and would sit high in silence and barely
        // move with speech. Subtract the mean (variance = mean(v²) − mean(v)²) so
        // silence → ~0 and the level actually tracks sound.
        double mean   = accSum / accN;
        double var    = acc / accN - mean * mean;
        if (var < 0) var = 0;                              // guard FP rounding near silence
        float rms = sqrtf((float)var);
        float lvl = rms / AUDIO_MIC_RMS_FULL;
        s_micLevel = lvl < 0 ? 0 : (lvl > 1 ? 1 : lvl);
        s_micReady = true;
        s_rawRms = rms; s_rawDc = (float)mean;             // for Audio::probe()
        s_rawMin = wmin; s_rawMax = wmax;
        acc = 0; accSum = 0; accN = 0; wmin = 32767; wmax = -32768;
      }
    }
#endif

    uint8_t kind;
    while (s_chimeQ && xQueueReceive(s_chimeQ, &kind, 0) == pdTRUE) startChime(kind);

#if HAS_SPEAKER
    bool ampOn = fillTx(txbuf, FRAMES);
    digitalWrite(PIN_AMP_EN, ampOn ? LOW : HIGH);          // active-low
    size_t wrote = 0;
    if (s_tx) i2s_channel_write(s_tx, txbuf, sizeof(txbuf), &wrote, pdMS_TO_TICKS(100));
#endif

#if !HAS_I2S_MIC
    vTaskDelay(pdMS_TO_TICKS(2));                           // no mic read to pace the loop
#endif
  }
}

namespace Audio {

void begin() {
#if (HAS_SPEAKER || HAS_I2S_MIC)
  // Hold the FM8002E amp muted (active-low ⇒ HIGH = off). With the mic on we also run the I2S
  // TX channel (for MCLK, see below); muting the amp keeps that idle silence off the speaker.
  pinMode(PIN_AMP_EN, OUTPUT);
  digitalWrite(PIN_AMP_EN, HIGH);
#endif

  // 1) Bring up I2S (master) so MCLK/BCLK/WS run while we configure the codec.
  //    Every step is checked: an I2S failure disables audio but NEVER bricks boot.
  i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
  chan_cfg.auto_clear = true;                              // unfed TX clocks out silence
  // Allocate FULL-DUPLEX (TX + RX) whenever the mic is on. An RX-only std master channel can
  // fail to generate MCLK on IO4, leaving the ES8311 ADC unclocked: it tri-states ASDOUT and
  // DIN floats high, so the mic reads a constant 0xFFFF/-1. A TX handle keeps MCLK/BCLK/WS
  // running so the codec drives real ADC data on DIN.
  esp_err_t err = i2s_new_channel(&chan_cfg,
#if (HAS_SPEAKER || HAS_I2S_MIC)
                  &s_tx,
#else
                  NULL,
#endif
#if HAS_I2S_MIC
                  &s_rx
#else
                  NULL
#endif
  );
  if (err != ESP_OK) {
    Serial.printf("[audio] i2s_new_channel failed (%d) — audio disabled\n", (int)err);
    s_tx = nullptr; s_rx = nullptr;
    return;
  }

  i2s_std_config_t std = {
    .clk_cfg  = I2S_STD_CLK_DEFAULT_CONFIG(AUDIO_SAMPLE_RATE),
    .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO),
    .gpio_cfg = {
      .mclk = (gpio_num_t)PIN_I2S_MCLK,
      .bclk = (gpio_num_t)PIN_I2S_BCLK,
      .ws   = (gpio_num_t)PIN_I2S_LRCK,
      .dout = (gpio_num_t)PIN_I2S_DOUT,   // real DOUT so the TX (MCLK-keeper) channel is well-formed
      .din  = AUDIO_DIN_GPIO,
      .invert_flags = { .mclk_inv = false, .bclk_inv = false, .ws_inv = false },
    },
  };
  bool ok = true;
  if (s_tx && i2s_channel_init_std_mode(s_tx, &std) != ESP_OK) ok = false;
  if (s_rx && i2s_channel_init_std_mode(s_rx, &std) != ESP_OK) ok = false;
  if (ok && s_tx && i2s_channel_enable(s_tx) != ESP_OK) ok = false;
  if (ok && s_rx && i2s_channel_enable(s_rx) != ESP_OK) ok = false;
  if (!ok) {
    Serial.println("[audio] I2S init/enable failed — audio disabled (display unaffected)");
    s_tx = nullptr; s_rx = nullptr;     // audioTask is NOT started -> no null-handle spin
    return;
  }
  delay(10);                            // let clocks settle

  // 2) Configure the ES8311 over soft-I2C (runs before Inputs touch calibration; bus idle).
  es8311Init();
  Serial.println("[audio] ES8311 + I2S up (16k mono full-duplex)");

  // 3) Spawn the core-0 audio task only after I2S is confirmed up.
  s_chimeQ = xQueueCreate(4, sizeof(uint8_t));
  xTaskCreatePinnedToCore(audioTask, "audio", 4096, NULL, 5, NULL, 0);
}

float micLevel() { return s_micLevel; }
bool  micReady() { return s_micReady; }

bool  codecAcked()    { return s_codecAcked; }
int   rawPeakToPeak() { int d = s_rawMax - s_rawMin; return d < 0 ? 0 : d; }
float micRms()        { return s_rawRms; }

void playChime(uint8_t kind) {
#if HAS_SPEAKER
  if (s_chimeQ) xQueueSend(s_chimeQ, &kind, 0);
#else
  (void)kind;
#endif
}

void setVolume(uint8_t level) { s_volume = level > 2 ? 2 : level; }

void probe() {
  Serial.printf("[audio] ES8311 @0x%02X boot-ack=%s | mic raw min/max=%d/%d dc=%.0f ac-rms=%.0f level=%.2f ready=%d vol=%u\n",
                ES8311_ADDR, s_codecAcked ? "YES" : "NO",
                s_rawMin, s_rawMax, (double)s_rawDc, (double)s_rawRms, (double)s_micLevel,
                s_micReady ? 1 : 0, (unsigned)s_volume);
}

} // namespace Audio

#else  // ---- no mic and no speaker: safe stubs --------------------------------

namespace Audio {
  void  begin() {}
  float micLevel() { return 0.0f; }
  bool  micReady() { return false; }
  void  playChime(uint8_t) {}
  void  setVolume(uint8_t) {}
  void  probe() { Serial.println("[audio] disabled"); }
  bool  codecAcked() { return false; }
  int   rawPeakToPeak() { return 0; }
  float micRms() { return 0.0f; }
}

#endif
