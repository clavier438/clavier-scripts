// doppler-wrap.mjs — Doppler self-respawn helper (UX 백본 통일)
//
// 동기 (DECISIONS.md "Doppler = secret SSOT", 2026-04-28):
//   모든 CLI 도구는 secret 이 필요할 때 사용자에게 `doppler run --` 입력을
//   강요하지 말고, 자기 자신을 doppler run 으로 self-respawn 해 환경을 주입한다.
//   sentinel env 로 무한 재실행 방지.
//
// 이전엔 workerCtl / airtable-backup / airtableCtl 가 각자 같은 코드를 따로
// 박았고 V6 (airtableUpsertV6) 는 아예 빠뜨려 사용자에게 doppler 강요했음.
// 이 lib 로 통일.
//
// 사용:
//   import { ensureDoppler } from "./lib/doppler-wrap.mjs"
//   ensureDoppler({
//       project: "clavier", config: "prd",
//       sentinelEnv: "MYTOOL_DOPPLER_INJECTED",
//       requiredEnvs: ["AIRTABLE_PAT"],          // 이미 있으면 skip
//       fallbackEnvFile: "~/.clavier/env",        // doppler 없을 때 폴백
//   })

import { execSync, spawnSync } from "child_process"
import { readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"

/**
 * Doppler self-respawn. process 가 doppler 환경 안에서 실행되도록 보장.
 * - sentinelEnv 가 이미 set 이면 → 이미 wrap 된 자식 프로세스 → 통과
 * - requiredEnvs 중 하나라도 set 이면 → 이미 환경 갖춰짐 → 통과
 * - doppler CLI 있으면 → `doppler run --project ... --config ... -- node <self>` 로 self-respawn
 *   (respawn 후 부모 process 는 자식 exit code 그대로 종료)
 * - doppler CLI 없으면 → fallbackEnvFile (있으면) 로드 후 통과 — 호출자가 requiredEnvs 체크
 *
 * @param {Object}   opts
 * @param {string}   opts.project           - Doppler project (e.g. "clavier")
 * @param {string}   opts.config            - Doppler config (e.g. "prd")
 * @param {string}   opts.sentinelEnv       - 무한 재실행 방지용 env 이름
 * @param {string[]} [opts.requiredEnvs=[]] - 이 중 하나라도 set 되면 self-respawn skip
 * @param {string}   [opts.fallbackEnvFile] - doppler 없을 때 로드할 .env 파일 경로 (~/ 지원)
 */
export function ensureDoppler(opts) {
    const { project, config, sentinelEnv, requiredEnvs = [], fallbackEnvFile } = opts || {}
    if (!project || !config || !sentinelEnv) {
        throw new Error("ensureDoppler: project, config, sentinelEnv 필수")
    }

    const isWrappedChild     = process.env[sentinelEnv] === "1"
    const envAlreadySatisfied = requiredEnvs.length > 0
        && requiredEnvs.some(k => !!process.env[k])

    if (!isWrappedChild && !envAlreadySatisfied) {
        let dopplerOk = false
        try {
            execSync("doppler --version", { stdio: "ignore", timeout: 2000 })
            dopplerOk = true
        } catch { /* doppler CLI 없거나 응답 없음 */ }

        if (dopplerOk) {
            const r = spawnSync(
                "doppler",
                ["run", "--project", project, "--config", config, "--",
                 process.execPath, ...process.argv.slice(1)],
                { stdio: "inherit", env: { ...process.env, [sentinelEnv]: "1" } },
            )
            // r.error == ENOENT (doppler binary 사라짐 race) 면 fallback 으로 흘려보냄
            if (!r.error) process.exit(r.status ?? 0)
        }
    }

    // doppler 자식이든, doppler 없는 케이스든 — fallbackEnvFile 있으면 보충 로드.
    // 이미 process.env 에 set 된 키는 덮어쓰지 않음 (Doppler 가 SSOT, 폴백은 그 외 키만).
    if (fallbackEnvFile) loadEnvFile(fallbackEnvFile)
}

/**
 * .env 형식 파일 로드 → process.env 에 주입 (이미 set 된 키는 덮어쓰지 않음).
 * 파일 없으면 silent. `~/` 시작은 home 으로 확장.
 *
 * 형식: `KEY=value` per line. `#` 주석, 빈 줄 무시.
 * 값 양끝 single/double quote 는 stripping.
 *
 * @param {string} path  파일 경로 (절대 또는 ~/ prefix)
 */
export function loadEnvFile(path) {
    const expanded = path.startsWith("~/") ? join(homedir(), path.slice(2)) : path
    let text
    try {
        text = readFileSync(expanded, "utf8")
    } catch {
        return  // 파일 없음 → silent (호출자가 requiredEnvs 로 확인)
    }
    for (let line of text.split("\n")) {
        line = line.trim()
        if (!line || line.startsWith("#") || !line.includes("=")) continue
        const idx = line.indexOf("=")
        const key = line.slice(0, idx).trim()
        let val = line.slice(idx + 1).trim()
        if ((val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1)
        }
        if (!process.env[key]) process.env[key] = val
    }
}
