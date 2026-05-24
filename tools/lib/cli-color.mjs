// cli-color.mjs — ANSI 색상 helper (UX 백본 통일)
//
// 이전엔 workerCtl/airtableCtl 가 4-space double-quote 스타일, airtable-backup 이
// 다른 시그니처 (c(col, s)) 로 각자 박았다. 이 lib 로 통일 — named helper 만 export.
//
// 사용:
//   import { bold, cyan, green, yellow, red, dim, gray } from "./lib/cli-color.mjs"
//   console.log(green("✓ done"))
//   console.log(`${bold("base")}: ${cyan(baseId)}`)
//
// raw ANSI 코드가 필요한 드문 케이스만 COLORS 사용.

const C = {
    reset:  "\x1b[0m",
    bold:   "\x1b[1m",
    dim:    "\x1b[2m",
    cyan:   "\x1b[36m",
    green:  "\x1b[32m",
    yellow: "\x1b[33m",
    red:    "\x1b[31m",
    gray:   "\x1b[90m",
}

const wrap = code => s => `${code}${s}${C.reset}`

export const bold   = wrap(C.bold)
export const dim    = wrap(C.dim)
export const cyan   = wrap(C.cyan)
export const green  = wrap(C.green)
export const yellow = wrap(C.yellow)
export const red    = wrap(C.red)
export const gray   = wrap(C.gray)

/** raw ANSI 코드 (대부분의 경우 named helper 가 더 간결) */
export const COLORS = C
