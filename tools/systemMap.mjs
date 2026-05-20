#!/usr/bin/env node
// systemMap.mjs — 현재 머신의 자동화 상태를 *실측*해 렌더한다.
//
// 왜 존재하는가 (DECISIONS 2026-05-18 "생성형 도면"):
//   손으로 쓴 "현황 도면" 은 현실의 사본이다. 사본은 둘이면 반드시 어긋난다 —
//   "바뀌면 같이 갱신" 규칙은 의지에 기댄 권유. MAP.md 가 gitSync·watcherMemory
//   를 삭제 후에도 현역으로 표기한 사고가 정확히 그 결과였다.
//   이 스크립트는 ~/Library/LaunchAgents 와 launchctl 을 *직접 읽어* 렌더한다.
//   출력은 사본이 아니라 현실 자체 — drift 가 불가능하다.
//
// 사용:
//   systemMap                 사람이 직접 (현재 자동화 상태 확인)
//   sessionStartContext.sh    SessionStart 훅이 호출 → 매 세션 컨텍스트에 주입
//
// macOS 전용. 다른 peer (OCI 등) 에서는 "N/A" 만 출력한다 (거짓말하지 않음).

import "./lib/freshness.mjs"

import { execSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HOME = homedir();
const LA_DIR = join(HOME, "Library/LaunchAgents");
const DAEMONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "daemons");
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function sh(cmd) {
  try { return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return ""; }
}

function plistJson(path) {
  const out = sh(`plutil -convert json -o - ${JSON.stringify(path)}`);
  try { return JSON.parse(out); } catch { return null; }
}

// launchctl list → { label: lastExitStatus }
function loadedAgents() {
  const map = {};
  for (const line of sh("launchctl list").split("\n")) {
    const m = line.match(/^(-|\d+)\t(-|\d+)\t(com\.clavier\.\S+)/);
    if (m) map[m[3]] = m[2] === "-" ? null : Number(m[2]);
  }
  return map;
}

function scheduleLabel(sci) {
  if (!sci) return null;
  const entries = Array.isArray(sci) ? sci : [sci];
  return entries.map((e) => {
    const hh = String(e.Hour ?? 0).padStart(2, "0");
    const mm = String(e.Minute ?? 0).padStart(2, "0");
    const day = e.Weekday != null ? `${WEEKDAYS[e.Weekday]} ` : "매일 ";
    return `${day}${hh}:${mm}`;
  }).join(", ");
}

// ProgramArguments 에서 실제 실행 대상(스크립트) 한 개를 뽑는다.
function programOf(args) {
  if (!Array.isArray(args) || args.length === 0) return "?";
  const script = args.find((a) => /\.(mjs|sh|py|js)$/.test(a));
  return basename(script ?? args[args.length - 1]);
}

function render() {
  const out = [];
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  out.push(`# === 시스템 자동화 — 실측 도면 (생성: ${stamp}) ===`);
  out.push("");
  out.push("> 손으로 쓰지 않는다. systemMap.mjs 가 ~/Library/LaunchAgents 를 직접 읽어 렌더.");
  out.push("> 이 블록은 현실의 사본이 아니라 현실 자체 — drift 불가.");
  out.push("");

  if (platform() !== "darwin" || !existsSync(LA_DIR)) {
    out.push("(이 peer 는 macOS 아님 — LaunchAgent 자동화 레이어 N/A)");
    return out.join("\n");
  }

  const loaded = loadedAgents();
  const plists = readdirSync(LA_DIR).filter((f) => /^com\.clavier\..+\.plist$/.test(f));

  const scheduled = [];
  const watchers = [];
  const other = [];
  for (const f of plists.sort()) {
    const p = plistJson(join(LA_DIR, f));
    if (!p) continue;
    const label = p.Label ?? f.replace(/\.plist$/, "");
    const short = label.replace(/^com\.clavier\./, "");
    const exit = loaded[label];
    const status = exit == null
      ? "미적재"
      : exit === 0 ? "적재·exit 0" : `적재·exit ${exit} ⚠`;
    const prog = programOf(p.ProgramArguments);
    if (p.StartCalendarInterval) {
      scheduled.push({ short, when: scheduleLabel(p.StartCalendarInterval), prog, status });
    } else if (p.WatchPaths) {
      const watched = p.WatchPaths.map((w) => w.replace(HOME, "~")).join(", ");
      watchers.push({ short, watched, prog, status });
    } else {
      other.push({ short, prog, status });
    }
  }

  const pad = (s, n) => String(s).padEnd(n);
  if (scheduled.length) {
    out.push("⏰ 예약 실행 (StartCalendarInterval)");
    for (const a of scheduled)
      out.push(`   ${pad(a.short, 22)} ${pad(a.when, 14)} ${pad(a.prog, 26)} [${a.status}]`);
    out.push("");
  }
  if (watchers.length) {
    out.push("👁 파일·이벤트 감시 (WatchPaths)");
    for (const a of watchers)
      out.push(`   ${pad(a.short, 22)} ${pad(a.watched, 34)} ${pad(a.prog, 26)} [${a.status}]`);
    out.push("");
  }
  if (other.length) {
    out.push("• 기타 (트리거 미분류)");
    for (const a of other)
      out.push(`   ${pad(a.short, 22)} ${pad(a.prog, 26)} [${a.status}]`);
    out.push("");
  }

  // repo daemons/ ↔ 설치 불일치 — SSOT(repo) 와 머신의 어긋남을 시끄럽게 드러낸다.
  if (existsSync(DAEMONS_DIR)) {
    const repoLabels = readdirSync(DAEMONS_DIR)
      .filter((f) => f.endsWith(".plist"))
      .map((f) => f.replace(/\.plist$/, ""));
    const liveLabels = plists.map((f) => f.replace(/\.plist$/, ""));
    const repoOnly = repoLabels.filter((l) => !liveLabels.includes(l));
    const liveOnly = liveLabels.filter((l) => !repoLabels.includes(l));
    if (repoOnly.length || liveOnly.length) {
      out.push("⚠ repo daemons/ ↔ 설치 불일치");
      if (repoOnly.length)
        out.push(`   repo 에만 (미설치):   ${repoOnly.join(", ")}`);
      if (liveOnly.length)
        out.push(`   설치에만 (repo 없음): ${liveOnly.join(", ")}`);
      out.push("");
    }
  }

  return out.join("\n").replace(/\n+$/, "");
}

console.log(render());
