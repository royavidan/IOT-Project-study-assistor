# MindBox — Algorithm & Performance Evaluation

Two algorithms in the project need documentation per the course rule ("if you have an algorithm,
include a description of its performance evaluation — quantitative results and how you tested"):

1. **Focus Load Estimate (FLE)** — a real-time heuristic that scores study conditions 0–100 (User
   Story 10).
2. **Adaptive Interval Coaching** — adjusts work/rest length from the FLE (User Story 16).
3. **Presence Detection** — ToF threshold classifier that gates "focus time" (User Story 9).

> Fields written `⟨fill: …⟩` are **measurements the team records from a live experiment** — do not
> invent them. Every *computed* number below is exact and derived directly from the formula.

---

## 1. Focus Load Estimate (FLE)

**Purpose.** Turn raw session + environment signals into one interpretable 0–100 "how loaded is this
study environment" number, shown live on the device and per-minute on the site. It is explicitly an
**estimate, not a clinical measurement**.

**Formula** (source of truth: `MindBox - hardware ESP32 S3 screen/MindBox/src/focus_load.h`, mirrored
in `mindbox-companion-forge-main/src/lib/focus-load.ts`):

```
FLE = round( 100 * ( 0.30·er + 0.30·n + 0.20·l + 0.20·p ) )

er = clamp01(elapsedSec / targetSec)     # session progress
n  = clamp01(noise)                      # normalized mic RMS (0..1)
l  = clamp01(lightVar)                   # normalized light variance (0..1)
p  = clamp01(presence / 5)               # presence count, capped at FLE_PRESENCE_CAP = 5
```

**Inputs & sources:** `noise` ← ES8311 I2S mic (~1 Hz AC-RMS); `lightVar` ← KY-018 light variance;
`presence` ← VL53L1X ToF (< 700 mm counts); `er` ← session clock. **Weights:** progress 30, noise 30,
light-variance 20, presence 20 (sum = 100). **Output:** integer 0–100, clamped.

---

## 2. Adaptive Interval Coaching

Threshold rule (constants in `config.h`): when the running FLE reaches **`FLE_ADAPTIVE_BREAK = 75`**,
the session offers/steers toward a break (shorter work interval), rate-limited by
**`COACHING_COOLDOWN_MS = 300000`** (5 min) so it can't nag repeatedly. Suppressed during exam DND.
This is a deterministic hysteresis-style controller, not a learned model.

---

## 3. Evaluation

### 3.1 Cross-implementation consistency (correctness)

Because FLE runs on **firmware, simulator, and web**, the key correctness property is that all three
produce the **same** number for the same inputs (a drift-guard unit test enforces the firmware/web
mirror). Test vectors (computed exactly from the formula):

| # | er | n | l | presence | FLE (expected) |
|---|----|----|----|----|----|
| V1 | 0.00 | 0.00 | 0.00 | 0 | **0** |
| V2 | 0.00 | 0.00 | 0.00 | 5 | **20** |
| V3 | 0.50 | 0.50 | 0.10 | 5 | **52** |
| V4 | 0.90 | 0.90 | 0.80 | 5 | **90** |
| V5 | 0.50 | 0.50 | 0.10 | 0 | **32** |
| V6 | 1.00 | 1.00 | 1.00 | 5 | **100** |

- **Method:** feed V1–V6 to `FocusLoad::compute` (firmware) and `computeFocusLoad` (web/`focus-load.ts`),
  and to the simulator's session generator; assert equality.
- **Result:** ⟨fill: run `bun run test focus-load` → record "N/N vectors match, 0 divergence"⟩.
  Expected: **0 mismatches** across all vectors and both implementations.

### 3.2 FLE sensitivity (behavioral validation — exact)

How much each input moves the score (partial derivatives = the weights, computed exactly):

| Input change | Δ FLE | Interpretation |
|---|---|---|
| noise 0.0 → 1.0 | **+30** | a loud room adds up to 30 pts |
| progress 0% → 100% | **+30** | fatigue proxy: later in a session scores higher |
| light-variance 0.0 → 1.0 | **+20** | flickering/unstable light adds up to 20 |
| presence 0 → 5 | **+20** | leaving the desk removes 20 pts (see V3 vs V5: 52 → 32) |
| +0.1 noise | **+3** | fine-grained mic response |
| +0.1 light-variance | **+2** | fine-grained light response |

**Validation demo:** on the device with Serial `m`, clap (noise ↑ → FLE ↑ ~3/0.1) and walk away
(presence 5→0 → FLE −20). These match the table above, live.

### 3.3 Presence detection accuracy (ToF classifier — measured experiment)

The one place with real ground-truth "accuracy". **Experiment:** place a flat target at known distances,
`T` trials each; the box classifies present (`dist < 700 mm`) vs absent. Record hits.

| True distance | Expected | Trials T | Correct | Accuracy |
|---|---|---|---|---|
| 300 mm | present | ⟨fill⟩ | ⟨fill⟩ | ⟨fill⟩ |
| 500 mm | present | ⟨fill⟩ | ⟨fill⟩ | ⟨fill⟩ |
| 680 mm | present (near threshold) | ⟨fill⟩ | ⟨fill⟩ | ⟨fill⟩ |
| 720 mm | absent (near threshold) | ⟨fill⟩ | ⟨fill⟩ | ⟨fill⟩ |
| 1000 mm | absent | ⟨fill⟩ | ⟨fill⟩ | ⟨fill⟩ |
| 1500 mm | absent | ⟨fill⟩ | ⟨fill⟩ | ⟨fill⟩ |

- **Conditions to record:** ambient light, target material, poll rate (`TOF_POLL_MS = 500 ms`), long-range
  mode. **Read live values** with Serial `m` (`dist=Nmm`).
- **Metrics:** overall accuracy = Σcorrect/Σtrials; note the near-threshold band (680/720 mm) where most
  errors cluster. **Suggested T ≥ 10 per distance.**

### 3.4 Noise/mic response (measured experiment)

**Experiment:** produce controlled sound at the box and read the normalized `noise` and derived dB via
Serial `a` / `m`. Confirm monotonic response.

| Condition | Reference dB (phone SPL app) | Box `noise` (0..1) | Box dB |
|---|---|---|---|
| Silent room | ⟨fill⟩ | ⟨fill⟩ | ⟨fill⟩ |
| Normal speech ~1 m | ⟨fill⟩ | ⟨fill⟩ | ⟨fill⟩ |
| Clap / loud | ⟨fill⟩ | ⟨fill⟩ | ⟨fill⟩ |

Expected: `noise` increases monotonically with true loudness; calibrate with `c db <ref>` at a mid level.

### 3.5 Timing / latency (measured)

| Quantity | Design value | Measured |
|---|---|---|
| Sensor→FLE→screen update cadence | ~1 Hz | ⟨fill⟩ |
| In-session sample period (WORK) | 60 s (`SAMPLE_PERIOD_MS`) | n/a (config) |
| Telemetry heartbeat to cloud | 30 s (`TELEMETRY_PERIOD_MS`) | ⟨fill: time a change on `/device`⟩ |
| Config downlink apply latency | ≤ 60 s (`CONFIG_FETCH_MS`) | ⟨fill: time a theme change reaching the box⟩ |
| FLE compute cost | O(1), a few FLOPs | negligible |

---

## 4. Limitations (state these honestly)

- FLE weights are **hand-tuned heuristics**, not fitted to labeled focus data — we validate *consistency
  and responsiveness*, not psychological ground truth.
- ToF accuracy degrades in the **±20 mm band around the 700 mm threshold** and with very dark/reflective
  targets.
- Mic `noise` is a relative RMS, calibrated per unit; absolute dB is approximate (±offset set by `c db`).
- Adaptive coaching is a fixed threshold (75) + cooldown (5 min), chosen for demo legibility, not learned.
