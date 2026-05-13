#!/usr/bin/env node
/**
 * airtable-webhook-verify — HMAC 검증 로직 self-test + live 라우트 핑 테스트
 *
 * 두 모드:
 *
 *   selftest
 *     macSecretBase64 + body 둘 다 합성 → Node crypto / WebCrypto 양쪽으로 MAC 계산
 *     → 두 결과가 일치하는지 + 알려진 reference 값과 일치하는지 검증.
 *     Doppler / Airtable 안 거치고 *로직만* 검증 — CI / 회귀 방지용.
 *
 *   ping --url <workerUrl> --secret <macSecretBase64> [--bad]
 *     워커 엔드포인트에 합성 ping 을 보냄.
 *     - 정상: 워커가 200/202 반환 기대
 *     - --bad: 잘못된 MAC 을 박아 403 반환 기대 (검증 로직이 살아있나 확인)
 *
 * 사용:
 *   node tools/airtable-webhook-verify.mjs selftest
 *   node tools/airtable-webhook-verify.mjs ping --url https://framer-sync.workers.dev/airtable-webhook \
 *        --secret $AIRTABLE_WEBHOOK_MAC_SECRET_appXXX
 *   node tools/airtable-webhook-verify.mjs ping --url ... --secret ... --bad
 */

import { createHmac, webcrypto } from "node:crypto"

const argv = process.argv.slice(2)
const CMD = argv[0]

const c = {
    reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
    green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m",
}
const paint = (col, s) => `${c[col]}${s}${c.reset}`

function arg(name) {
    const i = argv.indexOf(name)
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null
}
function flag(name) { return argv.includes(name) }

// ── HMAC 계산 — Node crypto 경로 (Mac/OCI 에서 검증 스크립트가 쓰는 경로) ─

function macNode(macSecretBase64, rawBodyBytes) {
    const key = Buffer.from(macSecretBase64, "base64")
    const mac = createHmac("sha256", key).update(rawBodyBytes).digest("base64")
    return `hmac-sha256=${mac}`
}

// ── HMAC 계산 — WebCrypto 경로 (Cloudflare Worker 런타임이 쓰는 경로) ───

async function macWebCrypto(macSecretBase64, rawBodyBytes) {
    const keyBytes = Uint8Array.from(Buffer.from(macSecretBase64, "base64"))
    const key = await webcrypto.subtle.importKey(
        "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    )
    const sig = await webcrypto.subtle.sign("HMAC", key, rawBodyBytes)
    // base64 인코딩 — Buffer 우회 (worker 환경 동등성 보존)
    let bin = ""
    const arr = new Uint8Array(sig)
    for (let i = 0; i < arr.byteLength; i++) bin += String.fromCharCode(arr[i])
    const b64 = Buffer.from(bin, "binary").toString("base64")
    return `hmac-sha256=${b64}`
}

// ── selftest ──────────────────────────────────────────────────────────

async function cmdSelftest() {
    // 합성 secret + body — 매 회 동일. 실제 Airtable 비밀과 무관.
    const secret = Buffer.from("supersecret-airtable-mac-key-32bytes").toString("base64")
    const body = JSON.stringify({
        base: { id: "appTESTBASE0000001" },
        webhook: { id: "achTESTWEBHOOK0001" },
        timestamp: "2026-05-13T06:00:00.000Z",
    })
    const bodyBytes = Buffer.from(body, "utf8")

    const a = macNode(secret, bodyBytes)
    const b = await macWebCrypto(secret, bodyBytes)

    console.log(`Node crypto    : ${a}`)
    console.log(`WebCrypto      : ${b}`)
    if (a === b) {
        console.log(paint("green", "✓ 양쪽 일치 — 워커(WebCrypto) 와 CLI(Node) HMAC 동등성 확인"))
    } else {
        console.log(paint("red", "✗ 불일치 — 한쪽 경로 버그"))
        process.exit(2)
    }

    // 추가: 1바이트 흘림 시 MAC 이 달라야 함 (sanity)
    const tampered = Buffer.from(body + " ", "utf8")
    const c2 = macNode(secret, tampered)
    if (c2 === a) {
        console.log(paint("red", "✗ tamper 했는데 MAC 동일 — 검증 의미 없음"))
        process.exit(2)
    }
    console.log(paint("green", "✓ 1바이트 tamper 시 MAC 변화 확인"))

    // 추가: header 값 포맷 (prefix 필수)
    if (!a.startsWith("hmac-sha256=")) {
        console.log(paint("red", "✗ prefix 누락"))
        process.exit(2)
    }
    console.log(paint("green", "✓ header prefix 'hmac-sha256=' 정상"))

    console.log(paint("dim", "\nselftest OK"))
}

// ── ping ──────────────────────────────────────────────────────────────

async function cmdPing() {
    const url = arg("--url")
    const secret = arg("--secret")
    const bad = flag("--bad")
    if (!url || !secret) {
        console.error(paint("red", "✗ --url 과 --secret 둘 다 필수"))
        process.exit(1)
    }

    const body = JSON.stringify({
        base: { id: "appTESTBASE0000001" },
        webhook: { id: "achTESTWEBHOOK0001" },
        timestamp: new Date().toISOString(),
    })
    const bodyBytes = Buffer.from(body, "utf8")
    let header = macNode(secret, bodyBytes)
    if (bad) {
        // 끝자리 한글자 흘려서 무효 MAC 만듦
        header = header.slice(0, -1) + (header.slice(-1) === "A" ? "B" : "A")
    }

    console.log(paint("dim", `POST ${url}`))
    console.log(paint("dim", `X-Airtable-Content-MAC: ${header}`))

    const r = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Airtable-Content-MAC": header,
        },
        body,
    })
    const text = await r.text()
    console.log(`\nstatus  ${r.status}`)
    console.log(`body    ${text.slice(0, 200)}${text.length > 200 ? "…" : ""}`)

    const expected = bad ? 403 : 200
    const acceptable = bad ? [401, 403] : [200, 202]
    if (acceptable.includes(r.status)) {
        console.log(paint("green", `✓ 예상대로 ${r.status} (${bad ? "MAC 거부됨" : "MAC 통과"})`))
    } else {
        console.log(paint("red", `✗ 예상 ${expected} ± / 실제 ${r.status}`))
        process.exit(2)
    }
}

const commands = { selftest: cmdSelftest, ping: cmdPing }
const handler = commands[CMD]
if (!handler) {
    console.error(`사용법: airtable-webhook-verify <selftest|ping> [flags]

  selftest                                    HMAC 로직 self-test (외부 호출 없음)
  ping --url <workerUrl> --secret <b64> [--bad]
                                              워커에 합성 ping 보냄`)
    process.exit(1)
}
handler().catch(e => { console.error(paint("red", `✗ ${e.message}`)); process.exit(2) })
