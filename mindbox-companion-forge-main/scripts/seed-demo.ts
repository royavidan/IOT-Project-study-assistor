/**
 * seed-demo.ts — creates + seeds a set of DEMO accounts on the (live) Supabase
 * project, so every app-dependent user story has data to show in the submission.
 *
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env (service role bypasses
 * RLS). Idempotent: re-running deletes each demo user's prior seeded rows first.
 *
 *   bun scripts/seed-demo.ts        (run from the web-app folder)
 *   npx tsx scripts/seed-demo.ts
 *
 * Accounts (shared password below) — each demonstrates specific user stories:
 *   primary  — 30 days rich history, env+focus samples, homework, courses,
 *              weekly schedule + exam, reviewer grant  → stories 5,8,9,10,11 + planner
 *   friend1  — 20 days history (streak) → leaderboard (story 6)
 *   friend2  — 10 days history (streak) → leaderboard (story 6)
 *   reviewer — read-only access to primary's reports → story 13
 *   fresh    — empty account → onboarding + motivation nudge (story 12)
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ---- read .env manually (works under node/tsx/bun the same way) -------------
function loadEnv(): Record<string, string> {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "mindbox-companion-forge-main/.env"),
    path.resolve(import.meta.dirname ?? ".", "../.env"),
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) throw new Error(".env not found (run from the web-app folder)");
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2];
  }
  return out;
}

const env = loadEnv();
const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env");
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const PASSWORD = "MindboxDemo2026!";
const ACCOUNTS = [
  { key: "primary", email: "mindbox.primary@example.com", name: "Alex (Demo)", days: 30, perDay: 1.4 },
  { key: "friend1", email: "mindbox.friend1@example.com", name: "Maya", days: 20, perDay: 1.1 },
  { key: "friend2", email: "mindbox.friend2@example.com", name: "Noam", days: 10, perDay: 1.0 },
  { key: "reviewer", email: "mindbox.reviewer@example.com", name: "Reviewer (Parent)", days: 0, perDay: 0 },
  { key: "fresh", email: "mindbox.new@example.com", name: "New Student", days: 0, perDay: 0 },
] as const;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const irnd = (a: number, b: number) => Math.floor(rnd(a, b + 1));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const DAY = 86400000;

async function createOrGetUser(email: string, name: string): Promise<string> {
  const { data: created, error } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (!error && created?.user) return created.user.id;
  // Already exists → find it.
  const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const found = list?.users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
  if (!found) throw new Error(`could not create or find user ${email}: ${error?.message}`);
  return found.id;
}

async function clearUserData(userId: string) {
  // sessions cascade-delete focus_load_samples + env_samples via FK on delete cascade.
  await db.from("sessions").delete().eq("user_id", userId);
  await db.from("homework_assignments").delete().eq("user_id", userId);
  await db.from("schedule_events").delete().eq("user_id", userId);
  await db.from("courses").delete().eq("user_id", userId);
  await db.from("reviewer_grants").delete().eq("owner_user_id", userId);
  await db.from("friendships").delete().or(`user_id.eq.${userId},friend_id.eq.${userId}`);
  await db.from("devices").delete().eq("owner_user_id", userId);
}

async function seedSessions(userId: string, deviceId: string, days: number, perDay: number) {
  const sessions: any[] = [];
  const focus: any[] = [];
  const envs: any[] = [];
  let seq = 1;
  const now = Date.now();
  for (let d = days - 1; d >= 0; d--) {
    const count = Math.random() < perDay - Math.floor(perDay) ? Math.ceil(perDay) : Math.floor(perDay);
    for (let s = 0; s < Math.max(1, count); s++) {
      const targetMin = [25, 25, 50][irnd(0, 2)];
      const targetSec = targetMin * 60;
      const startHour = 9 + irnd(0, 10);
      const start = now - d * DAY - (24 - startHour) * 3600000 + s * 3600000;
      const focusSec = Math.round(targetSec * rnd(0.85, 1.0));
      const end = start + focusSec * 1000;
      const noiseAvg = +rnd(0.08, 0.55).toFixed(3);
      const tempC = +rnd(21, 26).toFixed(1);
      const lightLux = Math.round(rnd(180, 620));
      const fleAvg = clamp(Math.round(30 + noiseAvg * 40 + rnd(-8, 20)), 10, 95);
      const id = crypto.randomUUID();
      sessions.push({
        id,
        device_id: deviceId,
        user_id: userId,
        slot: "A",
        started_at: new Date(start).toISOString(),
        ended_at: new Date(end).toISOString(),
        target_duration_sec: targetSec,
        actual_focus_sec: focusSec,
        mode: "work",
        status: "completed",
        breaks: irnd(0, 2),
        presence_interruptions: irnd(0, 3),
        noise_avg: noiseAvg,
        temp_c: tempC,
        light_lux: lightLux,
        focus_load_avg: fleAvg,
        client_seq: seq++,
      });
      for (let t = 0; t <= focusSec; t += 120) {
        focus.push({ session_id: id, t_sec: t, value: clamp(Math.round(fleAvg + rnd(-12, 12)), 0, 100) });
        envs.push({
          session_id: id,
          t_sec: t,
          noise: +clamp(noiseAvg + rnd(-0.1, 0.15), 0, 1).toFixed(3),
          temp_c: +(tempC + rnd(-0.6, 0.6)).toFixed(1),
          light_lux: Math.round(clamp(lightLux + rnd(-60, 60), 0, 1000)),
        });
      }
    }
  }
  await chunkedInsert("sessions", sessions);
  await chunkedInsert("focus_load_samples", focus);
  await chunkedInsert("env_samples", envs);
  return sessions.length;
}

async function chunkedInsert(table: string, rows: any[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).insert(rows.slice(i, i + 500));
    if (error) throw new Error(`insert ${table}: ${error.message}`);
  }
}

async function seedFriendship(a: string, b: string) {
  await db.from("friendships").upsert([
    { user_id: a, friend_id: b, status: "accepted" },
    { user_id: b, friend_id: a, status: "accepted" },
  ]);
}

async function seedCoursesScheduleHomework(userId: string) {
  const courses = [
    { code: "0512.3400", name: "Signals & Systems", color: "#e5352b", instructor: "Dr. Cohen", credits: 4, target_grade: 90 },
    { code: "0512.4444", name: "Operating Systems", color: "#0f6ec4", instructor: "Prof. Levi", credits: 3.5, target_grade: 85 },
    { code: "0509.1830", name: "Calculus 2", color: "#2e9b4f", instructor: "Dr. Bar", credits: 5, target_grade: 88 },
  ].map((c) => ({ ...c, user_id: userId }));
  await db.from("courses").insert(courses);

  const iso = (d: number) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);
  await db.from("homework_assignments").insert([
    { user_id: userId, course_code: "0512.3400", title: "Signals HW3 — Fourier", due_date: iso(3), status: "pending", progress_pct: 40 },
    { user_id: userId, course_code: "0512.4444", title: "OS Assignment — Scheduler", due_date: iso(6), status: "pending", progress_pct: 10 },
    { user_id: userId, course_code: "0509.1830", title: "Calculus Pset 5", due_date: iso(-1), status: "submitted", progress_pct: 100 },
    { user_id: userId, course_code: "0512.4444", title: "OS Lab 2", due_date: iso(-8), status: "graded", grade: 92, progress_pct: 100 },
  ]);

  const wk = (dow: number, code: string, title: string, start: string, end: string, loc: string) => ({
    user_id: userId, kind: "weekly", day_of_week: dow, course_code: code, title, start_time: start, end_time: end, location: loc, color: "#6366f1",
  });
  await db.from("schedule_events").insert([
    wk(0, "0512.3400", "Signals Lecture", "10:00", "12:00", "Room 305"),
    wk(2, "0512.4444", "OS Lecture", "14:00", "16:00", "Taub 4"),
    wk(3, "0509.1830", "Calculus Tutorial", "09:00", "10:00", "Ulman 200"),
    { user_id: userId, kind: "once", event_date: iso(4), course_code: "0512.3400", title: "Signals Midterm (EXAM)", start_time: "09:00", end_time: "12:00", location: "Exam Hall", color: "#e5352b" },
  ]);
}

async function seedReviewer(ownerId: string, reviewerEmail: string, reviewerId: string) {
  await db.from("user_settings").update({ share_with_reviewers: true }).eq("user_id", ownerId);
  await db.from("reviewer_grants").insert({
    owner_user_id: ownerId,
    reviewer_email: reviewerEmail,
    reviewer_user_id: reviewerId,
    token: crypto.randomUUID(),
    status: "active",
    expires_at: null,
  });
}

async function main() {
  console.log(`Seeding demo accounts on ${SUPABASE_URL} ...`);
  const ids: Record<string, string> = {};
  for (const a of ACCOUNTS) {
    ids[a.key] = await createOrGetUser(a.email, a.name);
    await clearUserData(ids[a.key]);
    console.log(`  user ${a.email} -> ${ids[a.key].slice(0, 8)} (cleared)`);
  }
  for (const a of ACCOUNTS) {
    if (a.days > 0) {
      const n = await seedSessions(ids[a.key], `demo-${a.key}`, a.days, a.perDay);
      console.log(`  ${a.key}: ${n} sessions + samples`);
    }
  }
  await seedFriendship(ids.primary, ids.friend1);
  await seedFriendship(ids.primary, ids.friend2);
  await seedFriendship(ids.friend1, ids.friend2);
  console.log("  friendships (accepted) wired -> leaderboard");
  await seedCoursesScheduleHomework(ids.primary);
  console.log("  primary: courses + schedule + homework");
  await seedReviewer(ids.primary, "mindbox.reviewer@example.com", ids.reviewer);
  console.log("  reviewer grant (active) -> reviewer can read primary");

  console.log("\n=== DEMO ACCOUNTS (password for all: " + PASSWORD + ") ===");
  for (const a of ACCOUNTS) console.log(`  ${a.email.padEnd(30)}  ${a.name}`);
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
