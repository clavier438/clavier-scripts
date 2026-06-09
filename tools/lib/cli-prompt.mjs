// cli-prompt.mjs — workerCtl 스타일 인터랙티브 프롬프트 (싱글톤 readline).
//
// copy/menu.mjs 가 내부에 박아둔 readline 싱글톤 + selectNumber 패턴을 공유 lib 로 추출.
// 사용처: lut/menu.mjs, copy/menu.mjs (둘 다 여기서 import — 자체 구현 없음).
//
// 싱글톤인 이유: `.question()` 은 매번 1회용 listener 등록 — 데이터가 미리 도착하면
// line 이 버려짐 (특히 piped stdin). 'line' 이벤트로 항상 큐에 쌓고, ask 는 큐 dequeue.

import { createInterface } from "readline";
import { bold, dim, red, gray } from "./cli-color.mjs";

let _rl = null;
const _lineQueue = [];
const _waiters = [];
let _closed = false;

function ensureRl() {
  if (_rl) return _rl;
  _rl = createInterface({ input: process.stdin, output: process.stdout });
  _rl.on("line", line => {
    if (_waiters.length) _waiters.shift()(line);
    else _lineQueue.push(line);
  });
  _rl.on("close", () => {
    _closed = true;
    while (_waiters.length) _waiters.shift()(null);
  });
  return _rl;
}

/** 한 줄 입력. EOF 시 null. */
export function ask(q) {
  ensureRl();
  process.stdout.write(q);
  return new Promise(resolve => {
    if (_lineQueue.length) return resolve(_lineQueue.shift().trim());
    if (_closed) return resolve(null);
    _waiters.push(line => resolve(line === null ? null : line.trim()));
  });
}

/** readline 닫기 — 메뉴 루프 종료 직전 호출 (안 하면 프로세스가 안 끝남). */
export function closeAsk() { if (_rl) { _rl.close(); _rl = null; } }

/**
 * 1~items.length 중 한 번호 입력. 0/q/exit/EOF → null.
 * @param {Array} items
 * @param {(item)=>string} labelFn
 */
export async function selectNumber(items, labelFn) {
  items.forEach((item, i) => {
    console.log(`  ${bold(String(i + 1).padStart(2))}. ${labelFn(item)}`);
  });
  console.log();
  while (true) {
    const input = await ask(`${gray("선택 (1-" + items.length + ", 0=종료): ")}`);
    if (input === null || input === "0" || input === "q" || input === "exit") return null;
    const n = parseInt(input, 10);
    if (n >= 1 && n <= items.length) return items[n - 1];
    console.log(red(`  ✗ 1~${items.length} 또는 0 입력`));
  }
}

/** y/N 확인 — 위험한 작업 직전. */
export async function confirm(message) {
  const a = await ask(`${message} ${dim("[y/N]:")} `);
  if (a === null) return false;
  return a.toLowerCase() === "y" || a.toLowerCase() === "yes";
}
