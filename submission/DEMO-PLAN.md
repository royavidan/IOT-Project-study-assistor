# MindBox — Submission Demo Plan (Group 13)

**Format:** ~25 min, no slides. 1-minute spoken intro to the guest instructor, then straight to
demos **in User-Stories order, basic → advanced**, finishing with settings/statistics + edge cases.
Bring the **User Stories** sheet and the **Edge-Cases** sheet **printed ×3**.

> This document is the team's run-of-show. It maps every one of the 16 user stories to: **what we
> demo**, **what proves it**, **implementation status**, and **time**. It also flags the hardware
> features that evolved from the original plan, and lists the edge cases and our engineering insights.

---

## 0. Pre-demo checklist (do this 20+ min early — you can enter 30 min before)

- [ ] **Phone hotspot ON, 2.4 GHz** (ESP32-S3 is 2.4 GHz only). **No Technion Wi-Fi.** Put the phone
      **physically against the window** for reception. Test the box joins it *before* the slot.
- [ ] **Strong 5 V supply** for the box (wall charger / good power bank — **not** a laptop USB port).
      Mic + ToF raise boot current; a weak supply browns out and reboot-loops.
- [ ] **Live site reachable**: http://82.70.210.87/ (the Oracle server) **or** `bun run dev`
      (http://localhost:8080) as a fallback. Confirm the box's `x-device-secret` matches the server.
- [ ] **Demo account logged in** on the laptop (seeded with history/streak/homework/leaderboard —
      see "Demo account" below), with `/device`, `/`, `/history`, `/insights`, `/leaderboard`,
      `/exports`, `/reviewers`, `/calendar` tabs pre-opened.
- [ ] **Serial monitor** open @ **115200** (for the self-test + the `m` live monitor).
- [ ] **Short time constants set** (see §"Timing" — nothing on stage should take > 2 min).
- [ ] **Backup video** on a team laptop, showing each feature working, in case a live feature fails.
- [ ] **Git is public** — verify in an **incognito** window: `github.com/royavidan/IOT-Project-study-assistor`.
- [ ] Touch **calibrated** (long-press BOOT to recalibrate if taps land wrong).
- [ ] Printed **×3**: User Stories sheet + Edge-Cases sheet.

---

## 1. One-minute intro (say this, then go straight to demos)

> "MindBox היא קופסת פוקוס חכמה לסטודנטים. במקום עוד אפליקציית טיימר פסיבית, הקופסה **מודדת בזמן
> אמת את סביבת הלמידה** — רעש, טמפרטורה, אור, ונוכחות מול השולחן — מריצה סשני פומודורו, ומחשבת
> 'עומס פוקוס'. היא עובדת גם **לגמרי בלי רשת** ומסתנכרנת עם אתר שמראה היסטוריה, סטטיסטיקות ושליטה
> מרחוק. נעבור עכשיו לפי טבלת ה-User Stories, מהבסיסי למתקדם."

Hold the box, point to: screen, encoder, mic, ToF window, DHT11, light sensor.

---

## 2. ⚠️ Hardware evolution — read before the demo (important)

The original user-stories/parts list (OLED + **LED ring** + **vibration motor** + **SPDT toggle** +
**LiPo battery**) was the *first-board* plan. The project was **ported to the LCDWIKI ES3C28P
ESP32-S3 board**, which changed the feedback/controls hardware. In `config.h` these are switched off
(`HAS_LED_RING=0`, `HAS_HAPTIC=0`, `USE_SPDT_TOGGLE=0`, `HAS_BATTERY=0`) and **replaced by richer
onboard hardware**:

| Original (stories) | On the S3 board | Demo the replacement as |
|---|---|---|
| LED ring status/feedback (2, 15) | **2.8" TFT screen** (boot breadcrumbs, live status, reset reason) | on-screen status + boot self-test |
| Vibration motor end-cue (2) | **ES8311 I2S speaker** (start/pause/complete chimes, "ring") | session chimes + remote "Ring" |
| SPDT physical Work/Break toggle (1) | **Touchscreen + encoder** mode selection | tap/turn to switch modes |
| LiPo battery gauge | (runs on USB 5 V for the demo) | n/a — say "USB-powered for the demo" |

**Action:** present these as a deliberate hardware upgrade (screen + audio > single LED + buzzer), and
**email Tom in advance** to confirm this is acceptable for the "all features demonstrated" rule, since
a few original parts are not physically on the board. Have this table printed with the edge cases.

---

## 3. Run-of-show (~25 min, basic → advanced)

| Min | Block | Stories | What you do |
|---|---|---|---|
| 0–1 | Intro | — | The 1-minute pitch above. |
| 1–4 | **Boot + physical controls** | 1, 3, 14, 15 | Power on → **boot self-test on screen + Serial** (I2C `0x38`+`0x29`, PSRAM, heap, reset reason). Turn **encoder** to set duration; **tap/press** to select; **touch** to switch mode. Show Wi-Fi provisioning screen (captive portal / on-screen keyboard). |
| 4–8 | **Sensors are alive** | 8, 9 | Serial `m` (1 Hz monitor): move hand → `dist=Nmm` (ToF); clap → noise/`pp` jumps (mic); cover light sensor → lux drops + **screen dims**; breathe on DHT11 → temp rises. Mirror on `/device` "Room right now". |
| 8–13 | **Live session + presence + FLE** | 9, 10, 16 | Start a **short** session. Make noise → interference cue (chime + icon). Walk away → **Away/auto-pause** (ToF). Point out the **Focus Load** number changing. If FLE crosses the adaptive threshold, show **adaptive coaching** adjusting the interval. |
| 13–16 | **Data reaches the cloud** | 5, 8, 10 | On `/session/$id`: per-minute **FLE + noise graphs** + interruption count from the session just finished. On `/` and `/history`: session list, **Focus Streak**, date-range summary. |
| 16–19 | **Bidirectional control + feedback** | 2, 7 | From `/device`: **"Ring my device"** → box chimes (Queued→Sent→Done). Change **theme/settings** → box updates ≤60 s. Switch **user profile** on the box. (Feedback = screen + speaker, per §2.) |
| 19–22 | **Offline resilience** | 4, 8 | Kill the hotspot mid-session → session keeps running (screen fine); Serial `q` shows it **queued**. Restore Wi-Fi → it **syncs** and appears on the site with NTP-corrected times. |
| 22–25 | **Reviewer + reports + nudges + edge cases** | 6, 11, 12, 13 | `/leaderboard` (streaks vs friends); `/exports` → **download PDF / email a report**; show a **motivation nudge**; **invite a Reviewer** (read-only). Finish with 1–2 edge cases (§5). Leave ~1 min for the TAs to **operate it themselves**. |

Let the TAs hold and press the box wherever possible — the instructions explicitly prefer that.

---

## 4. User-story coverage (all 16) — status + how to prove each

Legend: ✅ implemented · 🔁 replaced by better S3 hardware (see §2) · 🌐 web/app feature (needs seeded account).

| # | Story | Status | How to demo | What proves it |
|---|---|---|---|---|
| 1 | Physical Controls | ✅ (toggle 🔁 touch) | Turn encoder, press shaft button, tap touchscreen to change mode | Cursor moves, selection works, mode switches — no phone |
| 2 | Hardware Feedback | 🔁 screen + speaker | Session start/end **chime**; on-screen status; remote "Ring" | Audible chime + visible status (replaces LED ring + buzzer) |
| 3 | Local Timer Setup | ✅ | Turn encoder to set duration **offline** (Wi-Fi off) | Duration changes on screen with no app connection |
| 4 | Offline Buffering | ✅ | Kill Wi-Fi, run session, reconnect | Serial `q` shows queued; syncs to site after reconnect |
| 5 | Session History | 🌐 | `/history`, `/session/$id`, streak, date range | List + bar graph + Focus Streak (seeded data) |
| 6 | Multi-User Leaderboard | 🌐 | `/leaderboard` | Streak ranking among friends (seeded friends) |
| 7 | User Identification | ✅ | Switch profile slot on the box | Separate history/prefs per profile |
| 8 | Environmental Sensing | ✅ | Serial `m` + `/device` room conditions | noise/temp/light logged live and in-session |
| 9 | Presence Detection | ✅ | Hand wave; walk away during session | `dist=Nmm` live; Away/auto-pause |
| 10 | Focus Load Estimation | ✅ (algorithm) | FLE on device + `/session` graph | Real-time 0–100 estimate (see ALGORITHM-EVALUATION.md) |
| 11 | Export Delivery | 🌐 | `/exports` → PDF/CSV / email | File downloads / email sent |
| 12 | Motivation Nudges | 🌐 | Show inactivity nudge banner | Nudge appears after inactivity |
| 13 | Grant Read-Only Access | 🌐 | `/reviewers` → invite a reviewer | Reviewer gets read-only report access |
| 14 | Wi-Fi Setup | ✅ | Captive-portal / on-screen keyboard provisioning | Box joins network without recoding |
| 15 | Device Status Signals | 🔁 screen | Boot breadcrumbs + status + reset reason on TFT | Device state visible at a glance (replaces LED ring) |
| 16 | Adaptive Interval Coaching | ✅ | Drive FLE high → interval adapts | Work/rest length changes with Focus Load |

**Needs the seeded demo account:** stories **5, 6, 11, 12, 13** (and richer 10). Seed it before the slot.

---

## 5. Edge cases we handle (print ×3, demo 2–3 live)

| Edge case | How we handle it | Live demo |
|---|---|---|
| Wi-Fi drops mid-session | Session clock is an independent 10 ms `esp_timer`; data buffers to LittleFS | Kill hotspot mid-session; screen + clock keep going |
| Power loss mid-session | Versioned NVS checkpoint on every start/pause/resume | Yank USB mid-session → boots to **"Resume session?"** |
| Sensor read fails | Keep last good value; range-clamp; fault → `ST_ERROR` | Unplug DHT (or simulator `--sensor-fault`) → red Fault row |
| I2C bus lock-up | ToF "canary" pings every 2 s; 9-clock bus-recovery | (explain; hard to force live) |
| Brownout on weak supply | Reset-reason shown on screen; TX-power capped | Show reset-reason line at boot |
| Duplicate offline uploads | Idempotent upsert on `(device_id, id)` | Re-run sync → no duplicates |
| Unauthorized cloud write | `x-device-secret` constant-time check | `curl` without header → **401**; with header → JSON |
| Clock not yet synced offline | 1970 timestamps patched once NTP is up | Offline session shows correct time after sync |
| Encoder button vs DHT11 on same pin | IO21 shared; DHT read skipped while button held | Turn/press/breathe — all work, no conflict |

---

## 6. Timing — keep everything under 2 minutes

- **Session length:** set the **shortest** duration on the encoder for the live session; you only need
  ~30–60 s on stage to show start → interference → away → complete. (Firmware min is 5 min; for the
  demo either shorten `DUR_MIN_MIN` in `config.h` **or** use a remote `start` command with a small
  `cmdArg`, or narrate a running session and jump to a pre-finished one on the site.)
- **History / streak / 30-day stats:** don't wait — the **seeded account** already has 30 days.
- **Offline sync:** use a short session or the simulator `--offline-then-sync`; don't run a full
  pomodoro cycle live.
- **Config downlink latency:** the box polls config every 60 s. For the demo it's fine, but if you
  need it snappier, mention it or temporarily lower `CONFIG_FETCH_MS`.

---

## 7. Insights / what we learned (say a few of these — graders like reflection)

- **Architecture beats hardware churn.** The brain (`StateMachine`/`Session`/`Menu`) is display-agnostic
  (driven by a `UiModel`), so porting from ESP32+OLED to the S3+touchscreen changed almost no logic —
  only display + input. That's why the LED-ring→screen and buzzer→speaker swap was cheap.
- **Concurrency is the reason it stays smooth.** UI/FSM/sensors on **core 1**, Wi-Fi/HTTP + audio on
  **core 0**, session countdown on a **10 ms hardware timer** — so a blocking 18–20 s HTTP call never
  freezes the screen or loses session time.
- **The hardest bug was the network, not the sensors.** A recurring reboot-while-connected was an lwIP
  `pbuf` double-free; the fix was a **kept-alive reused socket + task-serialized reconnect** (we
  deliberately *disabled* `autoReconnect`), not the intuitive "reconnect harder".
- **Constraint-driven design.** The board breaks out only **4 GPIO**, forcing the **IO21** share
  (encoder button + DHT11) — safe because the DHT pull-up holds the active-low button high, and the
  firmware skips a temp read while the button is held.
- **Honest telemetry.** FLE is always labeled an *estimate*, and the same formula runs on firmware,
  simulator, and web (drift-guarded) so the number is consistent everywhere.

---

## 8. Git / submission compliance (per the course instructions)

- [x] All project materials in Git (this `submission/` folder, firmware, web app) — **not** Drive.
- [ ] **Repo public** — verify in incognito.
- [x] User-facing documentation in Git (system guide, wiring, this plan).
- [ ] **Libraries + versions, SDK/ESP32-core version, connection diagram** — see
      `submission/HARDWARE-LIBRARIES-SDK.md` (fill in exact installed versions).
- [x] **Algorithm performance evaluation** — see `submission/ALGORITHM-EVALUATION.md`.
- [ ] App code in Git; **no compiled `build/` / `node_modules`** committed.
- [ ] Do **not** change the repo after the submission slot (get written TA approval for exceptions).
- [ ] Project video: film features working **before** returning hardware (equipment due ≤2 weeks; video ≤3 weeks).

---

### Quick command reference (on stage)
- Serial: `m` live monitor · `a` mic probe · `c` sensor calib · `b` button test · `q` upload queue · `d` dump · `h` help
- Simulator fallback: `bun run simulate` · `-- --offline-then-sync` · `-- --sensor-fault` · `-- --low-battery` · `-- --config`
