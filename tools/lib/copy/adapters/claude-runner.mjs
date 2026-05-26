// Adapter — Claude CLI 호출 + 트리 echo + 버전 저장 + 어체 락 자동 주입.
// 3 도구(copyMd/copyDraft/copyGen)의 공통 호출 자리. 한 번 고치면 셋 다 자동 반영.

import { spawn } from "child_process";
import { existsSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { bold, dim, cyan, green, gray } from "../../cli-color.mjs";
import { toneLockRules } from "../domain/tone-lock.mjs";

// ── 파일 메타 / 경로 단축
export function fileMeta(content) {
  const lines = content.split("\n").length;
  const bytes = Buffer.byteLength(content, "utf8");
  const m = content.match(/^#{1,2} (.+)$/m);
  return { lines, bytes, headline: m ? m[1].trim() : "" };
}

export function fmtSize(lines, bytes) {
  return `${lines}줄·${bytes}B`;
}

export function shortPath(p, anchors = {}) {
  const { folder, home = homedir() } = anchors;
  if (folder && p.startsWith(folder + "/")) return p.slice(folder.length + 1);
  if (p.startsWith(home)) return "~" + p.slice(home.length);
  return p;
}

// ── 버전 자동 증가 (output_v01.md, output_v02.md, ...)
export function nextVersionPaths(dir, prefix = "output_v") {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)\\.md$`);
  let max = 0;
  for (const f of readdirSync(dir)) {
    const m = f.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  const v = String(max + 1).padStart(2, "0");
  return {
    version: `v${v}`,
    mdPath: join(dir, `${prefix}${v}.md`),
    promptPath: join(dir, `${prefix}${v}.prompt.md`),
  };
}

// ── 어체 락 자동 주입 (중복 방지)
export function appendToneLock(system) {
  if (system.includes("[어체 락")) return system;
  return system.trimEnd() + "\n\n" + toneLockRules() + "\n";
}

// ── 합쳐진 프롬프트를 디스크에 떠두기 (재현/감사용)
export function assemblePromptFile({ system, user, model }) {
  return `<!-- copy-runner assembled prompt — ${new Date().toISOString()} -->
<!-- model: ${model} -->

# ===== SYSTEM =====

${system}

# ===== USER =====

${user}
`;
}

// ── 트리 echo — 각 폴더/자료가 어떻게 AI 로 전달되는지 말로 노출
export function printPromptTree({
  outputPath,
  promptPath,
  version,
  folder,
  layers,
  contextFiles,
  instruction,
  schemaSummary,
  modelRecordsSummary,
  model,
  sysBytes,
  userBytes,
}) {
  const totalBytes = sysBytes + userBytes;
  const anchors = { folder };

  console.log();
  console.log(bold(`▶ 이번에 AI 에게 어떻게 전달되는가  ${dim(version + " → " + shortPath(outputPath, anchors))}`));
  console.log();
  console.log(`  ${bold("● AI 의 인격에 박는 부분 (시스템)")}  ${dim(`총 ${sysBytes}B`)}`);
  console.log(dim(`     AI 가 답을 만들기 전에 먼저 읽고 자기 안에 새기는 부분입니다.`));
  printLayer("Layer 1", "이 폴더 안 마크다운 파일들이 전부 이어져서, AI 가 어떤 카피든 깨면 안 되는 원리로 먼저 박힙니다.", layers?.layer1, anchors);
  printLayer("Layer 2", "이 폴더 안 파일들이 이어져서, AI 가 따라야 할 말투·톤 레퍼런스로 그 뒤에 박힙니다.", layers?.layer2, anchors);
  printLayer("Layer 3", "이 폴더 안 파일들이 이어져서, 섹션별 골격이 있다면 그 뒤에 박힙니다.", layers?.layer3, anchors);
  console.log();
  console.log(`  ${bold("● 이번 작업으로 같이 보내는 부분 (사용자)")}  ${dim(`총 ${userBytes}B`)}`);
  if (contextFiles && contextFiles.length > 0) {
    console.log(`  │  ${gray("inputs/ 폴더 안 .md 만 '참고 자료' 로 묶여 들어갑니다. 파일마다 파일 이름이 머리에 붙습니다.")}`);
    contextFiles.forEach(f => {
      const m = fileMeta(f.content);
      console.log(`  │     • ${shortPath(f.path, anchors)}  ${dim(`(${fmtSize(m.lines, m.bytes)})`)}`);
    });
  }
  if (schemaSummary) {
    console.log(`  │`);
    console.log(`  │  ${gray("Airtable 스키마가 함께 들어갑니다 (어느 테이블·어느 필드를 채워야 하는지 알리는 자리입니다).")}`);
    console.log(`  │     • ${schemaSummary}`);
  }
  if (modelRecordsSummary) {
    console.log(`  │`);
    console.log(`  │  ${gray("모델로 삼는 reference Airtable 의 records 가 함께 들어갑니다 (IA 또는 IA+컨텐츠 학습용입니다).")}`);
    console.log(`  │     • ${modelRecordsSummary}`);
  }
  if (instruction) {
    const prev = instruction.length > 80 ? instruction.slice(0, 80) + "…" : instruction;
    console.log(`  │`);
    console.log(`  │  ${gray("이번 한 줄 지시 (-i 로 박은 문장 그대로) 가 '즉시 지시' 로 붙습니다.")}`);
    console.log(`  │     "${prev}"`);
  }
  console.log();
  console.log(`  ${dim("시스템 + 사용자 전문을 디스크에 그대로 떠둡니다 (다음에 다시 보고 싶을 때):")}`);
  console.log(`     ${shortPath(promptPath, anchors)}`);
  console.log();
  console.log(`  ${dim(`그리고 같은 전문을 ${model} 모델 claude 에 통째로 넘깁니다. 총 ${totalBytes}B.`)}`);
  console.log();
}

function printLayer(label, sentence, layer, anchors) {
  if (!layer) {
    console.log(`  │  ${label}  ${dim("폴더 없음 — 비워서 보냅니다.")}`);
    return;
  }
  console.log(`  │  ${label}  ${gray(sentence)}`);
  console.log(`  │     ${dim("위치: " + shortPath(layer.dir, anchors))}`);
  layer.items.forEach(it => {
    const m = fileMeta(it.content);
    console.log(`  │     • ${it.name}  ${dim(`(${fmtSize(m.lines, m.bytes)})`)}`);
  });
}

// ── claude CLI 호출
/**
 * @returns {Promise<{result, usage, totalCostUsd, isError, errorMessage, elapsedSec}>}
 */
export function runClaude({
  system,
  user,
  model,
  disallowedTools = "Bash Read Write Edit Glob Grep WebFetch WebSearch Task",
  outputFormat = "json",
}) {
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      "--output-format", outputFormat,
      "--model", model,
      "--system-prompt", system,
      "--disallowed-tools", disallowedTools,
    ];
    const t0 = Date.now();
    const proc = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    proc.stdout.on("data", d => stdout += d);
    proc.stderr.on("data", d => stderr += d);
    proc.on("error", reject);
    proc.on("exit", code => {
      const elapsedSec = (Date.now() - t0) / 1000;
      if (code !== 0) return reject(new Error(`claude exit ${code}\n${stderr}`));
      if (outputFormat === "json") {
        try {
          const result = JSON.parse(stdout);
          resolve({
            result: String(result.result || ""),
            usage: result.usage || {},
            totalCostUsd: result.total_cost_usd || 0,
            isError: result.is_error || false,
            errorMessage: result.is_error ? (result.result || result.subtype) : null,
            elapsedSec,
          });
        } catch (e) {
          reject(new Error(`claude JSON 파싱 실패: ${e.message}\nstdout snippet: ${stdout.slice(0, 200)}`));
        }
      } else {
        resolve({ result: stdout, usage: {}, totalCostUsd: 0, isError: false, elapsedSec });
      }
    });
    proc.stdin.write(user);
    proc.stdin.end();
  });
}

export function logClaudeResult(r) {
  const u = r.usage || {};
  console.log(
    green(`✓ Claude`) +
      dim(`  ${r.elapsedSec.toFixed(1)}s, ${u.input_tokens ?? "?"}in/${u.output_tokens ?? "?"}out, cost $${r.totalCostUsd.toFixed(4)}`)
  );
}

// ── 응답이 ``` 펜스로 감싸졌으면 벗기기
export function stripCodeFence(text) {
  let t = String(text || "").trim();
  const fence = t.match(/^```(?:markdown|md|json)?\s*([\s\S]+?)\s*```\s*$/);
  if (fence) t = fence[1].trim();
  return t;
}

// ── 한 번에 — 합쳐진 프롬프트 저장 + 트리 echo + claude 호출 + 결과 로그
// use case 가 outputPath/promptPath/version 을 먼저 정한 뒤 호출. 책임 분리.
/**
 * @returns {Promise<{claudeResult, mdPath, promptPath, version}>}
 */
export async function runWithPaths({
  mdPath,          // 결정된 .md 경로 (resolveOutputPaths/nextVersionPaths 반환 키)
  promptPath,
  version,
  folder,
  systemPrompt,
  userPrompt,
  model,
  layers,
  contextFiles,
  instruction,
  schemaSummary,
  modelRecordsSummary,
  disallowedTools,
  outputFormat = "json",
  applyToneLock = true,
}) {
  const sys = applyToneLock ? appendToneLock(systemPrompt) : systemPrompt;
  // 합쳐진 프롬프트 먼저 디스크에 — claude 호출 실패해도 입력은 남음
  writeFileSync(promptPath, assemblePromptFile({ system: sys, user: userPrompt, model }));

  const sysBytes = Buffer.byteLength(sys, "utf8");
  const userBytes = Buffer.byteLength(userPrompt, "utf8");

  printPromptTree({
    outputPath: mdPath, promptPath, version, folder,
    layers, contextFiles, instruction,
    schemaSummary, modelRecordsSummary,
    model, sysBytes, userBytes,
  });

  console.log(dim(`→ claude CLI (${model}, 사용자 구독) 호출 중...`));
  const claudeResult = await runClaude({
    system: sys,
    user: userPrompt,
    model,
    disallowedTools,
    outputFormat,
  });
  logClaudeResult(claudeResult);

  if (claudeResult.isError) {
    throw new Error(`claude 응답 에러: ${claudeResult.errorMessage}`);
  }

  return { claudeResult, mdPath, promptPath, version };
}

/**
 * 경로 결정 헬퍼 — outputArg 있으면 그대로, 없으면 outputDir 안 다음 빈 번호.
 * @returns {{version, mdPath, promptPath}}
 */
export function resolveOutputPaths({ outputArg, outputDir, prefix = "output_v" }) {
  if (outputArg) {
    return {
      version: "(--output)",
      mdPath: outputArg,
      promptPath: outputArg.replace(/\.md$/, "") + ".prompt.md",
    };
  }
  return nextVersionPaths(outputDir, prefix);
}
