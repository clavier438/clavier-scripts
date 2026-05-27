// runner — claude CLI spawn (user only, system 슬롯 X), output 버전 자동 증가.
//
// 사용자 결정 2026-05-26: system 슬롯 폐기. 모든 텍스트 stdin (user) 으로.
// (memory/feedback_no_system_slot.md)

import { spawn } from "child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * output 디렉 안 기존 output_v<NN>.md 스캔 → 다음 빈 번호.
 *
 * @returns {{version, mdPath, promptPath}}
 */
export function nextVersion(outputDir, prefix = "output_v") {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)\\.md$`);
  let max = 0;
  for (const f of readdirSync(outputDir)) {
    const m = f.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  const v = String(max + 1).padStart(2, "0");
  return {
    version: `v${v}`,
    mdPath: join(outputDir, `${prefix}${v}.md`),
    promptPath: join(outputDir, `${prefix}${v}.prompt.md`),
    systemPath: join(outputDir, `${prefix}${v}.system.md`),
  };
}

/**
 * 실제 claude 에 들어간 user prompt 전문을 디스크에 떠둠 (재현·감사).
 */
export function savePrompt(promptPath, userPrompt, model) {
  writeFileSync(
    promptPath,
    `<!-- copy assembled prompt — ${new Date().toISOString()} -->\n<!-- model: ${model} -->\n\n${userPrompt}\n`,
  );
}

/**
 * system 슬롯 내역을 디스크에 저장 (감사·투명성).
 * --system-prompt "" 적용 시 = 빈 문자열 → 외부 압력 없음 명시.
 */
export function saveSystemPrompt(systemPath, systemPrompt, model) {
  const body = systemPrompt.trim()
    ? systemPrompt
    : "(시스템 프롬프트 없음 — --system-prompt \"\" 적용. 외부 컨텍스트 0.)";
  writeFileSync(
    systemPath,
    `<!-- copy system prompt — ${new Date().toISOString()} -->\n<!-- model: ${model} -->\n\n${body}\n`,
  );
}

/**
 * claude CLI spawn — system 슬롯 미사용. user prompt 만 stdin 으로.
 *
 * @returns {Promise<{result, usage, totalCostUsd, isError, errorMessage, elapsedSec}>}
 */
export function runClaude({
  userPrompt,
  model = "sonnet",
  outputFormat = "json",
  disallowedTools = "Bash Read Write Edit Glob Grep WebFetch WebSearch Task",
}) {
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      "--system-prompt", "",
      "--output-format", outputFormat,
      "--model", model,
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
    proc.stdin.write(userPrompt);
    proc.stdin.end();
  });
}

/**
 * 응답이 ``` 펜스로 감싸졌으면 벗기기.
 */
export function stripCodeFence(text) {
  let t = String(text || "").trim();
  const fence = t.match(/^```(?:markdown|md|json)?\s*([\s\S]+?)\s*```\s*$/);
  if (fence) t = fence[1].trim();
  return t;
}
