#include "Sound.h"
#include "config.h"
#include "Audio.h"

static bool    s_enabled = true;
static uint8_t s_chimeMask = 0xFF;   // all kinds audible until the site says otherwise
static bool    s_dnd = false;        // exam mode (site downlink) — mutes all but ring

namespace Sound {

void init() { /* hardware brought up in Audio::begin() */ }

void setEnabled(bool e) { s_enabled = e; }

void setVolume(uint8_t level) { Audio::setVolume(level); }

void setChimeMask(uint8_t mask) { s_chimeMask = mask; }

void setDnd(bool on) { s_dnd = on; }

// Enabled/quiet-hours gate (s_enabled) first, then exam DND, then the mask bit.
static bool gated(uint8_t bit) { return s_enabled && !s_dnd && (s_chimeMask & bit); }

void start()     { if (gated(CHIME_BIT_LIFECYCLE)) Audio::playChime(Audio::CHIME_START); }
void pause()     { if (gated(CHIME_BIT_LIFECYCLE)) Audio::playChime(Audio::CHIME_PAUSE); }
void resume()    { if (gated(CHIME_BIT_LIFECYCLE)) Audio::playChime(Audio::CHIME_RESUME); }
void complete()  { if (gated(CHIME_BIT_COMPLETE))  Audio::playChime(Audio::CHIME_COMPLETE); }
void autoStart() { if (gated(CHIME_BIT_SCHED))     Audio::playChime(Audio::CHIME_SCHED); }
void alert()     { if (gated(CHIME_BIT_ALERT))     Audio::playChime(Audio::CHIME_ALERT); }

// Test sound ignores the enabled flag so the Settings button always proves the
// speaker is wired (mirrors Haptics::testPulse).
void test()     { Audio::playChime(Audio::CHIME_TEST); }

// Find-my ring: bypasses soundEnabled, quiet hours, exam DND AND the chimeMask —
// that is the point of find-my. Audio plays CHIME_RING at max amplitude and the
// configured volume is untouched (nothing to restore afterwards).
void ring()     { Audio::playChime(Audio::CHIME_RING); }

} // namespace Sound
