# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# MindBox — ESP32-S3 screen variant (wrapper → firmware)

This folder is a thin wrapper. The actual project — an **ESP32-S3 port of the MindBox study-box
firmware** (LCDWIKI ES3C28P/ES3N28P 2.8" board: ILI9341 TFT via LovyanGFX, FT6336 capacitive touch +
VL53L1X ToF on one I2C bus, ES8311 I2S audio) — lives in **[`MindBox/`](MindBox/)**, an Arduino sketch
with a flat `src/`.

## Open the sketch folder, read its map first
- **Authoritative subsystem map:** [`MindBox/CLAUDE.md`](MindBox/CLAUDE.md) — which file to open for a
  given task, the input model (encoder + side button + touch), the verified board pin map, build/flash
  settings, required libraries, the dual-core threading model, the audio subsystem, and the recurring
  brownout failure mode. **Read it before substantive work** — don't relearn the pin map or the
  single-I2C-master constraint from the source.
- **Single source of truth for pins/flags/tunables:** [`MindBox/src/config.h`](MindBox/src/config.h).
  The `HAS_*` / `USE_*` / `ENABLE_*` flags decide what is live; check them before assuming a peripheral
  is present. (A few inline comments in `config.h` have drifted — e.g. `TOUCH_I2C_PORT`, encoder `SW` —
  where they disagree with `MindBox/CLAUDE.md`, the CLAUDE map is the more current.)
- **Hardware/wiring:** [`MindBox/docs/WIRING.md`](MindBox/docs/WIRING.md) is the S3-accurate per-part
  wiring; [`MindBox/docs/HARDWARE.md`](MindBox/docs/HARDWARE.md) is the chip-porting guide (its §2
  inventory still lists the OLED sibling's pins — trust `config.h`/`WIRING.md` for the S3).

## Context for this variant
- It is a **full firmware port**, not a UI demo: the brain (`StateMachine`/`Session`/`Menu`) is the
  classic-ESP32 sibling's code copied in unchanged; only **display** (SPI TFT, not I2C OLED) and **input**
  (touch ± encoder, not encoder-only) differ. The renderer is driven by a `UiModel` value, which is why
  the logic ports without edits.
- The sibling firmware at `../MindBox - hardware/MindBox/` is **authoritative for any ported module's
  behavior** (`ARCHITECTURE.md` etc.). This whole tree is one of two projects under the repo router at
  `../CLAUDE.md`; the only cross-project surface is the device↔server ingest contract
  (`POST /ingest/sessions|telemetry|pairing|unpair`, `GET /ingest/config`).
