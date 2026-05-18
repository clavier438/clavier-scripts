#!/usr/bin/env node
/**
 * regenGDriveToken — GDrive refresh_token 재발급 (OAuth 2.0)
 *
 * 사용:
 *   doppler run --project clavier --config prd -- node ~/scripts/tools/regenGDriveToken.mjs
 *
 * 동작:
 *   1. 로컬 http://localhost:8089 에 임시 서버 시작
 *   2. OAuth 동의 URL 출력 → 브라우저 자동 오픈
 *   3. 사용자 동의 후 callback (auth code) 자동 캡처
 *   4. code → refresh_token 교환
 *   5. Doppler GDRIVE_REFRESH_TOKEN 자동 갱신
 *
 * 사전 조건:
 *   Google Cloud Console → OAuth 2.0 클라이언트 → Authorized redirect URIs 에
 *   http://localhost:8089/  포함되어 있어야 함.
 */

import { createServer } from "http"
import { exec } from "child_process"

const PORT = 8089
const REDIRECT = `http://localhost:${PORT}/`
const SCOPE = "https://www.googleapis.com/auth/drive"

const CLIENT_ID     = process.env.GDRIVE_CLIENT_ID
const CLIENT_SECRET = process.env.GDRIVE_CLIENT_SECRET
if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("✗ Doppler env 누락. 'doppler run -- node ...' 형태로 실행하세요.")
    process.exit(1)
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth")
authUrl.searchParams.set("client_id", CLIENT_ID)
authUrl.searchParams.set("redirect_uri", REDIRECT)
authUrl.searchParams.set("response_type", "code")
authUrl.searchParams.set("scope", SCOPE)
authUrl.searchParams.set("access_type", "offline")
authUrl.searchParams.set("prompt", "consent")  // 항상 새 refresh_token 발급

console.log("\n=== GDrive refresh_token 재발급 ===\n")
console.log("브라우저가 자동으로 열립니다. Google 계정(hyuk439@gmail.com) 로 로그인 후 동의:\n")
console.log(authUrl.toString())
console.log()

// 로컬 callback 서버
const server = createServer(async (req, res) => {
    const url = new URL(req.url, REDIRECT)
    const code  = url.searchParams.get("code")
    const error = url.searchParams.get("error")

    if (error) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        res.end(`<h1>OAuth 거부</h1><p>${error}</p><p>터미널 닫고 재시도.</p>`)
        console.error(`✗ OAuth 거부: ${error}`)
        server.close()
        process.exit(1)
    }
    if (!code) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        res.end("<p>code 없음. 다시 시도하세요.</p>")
        return
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
    res.end(`
        <!doctype html><html><head><meta charset="utf-8"><title>OK</title></head>
        <body style="font-family:system-ui;max-width:480px;margin:80px auto;padding:0 20px;">
        <h1>✅ 인증 성공</h1>
        <p>터미널로 돌아가세요. 자동으로 Doppler 갱신 진행됩니다.</p>
        </body></html>
    `)

    console.log("✓ auth code 수신 — refresh_token 교환 중...\n")

    // code → refresh_token 교환
    const body = new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT,
        grant_type: "authorization_code",
    })
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    })
    const data = await tokenRes.json()
    if (!data.refresh_token) {
        console.error("✗ refresh_token 안 옴 — 응답:", JSON.stringify(data, null, 2))
        server.close()
        process.exit(1)
    }

    console.log("✓ refresh_token 받음 (앞 30자):", data.refresh_token.slice(0, 30) + "...")
    console.log()

    // Doppler 갱신
    console.log("Doppler GDRIVE_REFRESH_TOKEN 갱신 중...")
    const dopplerCmd = `doppler secrets set GDRIVE_REFRESH_TOKEN="${data.refresh_token}" --project clavier --config prd --silent`
    exec(dopplerCmd, (err, stdout, stderr) => {
        if (err) {
            console.error("✗ Doppler 갱신 실패:", stderr)
            console.error("\n수동 갱신 필요:")
            console.error(`  doppler secrets set GDRIVE_REFRESH_TOKEN='${data.refresh_token}' --project clavier --config prd`)
            process.exit(1)
        }
        console.log("✓ Doppler GDRIVE_REFRESH_TOKEN 갱신 완료")
        console.log("\n검증: doppler run --project clavier --config prd -- node -e \"\\")
        console.log("  fetch('https://oauth2.googleapis.com/token', {method:'POST', body: new URLSearchParams({client_id: process.env.GDRIVE_CLIENT_ID, client_secret: process.env.GDRIVE_CLIENT_SECRET, refresh_token: process.env.GDRIVE_REFRESH_TOKEN, grant_type:'refresh_token'})}).then(r=>r.json()).then(console.log)\"")
        console.log()
        server.close()
        process.exit(0)
    })
})

server.listen(PORT, () => {
    console.log(`로컬 callback 서버 listen: ${REDIRECT}`)
    console.log("브라우저 여는 중...\n")
    exec(`open "${authUrl.toString()}"`)
})
