#include "Sound.h"
#include "config.h"
#include "Audio.h"

static bool s_enabled = true;

namespace Sound {

void init() { /* hardware brought up in Audio::begin() */ }

void setEnabled(bool e) { s_enabled = e; }

void setVolume(uint8_t level) { Audio::setVolume(level); }

void start()    { if (s_enabled) Audio::playChime(Audio::CHIME_START); }
void pause()    { if (s_enabled) Audio::playChime(Audio::CHIME_PAUSE); }
void resume()   { if (s_enabled) Audio::playChime(Audio::CHIME_RESUME); }
void complete() { if (s_enabled) Audio::playChime(Audio::CHIME_COMPLETE); }

// Test sound ignores the enabled flag so the Settings button always proves the
// speaker is wired (mirrors Haptics::testPulse).
void test()     { Audio::playChime(Audio::CHIME_TEST); }

} // namespace Sound
