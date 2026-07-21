# MindBox — repo router

This repo holds **two independent projects**. To keep LLM sessions cheap, **open the project
subfolder you're working in — not this root.** Each project has its own `CLAUDE.md` that maps it.

| Working on… | Open this folder | Its map |
|---|---|---|
| **Firmware** (ESP32 study box) | `MindBox - hardware/MindBox/` | `CLAUDE.md` there — subsystem map of the flat sketch |
| **Web app** (TanStack Start + Supabase) | `mindbox-companion-forge-main/` | `CLAUDE.md` there + `src/features/<domain>/` |

## Rules for agents
- Work on **one project at a time**. Don't read the other project unless the task genuinely spans both.
- The **only** cross-project surface is the device↔server **ingest contract**
  (`POST /ingest/sessions|telemetry|pairing|unpair`, `GET /ingest/config`). Both CLAUDE.md files point to it.
- Legacy prototypes, one-off test sketches, and docs live in **`archive/`** — ignore unless explicitly asked.
- `mindbox.code-workspace` opens each project as its own root for scoped sessions.
