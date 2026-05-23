#!/usr/bin/env node
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
import { execSync, spawnSync } from 'child_process';
import { dirname, join, resolve, basename } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

import { createClient } from './lib/airtable-api.mjs';
import {
  loadDataDir, analyzeSchema, transformRow,
  pass1Upsert, pass2Links, ensureMatchKeyField,
} from './lib/airtable-upsert.mjs';

const DOPPLER_PROJECT = 'clavier';
const DOPPLER_CONFIG = 'prd';

// ─────────────────────────── Doppler self-relaunch
if (!process.env.AIRTABLE_CTL_DOPPLER_INJECTED) {
  let dopplerOk = false;
  try { execSync('doppler --version', { stdio: 'ignore', timeout: 2000 }); dopplerOk = true; } catch {}
  if (dopplerOk) {
    const r = spawnSync('doppler',
      ['run', '--project', DOPPLER_PROJECT, '--config', DOPPLER_CONFIG, '--',
       process.execPath, ...process.argv.slice(1)],
      { stdio: 'inherit', env: { ...process.env, AIRTABLE_CTL_DOPPLER_INJECTED: '1' } });
    if (!r.error) process.exit(r.status ?? 0);
  }
}
// ~/.clavier/env 폴백
try {
  const envFile = join(homedir(), '.clavier', 'env');
  readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) return;
    const [k, ...rest] = line.split('=');
    const key = k.trim(); let val = rest.join('=').trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  });
} catch {}

// ─────────────────────────── 색상
const c = { reset:'\x1b[0m', bold:'\x1b[1m', dim:'\x1b[2m', cyan:'\x1b[36m', green:'\x1b[32m', yellow:'\x1b[33m', red:'\x1b[31m', gray:'\x1b[90m' };
const bold = s => `${c.bold}${s}${c.reset}`;
const dim = s => `${c.dim}${s}${c.reset}`;
const cyan = s => `${c.cyan}${s}${c.reset}`;
const green = s => `${c.green}${s}${c.reset}`;
const yellow = s => `${c.yellow}${s}${c.reset}`;
const red = s => `${c.red}${s}${c.reset}`;
const gray = s => `${c.gray}${s}${c.reset}`;

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

// ─────────────────────────── base ID 정규화
function extractBaseId(input) {
  const m = String(input).match(/\bapp[A-Za-z0-9]{14}\b/);
  return m ? m[0] : null;
}

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
  const cwd = process.cwd();
  while (true) {
    console.log(`\n${bold('── data_dir 선택 ──')}  ${dim(cwd)}`);
    console.log(`  ${cyan('[.]')} 현재 디렉토리`);
    if (cache.dirs.length) {
      cache.dirs.forEach((d, i) => {
        const exists = existsSync(d);
        console.log(`  ${cyan(`[${i + 1}]`)} ${d} ${exists ? '' : red('(없음)')}`);
      });
    }
    console.log(`  ${cyan('[n]')} 경로 입력 ${gray('(절대 · 상대 · ~ 모두 가능)')}`);
    console.log(`  ${cyan('[0]')} 종료`);
    const ans = await ask(`${gray('> ')}`);
    if (ans === '0') return null;
    if (ans === '.') return cwd;
    if (ans === 'n' || !ans) {
      const input = await ask(`${gray('경로: ')}`);
      let rawPath = input.trim();
      if ((rawPath.startsWith("'") && rawPath.endsWith("'")) || (rawPath.startsWith('"') && rawPath.endsWith('"'))) rawPath = rawPath.slice(1, -1);
      rawPath = rawPath.replace(/\\ /g, ' ').replace(/^~/, homedir());
      const dir = resolve(rawPath);
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

async function runUpsert(api, baseId, dataDir, opts) {
  const { config, tables: data } = loadDataDir(dataDir);
  console.log(`  ${gray(`config.matchKey=${config.matchKey} linkSeparator="${config.linkSeparator}" tables=${Object.keys(data).join(',')}`)}`);

  let schema = analyzeSchema(await api.getSchema(baseId));

  console.log(gray('  · ensure matchKey field'));
  for (const tableName of Object.keys(data)) {
    const tSchema = schema.tablesByName[tableName];
    if (!tSchema) { console.log(`    ${yellow(tableName)}: base에 없는 테이블 ${gray('(skip)')}`); continue; }
    const matchKey = data[tableName].matchKey;
    const created = await ensureMatchKeyField(api, baseId, tSchema, matchKey, opts);
    console.log(`    ${cyan(tableName)}.${matchKey}: ${created ? green('CREATED') : gray('exists')}`);
    // dry-run/live 모두: schema 에 가상 추가 — transformRow 가 matchKey 컬럼 인식
    if (created && !tSchema.fields.some(f => f.name === matchKey)) {
      tSchema.fields.push({ name: matchKey, type: 'singleLineText' });
    }
  }
  // extend mode — CSV 헤더에 base 에 없는 컬럼 있으면 singleLineText 로 자동 생성
  if (opts.extend) {
    console.log(gray('  · extend mode — new fields'));
    for (const [tableName, t] of Object.entries(data)) {
      const tSchema = schema.tablesByName[tableName];
      if (!tSchema) continue;
      const existing = new Set(tSchema.fields.map(f => f.name));
      const csvHeaders = new Set();
      for (const row of t.rows) Object.keys(row).forEach(k => csvHeaders.add(k));
      const newCols = [...csvHeaders].filter(h => !existing.has(h));
      for (const col of newCols) {
        if (opts.dryRun) {
          console.log(`    ${cyan(tableName)}.${col}: ${yellow('would CREATE')} ${gray('(singleLineText, dry)')}`);
          tSchema.fields.push({ name: col, type: 'singleLineText' });
        } else {
          await api.createField(baseId, tSchema.id, {
            name: col, type: 'singleLineText',
            description: 'Auto-created by V6 extend mode',
          });
          tSchema.fields.push({ name: col, type: 'singleLineText' });
          console.log(`    ${cyan(tableName)}.${col}: ${green('CREATED')} (singleLineText)`);
        }
      }
    }
  }

  if (!opts.dryRun) schema = analyzeSchema(await api.getSchema(baseId));

  console.log(gray('  · transform CSV rows'));
  const transformed = {};
  for (const [tableName, t] of Object.entries(data)) {
    if (!schema.tablesByName[tableName]) continue;
    transformed[tableName] = t.rows.map(row => {
      const { fields, linkKeys } = transformRow(tableName, row, schema, schema.linksByTable, config.linkSeparator);
      return { fields, linkKeys, matchKeyValue: fields[t.matchKey] };
    }).filter(r => r.matchKeyValue);
    const skipped = t.rows.length - transformed[tableName].length;
    console.log(`    ${cyan(tableName)}: ${transformed[tableName].length} rows${skipped ? gray(` (${skipped} skipped — no matchKey)`) : ''}`);
  }

  console.log(gray('  · Pass 1 — fields-only upsert'));
  const allKeyToId = {};
  for (const [tableName, rows] of Object.entries(transformed)) {
    if (rows.length === 0) continue;
    const tSchema = schema.tablesByName[tableName];
    const matchKey = data[tableName].matchKey;
    const keyToId = await pass1Upsert(api, baseId, tableName, tSchema, rows, matchKey, opts);
    allKeyToId[tableName] = keyToId;
    console.log(`    ${cyan(tableName)}: ${rows.length} upserted ${opts.dryRun ? gray('(dry)') : green('✓')}`);
  }

  // link target 매핑 확장 — base 의 기존 record 까지 포함 (sisoso items 가 mukayu group 에 link 같은 거)
  console.log(gray('  · link target 매핑 (기존 base record 포함)'));
  for (const tableName of Object.keys(schema.tablesByName)) {
    const tSchema = schema.tablesByName[tableName];
    const matchKey = data[tableName]?.matchKey || config.matchKey;
    if (!tSchema.fields.some(f => f.name === matchKey)) continue;
    const all = await api.listRecords(baseId, tSchema.id);
    allKeyToId[tableName] = allKeyToId[tableName] || {};
    for (const r of all) {
      const k = r.fields[matchKey];
      if (k && !allKeyToId[tableName][k]) allKeyToId[tableName][k] = r.id;
    }
  }

  console.log(gray('  · Pass 2 — link resolve'));
  for (const [tableName, rows] of Object.entries(transformed)) {
    if (rows.length === 0) continue;
    const tSchema = schema.tablesByName[tableName];
    const matchKey = data[tableName].matchKey;
    const recIds = rows.map(r => allKeyToId[tableName][r.matchKeyValue]);
    const cnt = await pass2Links(api, baseId, tableName, tSchema, rows, recIds, allKeyToId, schema.linksByTable, opts);
    console.log(`    ${cyan(tableName)}: ${cnt} link updates ${opts.dryRun ? gray('(dry)') : (cnt ? green('✓') : gray('—'))}`);
  }

  console.log(`\n  ${opts.dryRun ? yellow('DRY-RUN 완료') : green('UPSERT 완료')}`);
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
