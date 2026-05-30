// runner — claude CLI spawn (멀티턴 세션, system 슬롯 X), 산출물 번호 자동 증가.
//
// 사용자 결정 2026-05-26: system 슬롯 폐기. 모든 텍스트 stdin (user) 으로.
// 사용자 결정 2026-05-29: 한 번 쏘고 끝(one-shot) 폐기. --session-id 로 세션 만들고
//   --resume 로 이어가는 대화형. 컨텍스트는 claude 가 서버측 유지 (매 턴 재주입 X).
// (memory/feedback_no_system_slot.md, feedback_single_solution.md)

import { spawn } from "child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/**
 * output 디렉 안 기존 <prefix><NN>... 스캔 → 다음 빈 번호 경로.
 * session_v / output_v 등 어떤 prefix·확장자든 공용.
 *
 * @returns {{version: string, path: string}}
 */
export function nextNumbered(outputDir, prefix, ext = ".md") {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escaped}(\\d+)`);
  let max = 0;
  for (const f of readdirSync(outputDir)) {
    const m = f.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  const v = String(max + 1).padStart(2, "0");
  return { version: `v${v}`, path: join(outputDir, `${prefix}${v}${ext}`) };
}

/**
 * 세션 1턴째에 들어간 전체 컨텍스트(input/ + base들 + 여는 지시)를 떠둠 (재현·감사).
 */
export function savePrompt(promptPath, userPrompt, model) {
  writeFileSync(
    promptPath,
    `<!-- copy session context — ${new Date().toISOString()} -->\n<!-- model: ${model} -->\n\n${userPrompt}\n`,
  );
}

/**
 * 전사(transcript) 파일에 한 덩이 append. 매 턴 즉시 호출 → 중간에 죽어도 안 날아감.
 * "현재상태를 손으로 쓰는" 게 아니라 일어나는 대로 생성 → drift 불가.
 */
export function appendTranscript(sessionPath, text) {
  appendFileSync(sessionPath, text);
}

/**
 * claude CLI spawn — 멀티턴.
 *   resume=false → `--session-id <id> --system-prompt ""` 로 세션 생성 (1턴째, 전체 컨텍스트)
 *   resume=true  → `--resume <id>` 로 이어감 (이후 턴, 사용자 한 줄만)
 * sessionId 없으면 세션 플래그 없이 one-shot (하위호환).
 *
 * @returns {Promise<{result, usage, totalCostUsd, isError, errorMessage, elapsedSec}>}
 */
export function runClaude({
  userPrompt,
  model = "sonnet",
  sessionId = null,
  resume = false,
  outputFormat = "json",
  disallowedTools = "Bash Read Write Edit Glob Grep WebFetch WebSearch Task",
}) {
  return new Promise((resolve, reject) => {
    const args = ["-p"];
    if (sessionId && resume) {
      args.push("--resume", sessionId);
    } else if (sessionId) {
      args.push("--session-id", sessionId, "--system-prompt", "");
    } else {
      args.push("--system-prompt", "");
    }
    args.push(
      "--output-format", outputFormat,
      "--model", model,
      "--disallowed-tools", disallowedTools,
    );
    const t0 = Date.now();
    // 중립 cwd 에서 spawn — repo CLAUDE.md / auto-memory / project hooks 자동 로드 차단.
    // "외부 컨텍스트 0, 순수 user prompt" 철학 그대로 + 매 턴 부팅 비용·지연 제거.
    // (--bare 가 정석이나 OAuth 구독을 깸 → API 키 필요. cwd 중립화로 우회.)
    const proc = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"], cwd: tmpdir() });
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
  const fence = t.match(/^```(?:markdown|md|json|csv)?\s*([\s\S]+?)\s*```\s*$/);
  if (fence) t = fence[1].trim();
  return t;
}
