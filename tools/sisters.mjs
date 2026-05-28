#!/usr/bin/env node
/**
 * sisters — tools/lib 안 *자매 모듈* 도면. "이미 누가 해놨나" 즉시 확인.
 *
 * 정신 (사용자 발화 2026-05-27):
 *   "걔네가 이미 대부분의 문제를 해결해놨으니 모듈식으로 조립해서 파생도구를 만들면돼 언제나"
 *   → 새 파생도구 작성 전, *family 자체*가 보이도록 자동 주입 (권유 X, 구조 lock).
 *
 * family 발견 (손으로 박지 않음 — 파일 시스템에서 생성):
 *   - `tools/lib/<family>/*.mjs`      → subfolder = family
 *   - `tools/lib/<family>-*.mjs` ≥2개 → prefix = family
 *   - `tools/lib/<x>/<family>*.mjs`   → cross-mention (basename 이 family 면 함께 노출)
 *
 * 사용:
 *   sisters             # 전체 (= sisters all)
 *   sisters all
 *   sisters airtable    # 특정 family 만
 *   sisters --plain     # 색 없이 (hook 주입용)
 *
 * 환경:
 *   NO_COLOR=1          # ANSI 색상 끄기 (자동 — non-TTY 시에도)
 */

import "./lib/freshness.mjs";

import { readdirSync, statSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import {
  bold as _bold, cyan as _cyan, dim as _dim,
  yellow as _yellow, green as _green, red as _red,
} from "./lib/cli-color.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);
const LIB = join(HERE, "lib");

// ─── 색상 (NO_COLOR / --plain 지원) ────────────────────
const argv = process.argv.slice(2);
const PLAIN = !!process.env.NO_COLOR
  || argv.includes("--plain")
  || !process.stdout.isTTY;
const id = s => s;
const bold   = PLAIN ? id : _bold;
const cyan   = PLAIN ? id : _cyan;
const dim    = PLAIN ? id : _dim;
const yellow = PLAIN ? id : _yellow;
const green  = PLAIN ? id : _green;
const red    = PLAIN ? id : _red;

// ─── 파일 시스템 헬퍼 ────────────────────────────────────
function listMjs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith(".mjs")).sort();
}

function listSubdirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => {
    if (f.startsWith("_") || f.startsWith(".")) return false;
    try { return statSync(join(dir, f)).isDirectory(); }
    catch { return false; }
  }).sort();
}

// 파일 첫 의미 코멘트 → 한 줄 설명.
// 받아주는 형태:
//   // <filename> — <설명>
//   // <설명>
//   /**\n * <filename> — <설명>
//   /**\n * <설명>
function describe(absPath) {
  let text;
  try { text = readFileSync(absPath, "utf8"); }
  catch { return ""; }
  const lines = text.split("\n").slice(0, 30);
  for (const raw of lines) {
    let s = raw.trim();
    if (!s) continue;
    if (s.startsWith("#!")) continue;
    if (s.startsWith("//")) s = s.slice(2).trim();
    else if (s.startsWith("/**")) s = s.slice(3).trim();
    else if (s.startsWith("/*")) s = s.slice(2).trim();
    else if (s.startsWith("*/")) continue;
    else if (s.startsWith("*")) s = s.slice(1).trim();
    else continue;
    if (!s || s.startsWith("@")) continue;
    const m = s.match(/^[\w./\-]+\.(?:mjs|js|ts)\s*[—-]\s*(.+)$/);
    return (m ? m[1] : s).trim();
  }
  return "";
}

// ─── family 발견 ────────────────────────────────────────
function discoverFamilies() {
  const subdirs = listSubdirs(LIB).filter(d => d !== "__pycache__");
  const rootMjs = listMjs(LIB);

  const prefixGroups = new Map();
  for (const f of rootMjs) {
    const m = f.match(/^([a-z][a-z0-9]*)-/);
    if (!m) continue;
    const p = m[1];
    if (!prefixGroups.has(p)) prefixGroups.set(p, []);
    prefixGroups.get(p).push(f);
  }
  const prefixFamilies = [...prefixGroups.entries()]
    .filter(([, files]) => files.length >= 2)
    .map(([p]) => p);

  const all = new Set([...prefixFamilies, ...subdirs]);
  return [...all].sort();
}

// ─── family 별 파일 수집 ─────────────────────────────────
function gatherFamily(family) {
  const rootHits = [];
  for (const f of listMjs(LIB)) {
    if (f.startsWith(family + "-") || f === family + ".mjs") {
      rootHits.push({ rel: `lib/${f}`, abs: join(LIB, f) });
    }
  }

  const subDir = join(LIB, family);
  const subHits = [];
  if (existsSync(subDir)) {
    try {
      if (statSync(subDir).isDirectory()) {
        for (const f of listMjs(subDir)) {
          subHits.push({ rel: `lib/${family}/${f}`, abs: join(subDir, f) });
        }
      }
    } catch { /* skip */ }
  }

  const crossHits = [];
  for (const sub of listSubdirs(LIB)) {
    if (sub === family || sub === "__pycache__") continue;
    for (const f of listMjs(join(LIB, sub))) {
      const base = f.replace(/\.mjs$/, "");
      if (base === family || base.startsWith(family + "-")) {
        crossHits.push({ rel: `lib/${sub}/${f}`, abs: join(LIB, sub, f) });
      }
    }
  }

  return { rootHits, subHits, crossHits };
}

// ─── git 최근 변경 ──────────────────────────────────────
function recentChanges(relPaths) {
  if (!relPaths.length) return [];
  try {
    const out = execFileSync("git", [
      "-C", REPO,
      "log", "--oneline", "-n", "10", "--",
      ...relPaths.map(p => `tools/${p}`),
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

// ─── 렌더 ────────────────────────────────────────────────
const PAD = 30;

function pad(s, n) {
  if (s.length >= n) return s + " ";
  return s + " ".repeat(n - s.length);
}

function renderHit(h) {
  const desc = describe(h.abs);
  return "  " + pad(h.rel, PAD) + dim(desc);
}

function renderFamily(family) {
  const { rootHits, subHits, crossHits } = gatherFamily(family);
  const all = [...rootHits, ...subHits, ...crossHits];
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");

  if (all.length === 0) {
    return [
      bold(`━━━ ${capitalize(family)} Sisters ━━━`),
      red(`  (family 없음 — tools/lib/${family}-*.mjs / tools/lib/${family}/ 모두 비어있음)`),
      green(`  새로 만들 자리:`),
      `    tools/lib/${family}-<책무>.mjs     (root, prefix 컨벤션)`,
      `    tools/lib/${family}/<책무>.mjs     (subfolder, 모듈 ≥2개 묶음)`,
      "",
    ].join("\n");
  }

  const lines = [bold(`━━━ ${capitalize(family)} Sisters (live, ${ts}) ━━━`)];
  for (const h of rootHits) lines.push(renderHit(h));
  if (subHits.length) {
    if (rootHits.length) lines.push("");
    for (const h of subHits) lines.push(renderHit(h));
  }
  if (crossHits.length) {
    lines.push("");
    lines.push("  " + yellow("(cross-mention — basename 이 '" + family + "')"));
    for (const h of crossHits) lines.push(renderHit(h));
  }

  const log = recentChanges(all.map(h => h.rel));
  if (log.length) {
    lines.push("");
    lines.push("  " + cyan("최근 변경 (git log -10):"));
    for (const ln of log) lines.push("    " + dim(ln));
  }

  lines.push("");
  lines.push("  " + green("사용 규칙:"));
  lines.push("    1. 같은 책무 모듈 있으면 import. 없을 때만 신설.");
  lines.push(`    2. 신설 시 \`lib/${family}-<책무>.mjs\` 또는 \`lib/${family}/<책무>.mjs\` (sisters 자동 발견).`);
  lines.push(`    3. PR template 'Sisters 점검' 체크박스 채움.`);
  lines.push("");
  return lines.join("\n");
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ─── main ──────────────────────────────────────────────
function main() {
  const positional = argv.filter(a => !a.startsWith("--"));
  const arg = (positional[0] || "all").toLowerCase();
  const families = discoverFamilies();
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");

  if (arg === "all") {
    if (!families.length) {
      console.log(red("(family 발견 안됨 — tools/lib 가 비어있음)"));
      return;
    }
    console.log(bold(cyan(`Lib Sisters — ${families.length} family`)));
    console.log(dim(`  (tools/lib 스캔, ${ts})`));
    console.log("");
    for (const f of families) {
      console.log(renderFamily(f));
    }
    console.log(dim(`회상: sisters <family>  (${families.join(" / ")})`));
    return;
  }

  console.log(renderFamily(arg));
  if (!families.includes(arg)) {
    console.log(dim(`발견된 family: ${families.join(", ") || "(없음)"}`));
  }
}

main();
