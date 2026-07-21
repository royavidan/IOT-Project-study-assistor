#pragma once
// ============================================================================
// DotFont.h — "Nothing"-style dot-matrix numerals for the timer. Each glyph is
// a 5x7 grid; lit cells draw a filled dot in `on`, unlit cells optionally draw a
// faint dot in `off` (set off==on to skip them) for the LED look. No font file.
// Only the characters the timer needs: 0-9 and ':'.
// ============================================================================
#ifndef LGFX_USE_V1
#define LGFX_USE_V1
#endif
#include <LovyanGFX.hpp>

namespace DotFont {

// 7 rows per glyph, low 5 bits = columns (bit4 = leftmost).
struct Glyph { uint8_t rows[7]; };

inline const Glyph* glyph(char c) {
  static const Glyph G[11] = {
    {{0b01110,0b10001,0b10011,0b10101,0b11001,0b10001,0b01110}}, // 0
    {{0b00100,0b01100,0b00100,0b00100,0b00100,0b00100,0b01110}}, // 1
    {{0b01110,0b10001,0b00001,0b00010,0b00100,0b01000,0b11111}}, // 2
    {{0b11111,0b00010,0b00100,0b00010,0b00001,0b10001,0b01110}}, // 3
    {{0b00010,0b00110,0b01010,0b10010,0b11111,0b00010,0b00010}}, // 4
    {{0b11111,0b10000,0b11110,0b00001,0b00001,0b10001,0b01110}}, // 5
    {{0b00110,0b01000,0b10000,0b11110,0b10001,0b10001,0b01110}}, // 6
    {{0b11111,0b00001,0b00010,0b00100,0b01000,0b01000,0b01000}}, // 7
    {{0b01110,0b10001,0b10001,0b01110,0b10001,0b10001,0b01110}}, // 8
    {{0b01110,0b10001,0b10001,0b01111,0b00001,0b00010,0b01100}}, // 9
    {{0b00000,0b00100,0b00100,0b00000,0b00100,0b00100,0b00000}}, // :
  };
  if (c >= '0' && c <= '9') return &G[c - '0'];
  if (c == ':')             return &G[10];
  return nullptr;   // spaces / unknown -> advance only
}

// Total pixel width of a dot string at the given pitch (cols spaced by pitch).
inline int width(const char* s, int pitch) {
  int n = 0; for (const char* p = s; *p; ++p) n++;
  if (n <= 0) return 0;
  return (n - 1) * 6 * pitch + 4 * pitch;   // 5 cols + 1 gap advance per glyph
}

// Draw a dot string centred on (cx, cy). dotR = dot radius, pitch = cell spacing.
inline void drawCentered(lgfx::LovyanGFX* g, const char* s, int cx, int cy,
                         int dotR, int pitch, uint16_t on, uint16_t off) {
  int x0 = cx - width(s, pitch) / 2;
  int y0 = cy - (6 * pitch) / 2;
  int gx = x0;
  for (const char* p = s; *p; ++p) {
    const Glyph* gl = glyph(*p);
    if (gl) {
      for (int r = 0; r < 7; r++)
        for (int c = 0; c < 5; c++) {
          bool lit = gl->rows[r] & (1 << (4 - c));
          if (lit)            g->fillCircle(gx + c * pitch, y0 + r * pitch, dotR, on);
          else if (off != on) g->fillCircle(gx + c * pitch, y0 + r * pitch, dotR, off);
        }
    }
    gx += 6 * pitch;
  }
}

} // namespace DotFont
