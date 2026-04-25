#!/usr/bin/env node
/**
 * clavier-config — ~/.clavier/env 관리 CLI
 *
 * 사용법:
 *   clavier-config list          # 모든 키 출력 (값 마스킹)
 *   clavier-config get KEY       # 특정 키 값 출력
 *   clavier-config set KEY VALUE # 값 저장
 *   clavier-config delete KEY    # 키 삭제
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"

const ENV_PATH = join(homedir(), ".clavier", "env")

function readEnv() {
    if (!existsSync(ENV_PATH)) return []
    return readFileSync(ENV_PATH, "utf8").split("\n")
}

function writeEnv(lines) {
    mkdirSync(dirname(ENV_PATH), { recursive: true })
    writeFileSync(ENV_PATH, lines.join("\n"), "utf8")
}

function parseLines(lines) {
    const map = new Map()
    for (const line of lines) {
        const t = line.trim()
        if (!t || t.startsWith("#") || !t.includes("=")) continue
        const [k, ...rest] = t.split("=")
        map.set(k.trim(), rest.join("=").trim())
    }
    return map
}

function mask(val) {
    if (!val || val.length < 12) return "****"
    return val.slice(0, 8) + "..." + val.slice(-4)
}

const [,, cmd, ...rest] = process.argv
const bold = s => `\x1b[1m${s}\x1b[0m`
const dim  = s => `\x1b[2m${s}\x1b[0m`
const green = s => `\x1b[32m${s}\x1b[0m`
const red   = s => `\x1b[31m${s}\x1b[0m`

if (!cmd || cmd === "list") {
    const lines = readEnv()
    const map = parseLines(lines)
    if (map.size === 0) {
        console.log(dim("(비어있음) — clavier-config set KEY VALUE 로 추가"))
    } else {
        console.log(bold(`\n~/.clavier/env (${map.size}개)\n`))
        for (const [k, v] of map) {
            console.log(`  ${bold(k.padEnd(30))} ${dim(mask(v))}`)
        }
        console.log()
    }

} else if (cmd === "get") {
    const key = rest[0]
    if (!key) { console.error("사용법: clavier-config get KEY"); process.exit(1) }
    const map = parseLines(readEnv())
    const val = map.get(key) ?? process.env[key]
    if (!val) { console.error(red(`키 없음: ${key}`)); process.exit(1) }
    console.log(val)

} else if (cmd === "set") {
    const [key, ...valParts] = rest
    const value = valParts.join("=")
    if (!key || !value) { console.error("사용법: clavier-config set KEY VALUE"); process.exit(1) }
    const lines = readEnv()
    let found = false
    const updated = lines.map(line => {
        const t = line.trim()
        if (!t || t.startsWith("#") || !t.includes("=")) return line
        const k = t.split("=")[0].trim()
        if (k === key) { found = true; return `${key}=${value}` }
        return line
    })
    if (!found) updated.push(`${key}=${value}`)
    writeEnv(updated)
    console.log(green(`✓ ${key} 저장됨`), dim(`(${mask(value)})`))

} else if (cmd === "delete") {
    const key = rest[0]
    if (!key) { console.error("사용법: clavier-config delete KEY"); process.exit(1) }
    const lines = readEnv()
    const filtered = lines.filter(line => {
        const t = line.trim()
        if (!t || t.startsWith("#") || !t.includes("=")) return true
        return t.split("=")[0].trim() !== key
    })
    writeEnv(filtered)
    console.log(green(`✓ ${key} 삭제됨`))

} else {
    console.log(`
${bold("clavier-config")} — ~/.clavier/env 관리

  ${bold("list")}             모든 키 목록 (값 마스킹)
  ${bold("get")} KEY          특정 키 값 출력
  ${bold("set")} KEY VALUE    값 저장/갱신
  ${bold("delete")} KEY       키 삭제

${dim("~/.clavier/env 는 모든 clavier 스크립트의 단일 환경변수 소스다.")}
`)
}
