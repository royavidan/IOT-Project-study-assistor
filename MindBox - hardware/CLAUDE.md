# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# MindBox firmware — folder router

This folder is the **firmware project**. The actual sketch and all source live one level
down in **`MindBox/`**, which is its own Arduino sketch folder (Arduino compiles every
source in that one directory, so the files are flat by necessity).

**Open `MindBox/` and read [`MindBox/CLAUDE.md`](MindBox/CLAUDE.md)** — it is the real map:
subsystem table, the core-0/core-1 threading model, the device↔server ingest contract,
build/flash steps, feature flags, secrets/provisioning, and serial commands. Deeper design
and maintenance notes are in [`MindBox/ARCHITECTURE.md`](MindBox/ARCHITECTURE.md).

Do not re-document those here — keep this file a pointer only.

## Quick orientation
- **Board / build:** DOIT ESP32 DEVKIT V1, Arduino IDE (no CLI build), Serial @ 115200. A
  partition scheme with LittleFS/SPIFFS is required. Details + required libraries in `MindBox/CLAUDE.md`.
- **One source of truth:** `MindBox/config.h` owns every pin, tunable, feature flag (`HAS_*`,
  `ENABLE_WIFI`, `ENABLE_CLOUD`), and `FW_VERSION`. Nothing else hard-codes a pin or threshold.
- **Secrets:** `MindBox/SECRETS.h` is gitignored and holds first-boot defaults only; runtime
  values provisioned over the serial `w` command persist in NVS and override it.

## Sibling note
A separate variant for different hardware lives next to this folder (`../MindBox - hardware ESP32 S3 screen/`).
It is **not** part of this project — ignore it unless a task explicitly targets it.
