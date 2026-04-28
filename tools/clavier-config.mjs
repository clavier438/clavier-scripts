#!/usr/bin/env node
/**
 * clavier-config — Doppler 시크릿 관리 CLI (단일 진실 소스 = Doppler clavier/prd)
 *
 * 2026-04-28 이전: ~/.clavier/env 직접 편집 → Doppler 래퍼.
 * 변경 시 doppler-mirror-icloud 자동 호출로 iCloud 미러 갱신.
 *
 * 사용법:
 *   clavier-config list             # 모든 키 출력 (값 마스킹)
 *   clavier-config get KEY          # 특정 키 값 출력
 *   clavier-config set KEY VALUE    # 값 저장 (Doppler + iCloud 미러)
 *   clavier-config delete KEY       # 키 삭제 (Doppler + iCloud 미러)
 */

import { execFileSync, spawnSync } from "child_process"

const PROJECT = "clavier"
const CONFIG = "prd"
const META_KEYS = new Set(["DOPPLER_PROJECT", "DOPPLER_CONFIG", "DOPPLER_ENVIRONMENT"])

const bold  = s => `\x1b[1m${s}\x1b[0m`
const dim   = s => `\x1b[2m${s}\x1b[0m`
const green = s => `\x1b[32m${s}\x1b[0m`
const red   = s => `\x1b[31m${s}\x1b[0m`
const yellow = s => `\x1b[33m${s}\x1b[0m`

function dopplerLoggedIn() {
    const r = spawnSync("doppler", ["me"], { stdio: "ignore" })
    return r.status === 0
}

function dopplerJSON() {
    const out = execFileSync("doppler", [
        "secrets", "--project", PROJECT, "--config", CONFIG, "--json"
    ], { encoding: "utf8" })
    return JSON.parse(out)
}

function dopplerSet(key, value) {
    execFileSync("doppler", [
        "secrets", "set", `${key}=${value}`,
        "--project", PROJECT, "--config", CONFIG, "--no-interactive"
    ], { stdio: ["ignore", "ignore", "inherit"] })
}

function dopplerDelete(key) {
    execFileSync("doppler", [
        "secrets", "delete", key,
        "--project", PROJECT, "--config", CONFIG, "--yes"
    ], { stdio: ["ignore", "ignore", "inherit"] })
}

function syncMirror() {
    // iCloud 미러 자동 갱신 — silent (실패해도 Doppler 작업은 성공으로 간주)
    spawnSync("doppler-mirror-icloud", [], { stdio: "ignore" })
}

function mask(val) {
    if (!val || val.length < 12) return "****"
    return val.slice(0, 8) + "..." + val.slice(-4)
}

function abort(msg) { console.error(red(msg)); process.exit(1) }

if (!dopplerLoggedIn()) {
    abort("Doppler 로그인 필요 — 'doppler login' 실행 후 다시 시도하세요.")
}

const [,, cmd, ...rest] = process.argv

if (!cmd || cmd === "list") {
    const data = dopplerJSON()
    const entries = Object.entries(data).filter(([k]) => !META_KEYS.has(k))
    if (entries.length === 0) {
        console.log(dim("(비어있음) — clavier-config set KEY VALUE 로 추가"))
    } else {
        console.log(bold(`\nDoppler ${PROJECT}/${CONFIG} (${entries.length}개)\n`))
        for (const [k, info] of entries.sort(([a], [b]) => a.localeCompare(b))) {
            const v = typeof info === "string" ? info : (info?.computed ?? info?.raw ?? "")
            console.log(`  ${bold(k.padEnd(30))} ${dim(mask(v))}`)
        }
        console.log(dim("\n  값 변경: clavier-config set KEY VALUE"))
        console.log()
    }

} else if (cmd === "get") {
    const key = rest[0]
    if (!key) abort("사용법: clavier-config get KEY")
    try {
        const out = execFileSync("doppler", [
            "secrets", "get", key, "--plain",
            "--project", PROJECT, "--config", CONFIG
        ], { encoding: "utf8" })
        process.stdout.write(out)
    } catch {
        abort(`키 없음: ${key}`)
    }

} else if (cmd === "set") {
    const [key, ...valParts] = rest
    const value = valParts.join("=")
    if (!key || !value) abort("사용법: clavier-config set KEY VALUE")
    dopplerSet(key, value)
    console.log(green(`✓ Doppler에 ${key} 저장됨`), dim(`(${mask(value)})`))
    syncMirror()
    console.log(dim(`  → iCloud 미러 동기화 완료`))

} else if (cmd === "delete") {
    const key = rest[0]
    if (!key) abort("사용법: clavier-config delete KEY")
    dopplerDelete(key)
    console.log(green(`✓ Doppler에서 ${key} 삭제됨`))
    syncMirror()
    console.log(dim(`  → iCloud 미러 동기화 완료`))

} else {
    console.log(`
${bold("clavier-config")} — Doppler 시크릿 관리 (project: ${PROJECT}, config: ${CONFIG})

  ${bold("list")}             모든 키 목록 (값 마스킹)
  ${bold("get")} KEY          특정 키 값 출력
  ${bold("set")} KEY VALUE    값 저장/갱신 (Doppler + iCloud 미러)
  ${bold("delete")} KEY       키 삭제 (Doppler + iCloud 미러)

${dim("Doppler가 단일 진실 소스. iCloud는 백업 미러로 자동 동기화됨.")}
${dim("직접 명령: doppler secrets / doppler secrets set / doppler run -- <명령>")}
`)
}
