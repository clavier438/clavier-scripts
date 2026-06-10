#!/usr/bin/env node
// door: system    # ← scripts 브리핑 자기등록 (SSOT=이 줄). 섹션 바꾸려면 여기만.
/**
 * hooks — 등록된 모든 훅을 한눈에 + 간단히 on/off.
 *
 * 정신: 훅 = 파일 하나. *위치가 곧 등록* (SvelteKit 정신 — bootstrap.sh Step 5 가
 * tools/claude-hooks/ 폴더를 walk 해 settings.json 을 생성). 마커도 manifest 도 없다.
 * 그래서 "끈다" = 파일을 _disabled/ 로 옮긴다, 그뿐. 이 도구는 그걸 보이게+쉽게 해줄 뿐.
 *
 * 훅 3종:
 *   tools/claude-hooks/*.agent-*.md   → Claude agent 훅 (별도 Claude 가 행동 검사)
 *   tools/claude-hooks/*.sh           → Claude shell 훅 (컨텍스트 주입·라우팅)
 *   hooks/*                           → git 훅 (commit/merge 시점)
 *   tools/claude-hooks/_disabled/*    → 꺼둔 것 (어느 종류든)
 *
 * 사용:
 *   hooks              전체 목록 (상태 🟢/🔴 + 한 줄 설명 + 끄는 법)
 *   hooks off <이름>   끄기 (_disabled/ 로 이동 + bootstrap ensure 로 settings.json 재생성)
 *   hooks on  <이름>   켜기 (되돌리기 + bootstrap ensure)
 *
 * git 훅(pre-commit 등)은 SSOT 강제 장치라 이 도구로 끄지 않는다 (목록에만 보임).
 */

import "./lib/freshness.mjs";

import { readdirSync, existsSync, readFileSync, renameSync, mkdirSync, statSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { bold, dim, cyan, green, red, yellow } from "./lib/cli-color.mjs";
import { findClavierHq } from "./lib/repoPaths.mjs";

const TOOLS = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TOOLS, "..");
const CH = join(TOOLS, "claude-hooks");
const DIS = join(CH, "_disabled");
const GIT = join(ROOT, "hooks");

// ── 한 줄 설명 추출 — 첫 마크다운/주석 헤딩 (shebang 제외) ──
function describe(file) {
  try {
    for (const line of readFileSync(file, "utf8").split("\n").slice(0, 15)) {
      const m = line.match(/^#+\s+(.+)/); // '# heading' 또는 '## ...' (shebang '#!' 은 \s 없어 불일치)
      if (m) return m[1].replace(/\(agent hook\)/i, "").trim().slice(0, 78);
    }
  } catch {}
  return dim("(설명 없음)");
}

// agent 훅 표시명: pre-tool-use.agent-reference-class.md → reference-class
const agentLabel = (f) => f.replace(/\.md$/, "").split(".agent-")[1] ?? f.replace(/\.md$/, "");
// shell 훅 표시명: pre-tool-use.sh → pre-tool-use
const shellLabel = (f) => f.replace(/\.sh$/, "");

function lsSafe(dir, pred) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => { try { return statSync(join(dir, f)).isFile() && pred(f); } catch { return false; } });
}

// ── 수집 ──
function collect() {
  const activeAgent = lsSafe(CH, (f) => /\.agent-.+\.md$/.test(f));
  const activeShell = lsSafe(CH, (f) => /\.sh$/.test(f));
  const disabled = lsSafe(DIS, (f) => /\.(md|sh)$/.test(f));
  const gitHooks = lsSafe(GIT, (f) => !f.endsWith(".sample"));
  return { activeAgent, activeShell, disabled, gitHooks };
}

// ── 목록 출력 ──
function list() {
  const { activeAgent, activeShell, disabled, gitHooks } = collect();
  console.log();
  console.log(bold("훅 — 위치가 곧 등록. 파일 하나 = 훅 하나."));
  console.log(dim(`정의: tools/claude-hooks/  ·  git: hooks/  ·  꺼둔 것: _disabled/`));

  const row = (on, name, file, dir) =>
    `  ${on ? green("🟢") : red("🔴")} ${(on ? bold(name) : dim(name)).padEnd(on ? 30 : 22)} ${dim(describe(join(dir, file)))}`;

  console.log("\n" + cyan("  ▸ Claude agent 훅 ") + dim("(별도 Claude 인스턴스가 행동 검사 — deny 가능)"));
  for (const f of activeAgent.sort()) console.log(row(true, agentLabel(f), f, CH));
  for (const f of disabled.filter((f) => f.includes(".agent-")).sort())
    console.log(row(false, agentLabel(f), f, DIS) + dim("  ← _disabled/"));

  console.log("\n" + cyan("  ▸ Claude shell 훅 ") + dim("(컨텍스트 주입·라우팅 — 빠름)"));
  for (const f of activeShell.sort()) console.log(row(true, shellLabel(f), f, CH));
  for (const f of disabled.filter((f) => f.endsWith(".sh")).sort())
    console.log(row(false, shellLabel(f), f, DIS) + dim("  ← _disabled/"));

  console.log("\n" + cyan("  ▸ git 훅 ") + dim("(SSOT 강제 — 이 도구로 끄지 않음, 목록만)"));
  for (const f of gitHooks.sort()) console.log(row(true, f, f, GIT));

  console.log("\n" + dim("  끄기: ") + bold("hooks off <이름>") + dim("    켜기: ") + bold("hooks on <이름>"));
  console.log(dim("  (예: hooks off before-action)\n"));
}

// ── bootstrap ensure (settings.json 재생성) ──
function reensure() {
  const hq = findClavierHq();
  const boot = hq && join(hq, "bootstrap.sh");
  if (!boot || !existsSync(boot)) {
    console.log(yellow(`  ⚠ clavier-hq/bootstrap.sh 못 찾음 — settings.json 수동 재생성 필요`));
    return;
  }
  process.stdout.write(dim("  bootstrap ensure (settings.json 재생성)... "));
  execFileSync("bash", [boot, "ensure"], { stdio: ["ignore", "ignore", "ignore"] });
  console.log(green("done"));
}

// ── 이름으로 활성/비활성 훅 파일 찾기 ──
function findIn(dir, name) {
  const files = lsSafe(dir, (f) => /\.(md|sh)$/.test(f));
  // 정확한 라벨 우선, 없으면 부분일치
  return (
    files.find((f) => agentLabel(f) === name || shellLabel(f) === name) ||
    files.find((f) => f.includes(name))
  );
}

function toggle(dir, name, on) {
  const src = findIn(dir, name);
  if (!src) {
    console.log(red(`  ✗ ${on ? "꺼진" : "켜진"} 훅에서 '${name}' 못 찾음.`) + dim(" hooks 로 목록 확인."));
    process.exit(1);
  }
  if (src.endsWith(".sh") && /post-commit|pre-commit|post-merge/.test(src)) {
    console.log(yellow(`  ⚠ git 훅은 SSOT 강제라 이 도구로 토글 안 함.`));
    process.exit(1);
  }
  if (on) mkdirSync(CH, { recursive: true });
  else mkdirSync(DIS, { recursive: true });
  const from = join(dir, src);
  const to = join(on ? CH : DIS, src);
  renameSync(from, to);
  console.log((on ? green("  🟢 켬: ") : red("  🔴 끔: ")) + bold(agentLabel(src)) + dim(`  (${src})`));
  reensure();
  console.log(dim(`  ↩ 되돌리기: hooks ${on ? "off" : "on"} ${name}`));
}

// ── CLI ──
const [cmd, name] = process.argv.slice(2);
if (!cmd) list();
else if (cmd === "off") name ? toggle(CH, name, false) : console.log(red("사용: hooks off <이름>"));
else if (cmd === "on") name ? toggle(DIS, name, true) : console.log(red("사용: hooks on <이름>"));
else if (["-h", "--help", "help"].includes(cmd)) list();
else console.log(red(`알 수 없는 명령: ${cmd}`) + dim("  — hooks / hooks off <이름> / hooks on <이름>"));
