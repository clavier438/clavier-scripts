#!/usr/bin/env node
// door: airtable    # ← scripts 브리핑 자기등록 (SSOT=이 줄). 섹션 바꾸려면 여기만.
/**
 * airtableCtl — Airtable Upsert V6 인터랙티브 CLI
 *
 * 사용법:
 *   airtableCtl                    # 인터랙티브 모드 (workerCtl 같은 함수 메뉴)
 *   airtableCtl --help
 *
 * 시작 시 base + data_dir 컨텍스트 정함 → 함수 메뉴 루프 (dry-run, upsert, status, 컨텍스트 변경, exit).
 * Doppler 자동 self-relaunch — AIRTABLE_PAT 등 secret 자동 주입.
 * ~/.cache/clavier/airtable-ctl.json 에 최근 base/dir 저장.
 */

import "./lib/freshness.mjs"

import { createInterface } from 'readline';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { dirname, join, resolve, basename } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

import { createClient } from './lib/airtable-api.mjs';
import { executeUpsert } from './lib/airtable-upsert.mjs';
import { ensureDoppler } from './lib/doppler-wrap.mjs';
import { bold, dim, cyan, green, yellow, red, gray } from './lib/cli-color.mjs';
import { extractBaseId } from './lib/airtable-input.mjs';

const DOPPLER_PROJECT = 'clavier';
const DOPPLER_CONFIG = 'prd';

// ─────────────────────────── Doppler self-relaunch + ~/.clavier/env 폴백
// lib/doppler-wrap.mjs 가 두 단계 다 처리.
ensureDoppler({
  project: DOPPLER_PROJECT,
  config: DOPPLER_CONFIG,
  sentinelEnv: 'AIRTABLE_CTL_DOPPLER_INJECTED',
  fallbackEnvFile: '~/.clavier/env',
});

// ─────────────────────────── 경로 상수 (스크립트 위치 기준)
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPT_DIR);
const DATASETS_DIR = join(REPO_ROOT, 'datasets');

// 색상 helper 는 lib/cli-color.mjs 에서 import (상단)

// ─────────────────────────── readline
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(r => rl.question(q, ans => r(ans.trim())));

// ─────────────────────────── 최근 컨텍스트 저장
const CACHE_DIR = join(homedir(), '.cache', 'clavier');
const CACHE_FILE = join(CACHE_DIR, 'airtable-ctl.json');
function loadCache() {
  try { return JSON.parse(readFileSync(CACHE_FILE, 'utf8')); } catch { return { bases: [], dirs: [] }; }
}
function saveCache(cache) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}
function pushRecent(arr, item, max = 5) {
  const i = arr.indexOf(item);
  if (i >= 0) arr.splice(i, 1);
  arr.unshift(item);
  if (arr.length > max) arr.length = max;
}

// base ID 정규화는 lib/airtable-input.mjs 의 extractBaseId 사용 (상단 import)

// ─────────────────────────── help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
${bold('airtableCtl')} — Airtable Upsert V6 인터랙티브 CLI

${cyan('사용:')}
  airtableCtl

${cyan('흐름:')}
  1. base 선택 (recent 또는 URL/ID 입력)
  2. data_dir 선택 (recent 또는 경로 입력)
  3. 함수 메뉴:
     [1] dry-run preview
     [2] upsert 실행
     [3] base 상태 (테이블별 record 카운트)
     [4] base 변경
     [5] data_dir 변경
     [0] 종료

${cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}
${bold('  data_dir 프로토콜 — 엄격히 지켜야 idempotent 보장')}
${cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}

${cyan('1. 디렉토리 구조 (한 base = 한 폴더)')}

  <your-dir>/
    upsert.config.json    (선택, 없어도 default 안전)
    topics.csv             ← 파일명 stem = base 의 테이블명 (정확히 일치)
    tags.csv               ← 테이블별 1개씩
    items.csv
    subitems.csv

${cyan('2. CSV 헤더 — base 의 필드명 그대로')}

  base 에 "name" 컬럼이면 CSV 헤더도 "name".
  base 의 *모든* 컬럼 다 박을 필요 X — 채울 컬럼만.
  ${yellow('slugKey 컬럼은 반드시 포함 (영문 stable key)')}

${cyan('3. 컬럼별 셀 값 규칙')}

  필드 타입                       | CSV 셀 값
  ──────────────────────────────|─────────────────────────────
  텍스트/숫자/날짜/URL/이메일 등 | 값 그대로
  singleSelect                  | 옵션 이름 그대로 ("content")
  multipleSelects               | "|" 구분 ("a|b|c")
  checkbox                      | "true" / "false"
  ${yellow('multipleRecordLinks (link)')}    | ${yellow('target 테이블의 slugKey 들, "|" 구분')}
  attachments                   | URL 들, "|" 구분
  formula / lookup / autoNumber / rollup | ${gray('박지 마 (있어도 자동 skip)')}
  빈 셀                         | 변경 안 함 (기존 값 유지)

${cyan('4. matchKey (slugKey) — 동일 input → 동일 결과의 핵심')}

  • 영문 stable key. 절대 변하지 X (예: "room_sea_low", "tag_food")
  • 같은 slugKey 면 ${green('update')}, 없으면 ${green('create')}
  • base 에 slugKey field 없으면 V6 가 자동 생성 (한 번만)

${cyan('5. link 컬럼 예시 (items.csv 의 topic + tags)')}

  ${gray('slugKey,name,topic,tags')}
  ${gray('room_sea_low,바다 숨소리가 가까운 방,rooms,season-spring|theme-sea')}
                                ${yellow('↑ target=topics')}      ${yellow('↑ target=tags, 다중 = "|"')}

${cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}

${cyan('한 줄 요약:')}
  "base 컬럼 그대로 헤더에 박고 행만 채움"
   + slugKey 컬럼 필수
   + link 컬럼은 target slugKey, "|" 구분
`);
  process.exit(0);
}

// ─────────────────────────── 컨텍스트 선택
async function chooseBase(cache) {
  while (true) {
    console.log(`\n${bold('── base 선택 ──')}`);
    if (cache.bases.length) {
      cache.bases.forEach((b, i) => console.log(`  ${cyan(`[${i + 1}]`)} ${b}`));
    }
    console.log(`  ${cyan('[n]')} 새 base (URL 또는 appXXX 입력)`);
    console.log(`  ${cyan('[0]')} 종료`);
    const ans = await ask(`${gray('> ')}`);
    if (ans === '0') return null;
    if (ans === 'n' || !ans) {
      const input = await ask(`${gray('URL 또는 base ID: ')}`);
      const id = extractBaseId(input);
      if (!id) { console.log(red(`base ID 추출 실패 (appXXX 형식 필요)`)); continue; }
      return id;
    }
    const n = parseInt(ans, 10);
    if (n >= 1 && n <= cache.bases.length) return cache.bases[n - 1];
    console.log(red(`잘못된 선택`));
  }
}

async function chooseDir(cache) {
  // datasets/ 하위 폴더 목록 (있으면)
  const datasetSubs = existsSync(DATASETS_DIR)
    ? readdirSync(DATASETS_DIR).filter(n => statSync(join(DATASETS_DIR, n)).isDirectory())
    : [];

  while (true) {
    console.log(`\n${bold('── data_dir 선택 ──')}  ${dim(`base: ${REPO_ROOT}`)}`);

    // datasets/ 하위 폴더 (d1, d2, ...)
    if (datasetSubs.length) {
      datasetSubs.forEach((name, i) => console.log(`  ${cyan(`[d${i + 1}]`)} datasets/${name}`));
    }

    // 최근 사용 디렉토리
    if (cache.dirs.length) {
      cache.dirs.forEach((d, i) => {
        const exists = existsSync(d);
        console.log(`  ${cyan(`[${i + 1}]`)} ${d} ${exists ? '' : red('(없음)')}`);
      });
    }

    console.log(`  ${cyan('[n]')} 경로 입력 ${gray(`(상대경로는 ${REPO_ROOT} 기준)`)}`);
    console.log(`  ${cyan('[0]')} 종료`);
    const ans = await ask(`${gray('> ')}`);
    if (ans === '0') return null;

    // datasets/ 하위 폴더 선택
    const dm = ans.match(/^d(\d+)$/i);
    if (dm) {
      const idx = parseInt(dm[1], 10) - 1;
      if (idx >= 0 && idx < datasetSubs.length) return join(DATASETS_DIR, datasetSubs[idx]);
      console.log(red(`잘못된 선택`)); continue;
    }

    if (ans === 'n' || !ans) {
      const input = await ask(`${gray('경로: ')}`);
      let rawPath = input.trim();
      if ((rawPath.startsWith("'") && rawPath.endsWith("'")) || (rawPath.startsWith('"') && rawPath.endsWith('"'))) rawPath = rawPath.slice(1, -1);
      rawPath = rawPath.replace(/\\ /g, ' ').replace(/^~/, homedir());
      // 상대경로는 REPO_ROOT 기준으로 resolve
      const dir = rawPath.startsWith('/') ? rawPath : resolve(REPO_ROOT, rawPath);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) { console.log(red(`디렉토리 없음: ${dir}`)); continue; }
      return dir;
    }

    const n = parseInt(ans, 10);
    if (n >= 1 && n <= cache.dirs.length && existsSync(cache.dirs[n - 1])) return cache.dirs[n - 1];
    console.log(red(`잘못된 선택`));
  }
}

// ─────────────────────────── 기능 함수
async function actionDryRun(api, baseId, dataDir, extend) {
  console.log(`\n${bold('── DRY-RUN ──')}  ${dim(`base=${baseId} dir=${basename(dataDir)} mode=${extend ? 'extend' : 'strict'}`)}`);
  await runUpsert(api, baseId, dataDir, { dryRun: true, extend });
}

async function actionUpsert(api, baseId, dataDir, extend) {
  console.log(`\n${bold('── UPSERT (LIVE) ──')}  ${dim(`base=${baseId} dir=${basename(dataDir)} mode=${extend ? 'extend' : 'strict'}`)}`);
  const confirm = await ask(`${yellow('정말 실행할까? (y/N): ')}`);
  if (confirm.toLowerCase() !== 'y') { console.log(gray(`취소`)); return; }
  await runUpsert(api, baseId, dataDir, { dryRun: false, extend });
}

// runUpsert orchestration → lib/airtable-upsert.mjs `executeUpsert` 로 이동 (family 모듈화, copy.mjs 도 사용).
async function runUpsert(api, baseId, dataDir, opts) {
  return executeUpsert(api, baseId, dataDir, opts);
}

async function actionStatus(api, baseId) {
  console.log(`\n${bold('── base 상태 ──')}  ${dim(baseId)}`);
  const sch = await api.getSchema(baseId);
  for (const t of sch.tables) {
    const recs = await api.listRecords(baseId, t.id, { fields: [] });
    console.log(`  ${cyan(t.name.padEnd(16))} ${recs.length.toString().padStart(4)} records ${gray(`${t.fields.length} fields  ${t.id}`)}`);
  }
}

// ─────────────────────────── main
async function main() {
  const pat = process.env.AIRTABLE_PAT;
  if (!pat) { console.error(red('AIRTABLE_PAT 없음 — Doppler 또는 ~/.clavier/env 확인')); process.exit(1); }
  const api = createClient(pat);

  const cache = loadCache();
  let baseId = await chooseBase(cache);
  if (!baseId) { rl.close(); return; }
  let dataDir = await chooseDir(cache);
  if (!dataDir) { rl.close(); return; }

  pushRecent(cache.bases, baseId);
  pushRecent(cache.dirs, dataDir);
  saveCache(cache);

  let extend = false;  // mode: strict (default) ↔ extend

  while (true) {
    console.log(`\n${bold('━━━ airtableCtl ━━━')}`);
    console.log(`  ${dim('base: ')} ${cyan(baseId)}`);
    console.log(`  ${dim('dir:  ')} ${cyan(dataDir)}`);
    console.log(`  ${dim('mode: ')} ${extend ? yellow('extend (새 field 자동 생성)') : cyan('strict (안전)')}`);
    console.log(``);
    console.log(`  ${cyan('[1]')} dry-run preview`);
    console.log(`  ${cyan('[2]')} upsert 실행 ${yellow('(live)')}`);
    console.log(`  ${cyan('[3]')} base 상태 (record count)`);
    console.log(`  ${cyan('[4]')} base 변경`);
    console.log(`  ${cyan('[5]')} data_dir 변경`);
    console.log(`  ${cyan('[m]')} mode toggle ${gray('(strict ↔ extend)')}`);
    console.log(`  ${cyan('[0]')} 종료`);
    const ans = await ask(`${gray('> ')}`);
    try {
      if (ans === '0' || ans === 'q' || ans === 'exit') break;
      else if (ans === '1') await actionDryRun(api, baseId, dataDir, extend);
      else if (ans === '2') await actionUpsert(api, baseId, dataDir, extend);
      else if (ans === '3') await actionStatus(api, baseId);
      else if (ans === '4') { const b = await chooseBase(cache); if (b) { baseId = b; pushRecent(cache.bases, b); saveCache(cache); } }
      else if (ans === '5') { const d = await chooseDir(cache); if (d) { dataDir = d; pushRecent(cache.dirs, d); saveCache(cache); } }
      else if (ans === 'm') { extend = !extend; console.log(`  mode → ${extend ? yellow('extend') : cyan('strict')}`); }
      else console.log(red(`잘못된 선택: ${ans}`));
    } catch (e) {
      console.log(red(`\n에러: ${e.message}`));
      if (process.env.DEBUG) console.log(gray(e.stack));
    }
  }
  rl.close();
}

main().catch(e => { console.error(red(e.message)); process.exit(1); });
