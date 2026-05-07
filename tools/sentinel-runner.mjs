#!/usr/bin/env node
/**
 * Sentinel — Secret SSOT 감사 루틴 (STL 단일 책임자)
 *
 * 책무: 모든 코드/스크립트가 Doppler 만 참조/기록하는지 매일 감사.
 *       위반 검출 → 자동 시정 (L1) 또는 Ray Dalio 큐 박음 (L2).
 *
 * 부하 (익명):
 *   - per-repo scanner — 결과를 Sentinel 이 통합 → 1 보고
 *
 * 실행:
 *   sentinel scan          # 전수 스캔 + 콘솔 보고만 (저장 X)
 *   sentinel baseline      # 첫 1회 — SENTINEL_AUDIT.md 갱신, RAY_DALIO 안 박음
 *   sentinel audit         # 정기 — SENTINEL_AUDIT.md + L1 자동 시정 + L2 → Ray Dalio 큐
 *
 * 위반 분류:
 *   L1 (자동 시정 안전): --config prd 하드코딩, dotenv 직접 read 등 의미 보존 확실
 *   L2 (보고만 → Ray Dalio): 하드코딩 secret 값 (자동 제거하면 코드 동작 멈춤)
 *
 * 출력:
 *   - clavier-hq/SENTINEL_AUDIT.md (시간축 누적 보고)
 *   - L2 위반 → clavier-hq/RAY_DALIO_QUEUE.md (다음 새벽 강제 hook)
 *
 * 매일 03:45 LaunchAgent 자동 실행 (Closer 03:00 → Ray Dalio 03:30 → Sentinel 03:45).
 */

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "fs"
import { execSync, spawnSync } from "child_process"
import { join, relative, extname, basename } from "path"
import { fileURLToPath } from "url"
import { dirname } from "path"
import { findClavierHq, findPlatformWorkers } from "./lib/repoPaths.mjs"

const __dir = dirname(fileURLToPath(import.meta.url))
const SCRIPTS_ROOT = dirname(__dir)

// 스캔 대상 repo — repoPaths 헬퍼로 sibling/iCloud 자동 탐색.
// worktree 안에서 실행되어도 진짜 repo 위치를 잡는다.
function findRepos() {
    // scripts 자체: worktree 가 아닌 진짜 scripts repo 찾기 (.git 추적)
    let scriptsPath = SCRIPTS_ROOT
    try {
        const realRoot = execSync("git rev-parse --show-toplevel", {
            cwd: SCRIPTS_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
        }).trim()
        // worktree 면 main worktree 의 path 로 (--git-common-dir 의 parent)
        const commonDir = execSync("git rev-parse --git-common-dir", {
            cwd: SCRIPTS_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
        }).trim()
        scriptsPath = commonDir.endsWith("/.git") ? commonDir.replace(/\/\.git$/, "") : realRoot
    } catch { /* git 정보 못 얻으면 SCRIPTS_ROOT 그대로 */ }

    const candidates = [
        { name: "scripts",          path: scriptsPath },
        { name: "platform-workers", path: findPlatformWorkers() },
        { name: "clavier-hq",       path: findClavierHq() },
    ]
    return candidates.filter(r => r.path && existsSync(r.path))
}

// 스캔 제외 디렉토리 (path 의 어디든 매칭)
const EXCLUDE_DIRS = new Set([
    "node_modules", ".git", "dist", "build", ".next", "memory", "memory-backup",
    ".claude", "worker-snapshots", "airtable-blocks-sdk", "docs", "vendor",
    ".doppler", "__pycache__", ".venv", "venv",
])

// 스캔 대상 확장자
const EXTS = new Set([".sh", ".mjs", ".js", ".ts", ".tsx", ".py", ".bash", ".zsh"])

// ── 패턴 ──────────────────────────────────────────────────────────────
// L2 (자동 시정 X — 사람 결정): 코드 안 박힌 secret 값 의심
const L2_HARDCODED_PATTERNS = [
    { name: "airtable-base-id", re: /\bapp[A-Za-z0-9]{14}\b/, hint: "Airtable Base ID 하드코딩" },
    { name: "airtable-pat",     re: /\bpat[A-Za-z0-9]{14}\.[a-f0-9]{64}\b/, hint: "Airtable PAT 하드코딩" },
    { name: "framer-token",     re: /\bfgt_[A-Za-z0-9_-]{40,}\b/, hint: "Framer access token 하드코딩" },
    { name: "google-key",       re: /\bAIza[A-Za-z0-9_-]{35}\b/, hint: "Google API key 하드코딩" },
    { name: "github-pat",       re: /\bghp_[A-Za-z0-9]{36}\b/, hint: "GitHub PAT 하드코딩" },
    { name: "openai-key",       re: /\bsk-[A-Za-z0-9]{20,}\b/, hint: "OpenAI key 하드코딩" },
    { name: "doppler-st",       re: /\bdp\.st\.[a-z_-]+\.[A-Za-z0-9]{40,}\b/, hint: "Doppler service token 하드코딩" },
]

// L1 (자동 시정 안전): 패턴 + 시정 함수
const L1_FIXABLE_PATTERNS = [
    {
        name: "dotenv-direct-read",
        re: /(readFileSync|read_file|open)\([^)]*['"`][^'"`]*\.env['"`]/,
        hint: ".env 파일 직접 read (Doppler 미경유)",
        // 자동 시정 X (의미 보존 어려움) — 보고만, RAY_DALIO 박음
        autoFix: false,
    },
    {
        name: "dotenv-source",
        re: /^\s*(source|\.)\s+[~\w/.\-]*\.env\b/m,
        hint: "shell 에서 .env 직접 source (Doppler 미경유)",
        autoFix: false,
    },
    {
        name: "dotenv-package",
        re: /require\(['"`]dotenv['"`]\)|from\s+['"`]dotenv['"`]|import\s+.*dotenv/,
        hint: "dotenv 패키지 사용 (Doppler 미경유)",
        autoFix: false,
    },
    // --config prd 하드코딩 — 단순 스크립트는 OK 지만 multi-worker context 에서는 drift.
    // L1 시정 X — context 판단 필요. 보고만.
    {
        name: "doppler-config-hardcode",
        re: /--config\s+prd\b/,
        hint: "Doppler --config prd 하드코딩 (multi-worker drift 위험)",
        autoFix: false,
    },
]

// 1회용 마이그레이션 스크립트 추정 — Engineer 가 매주 archive 처리할 후보.
// Sentinel 은 별도 카테고리 분류만 하고 RAY_DALIO 안 박음 (Engineer 인계).
//
// 휴리스틱: scripts repo 의 <workername>-*.{mjs,js,ts,py} 는 1회용 데이터 작업.
// (운영 워커 코드는 platform-workers repo 안. scripts repo 의 워커prefix 파일은
//  사용자가 임시로 만든 데이터 마이그레이션 스크립트.)
function isLikelyOneShot(file) {
    const fname = basename(file)
    if (!/\.(mjs|js|ts|py)$/.test(fname)) return false
    return /^(mukayu|sisoso|hotel|airbnb|stayfolio)-/i.test(fname)
}

// false-positive whitelist
function isAllowedContext(file, line) {
    const fname = basename(file)
    // markdown 문서 — 예시·설명 가능
    if (fname.endsWith(".md")) return true
    // 주석 안 (#, //, /*)
    if (/^\s*(#|\/\/|\/\*|\*)/.test(line)) return true
    // placeholder (XXXX...)
    if (/X{6,}/.test(line)) return true
    // sentinel 자기 자신
    if (fname === "sentinel-runner.mjs") return true
    // 안내 메시지 echo/warn/error/console.log/print — 문자열 리터럴 안 패턴은 실행 명령 X
    // (`echo "doppler setup --config prd"` 같은 사용자 가이드)
    if (/^\s*(echo|printf|warn|error|info|note|console\.(log|error|warn|info)|print|process\.stdout\.write)\b/.test(line)) return true
    // doppler setup 자체 — 사용자 환경 첫 link 시 default config 명시. multi-worker drift 무관.
    if (/\bdoppler\s+setup\b/.test(line)) return true
    return false
}

// secret reference 검출 (Doppler 에 없는 키 사용 의심)
const SECRET_KEY_REF_RE = /process\.env\.([A-Z][A-Z0-9_]+)|os\.environ\[?["']?([A-Z][A-Z0-9_]+)["']?\]?\.?get\(?["']?([A-Z][A-Z0-9_]+)?|\$\{?([A-Z][A-Z0-9_]+)\}?/g

// ── repo 스캐너 (부하) ───────────────────────────────────────────────
function* walkFiles(root) {
    const stack = [root]
    while (stack.length) {
        const dir = stack.pop()
        let entries
        try { entries = readdirSync(dir, { withFileTypes: true }) } catch { continue }
        for (const ent of entries) {
            const p = join(dir, ent.name)
            if (ent.isDirectory()) {
                if (EXCLUDE_DIRS.has(ent.name)) continue
                if (ent.name.startsWith(".") && ent.name !== ".github") continue
                stack.push(p)
            } else if (ent.isFile()) {
                if (EXTS.has(extname(ent.name))) yield p
            }
        }
    }
}

function scanFile(file) {
    let content
    try { content = readFileSync(file, "utf8") } catch { return [] }
    const lines = content.split("\n")
    const findings = []

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (!line.trim()) continue
        if (isAllowedContext(file, line)) continue

        for (const p of L2_HARDCODED_PATTERNS) {
            const m = line.match(p.re)
            if (m) {
                findings.push({
                    level: "L2",
                    pattern: p.name,
                    hint: p.hint,
                    file, line: i + 1,
                    excerpt: line.trim().slice(0, 160),
                    match: m[0],
                })
            }
        }
        for (const p of L1_FIXABLE_PATTERNS) {
            if (p.re.test(line)) {
                findings.push({
                    level: p.autoFix ? "L1" : "L2",
                    pattern: p.name,
                    hint: p.hint,
                    file, line: i + 1,
                    excerpt: line.trim().slice(0, 160),
                })
            }
        }
    }
    return findings
}

function scanRepo(repo) {
    const findings = []
    for (const file of walkFiles(repo.path)) {
        const oneShot = isLikelyOneShot(file)
        for (const f of scanFile(file)) {
            f.repo = repo.name
            f.relFile = relative(repo.path, f.file)
            f.category = oneShot ? "one-shot" : "operational"
            findings.push(f)
        }
    }
    return findings
}

// ── Doppler 키 inventory ─────────────────────────────────────────────
function dopplerKeys(config = "prd") {
    try {
        const r = spawnSync("doppler",
            ["secrets", "--project", "clavier", "--config", config, "--json"],
            { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 })
        if (r.status !== 0) return new Set()
        return new Set(Object.keys(JSON.parse(r.stdout)))
    } catch { return new Set() }
}

// ── 보고서 작성 ──────────────────────────────────────────────────────
function buildReport(allFindings, dopplerKeysSet) {
    const now = new Date().toISOString().replace("T", " ").slice(0, 19)
    const ops = allFindings.filter(f => f.category === "operational")
    const oneShot = allFindings.filter(f => f.category === "one-shot")
    const byLevel = { L1: [], L2: [] }
    for (const f of ops) byLevel[f.level].push(f)

    const byRepo = {}
    for (const f of allFindings) {
        byRepo[f.repo] = byRepo[f.repo] ?? { ops: 0, oneShot: 0 }
        f.category === "one-shot" ? byRepo[f.repo].oneShot++ : byRepo[f.repo].ops++
    }

    const lines = []
    lines.push(`## ${now} Sentinel 감사`)
    lines.push("")
    lines.push(`> 부하: scanner × ${Object.keys(byRepo).length} repo. Sentinel 이 통합 → 1 보고.`)
    lines.push("")
    lines.push(`**운영 코드 위반**: L1 ${byLevel.L1.length} / L2 ${byLevel.L2.length}  ·  Doppler[prd] 키 ${dopplerKeysSet.size}개`)
    lines.push(`**1회용 스크립트 (Engineer archive 인계)**: ${oneShot.length}건`)
    lines.push("")
    lines.push("**repo 별**:")
    for (const [repo, counts] of Object.entries(byRepo)) {
        lines.push(`- ${repo}: 운영 ${counts.ops}, 1회용 ${counts.oneShot}`)
    }
    lines.push("")

    if (byLevel.L1.length) {
        lines.push("### L1 (자동 시정 가능)")
        lines.push("")
        for (const f of byLevel.L1) {
            lines.push(`- \`${f.repo}/${f.relFile}:${f.line}\` — ${f.hint}`)
            lines.push(`  \`\`\`\n  ${f.excerpt}\n  \`\`\``)
        }
        lines.push("")
    }

    if (byLevel.L2.length) {
        lines.push("### L2 (사람 판단 필요 → Ray Dalio 큐)")
        lines.push("")
        const byPattern = {}
        for (const f of byLevel.L2) {
            byPattern[f.pattern] = byPattern[f.pattern] ?? []
            byPattern[f.pattern].push(f)
        }
        for (const [pattern, items] of Object.entries(byPattern)) {
            lines.push(`#### ${pattern} (${items.length}건)`)
            lines.push(`> ${items[0].hint}`)
            lines.push("")
            for (const f of items.slice(0, 20)) {
                lines.push(`- \`${f.repo}/${f.relFile}:${f.line}\``)
                lines.push("  ```")
                lines.push(`  ${f.excerpt}`)
                lines.push("  ```")
            }
            if (items.length > 20) lines.push(`- ...외 ${items.length - 20}건`)
            lines.push("")
        }
    }

    if (oneShot.length) {
        lines.push("### 1회용 스크립트 위반 (Engineer 인계 — archive 후보)")
        lines.push("")
        const byFile = {}
        for (const f of oneShot) {
            byFile[`${f.repo}/${f.relFile}`] = (byFile[`${f.repo}/${f.relFile}`] ?? 0) + 1
        }
        for (const [path, n] of Object.entries(byFile)) {
            lines.push(`- \`${path}\` (${n}건)`)
        }
        lines.push("")
        lines.push("> 매주 일 03:30 Engineer 가 CATALOG.md 갱신 시 archive 검토. Sentinel 은 RAY_DALIO 큐에 박지 않음.")
        lines.push("")
    }

    if (!ops.length && !oneShot.length) {
        lines.push("✅ **위반 없음** — 모든 secret 처리가 Doppler 경유.")
        lines.push("")
    }

    return lines.join("\n")
}

// ── 메인 ─────────────────────────────────────────────────────────────
async function main() {
    const cmd = process.argv[2] ?? "scan"

    const repos = findRepos()
    if (!repos.length) {
        console.error("✗ 스캔할 repo 못 찾음")
        process.exit(1)
    }

    console.log(`🛡  Sentinel — Secret SSOT 감사`)
    console.log(`   대상 repo: ${repos.map(r => r.name).join(", ")}`)
    console.log()

    const allFindings = []
    for (const repo of repos) {
        process.stdout.write(`  ▸ ${repo.name} 스캔 중... `)
        const f = scanRepo(repo)
        allFindings.push(...f)
        console.log(`${f.length} findings`)
    }
    console.log()

    const dopplerKeysSet = dopplerKeys("prd")
    const report = buildReport(allFindings, dopplerKeysSet)

    if (cmd === "scan") {
        console.log(report)
        return
    }

    // baseline / audit — 보고서 저장. audit 만 RAY_DALIO 박음 (정기 실행).
    const hqDir = findClavierHq()
    if (!hqDir) {
        console.error("✗ clavier-hq repo 못 찾음 — 보고서 저장 위치 없음")
        process.exit(1)
    }

    const auditFile = join(hqDir, "SENTINEL_AUDIT.md")
    let existing = ""
    if (existsSync(auditFile)) existing = readFileSync(auditFile, "utf8")
    const header = existing.includes("# SENTINEL_AUDIT")
        ? ""
        : "# SENTINEL_AUDIT — Secret SSOT 감사 누적 보고\n\n" +
          "> Sentinel 루틴이 매일 03:45 갱신. 시간축 누적. STL: 사용자 직접 보고 entity = Sentinel.\n\n---\n\n"
    writeFileSync(auditFile, header + report + "\n\n---\n\n" + existing.replace(/^# SENTINEL_AUDIT[\s\S]*?---\n\n/, ""))
    console.log(`📝 ${auditFile} 갱신`)

    if (cmd === "baseline") {
        console.log()
        console.log(`✅ Sentinel baseline 완료. RAY_DALIO 큐에 박지 않음 (사용자 검토용).`)
        return
    }

    // audit — 운영 코드 L2 만 RAY_DALIO 큐에 박음 (1회용 스크립트는 Engineer 인계, 노이즈 방지)
    const l2 = allFindings.filter(f => f.level === "L2" && f.category === "operational")
    if (l2.length) {
        const queueFile = join(hqDir, "RAY_DALIO_QUEUE.md")
        const today = new Date().toISOString().slice(0, 10)
        const byPattern = {}
        for (const f of l2) {
            byPattern[f.pattern] = byPattern[f.pattern] ?? []
            byPattern[f.pattern].push(f)
        }
        const queueLines = []
        for (const [pattern, items] of Object.entries(byPattern)) {
            queueLines.push(`- [ ] ${today} 실수: Sentinel L2 — ${items[0].hint} (${items.length}건)`)
            queueLines.push(`  - **사실관계**: ${items.length}곳 위반. 패턴 \`${pattern}\``)
            queueLines.push(`  - **사용자 발견 경위**: Sentinel 자동 감사 (매일 03:45)`)
            queueLines.push(`  - **즉시 영향**: secret 처리가 Doppler 미경유 — drift/누출 위험`)
            queueLines.push(`  - **5 whys 자기 진단**: 코드가 SSOT 정책 따라 작성되지 않음. hook 부재.`)
            queueLines.push(`  - **요청 사항**: pre-commit hook 추가로 패턴 차단. 위치: ${items.slice(0, 3).map(i => `\`${i.repo}/${i.relFile}:${i.line}\``).join(", ")}${items.length > 3 ? ` 외 ${items.length - 3}건` : ""}`)
            queueLines.push("")
        }
        // 큐 파일 "## 대기 중" 섹션에 append (없으면 생성)
        let q = existsSync(queueFile) ? readFileSync(queueFile, "utf8") : "# RAY_DALIO_QUEUE\n\n## 대기 중\n\n"
        if (!q.includes("## 대기 중")) q += "\n## 대기 중\n\n"
        q = q.replace(/(## 대기 중\n)/, `$1\n${queueLines.join("\n")}\n`)
        writeFileSync(queueFile, q)
        console.log(`📌 RAY_DALIO_QUEUE.md 에 L2 ${l2.length}건 박음`)
    }

    // L1 자동 시정 (현재 비활성 — 모든 패턴 autoFix=false. 향후 안전 검증 후 활성)
    const l1 = allFindings.filter(f => f.level === "L1" && f.category === "operational")
    if (l1.length) {
        console.log(`⚠️  L1 ${l1.length}건 — 현재 자동 시정 비활성 (안전 검증 진행 중). 보고만.`)
    }

    const oneShotCount = allFindings.filter(f => f.category === "one-shot").length
    console.log()
    console.log(`✅ Sentinel 감사 완료. 운영 L1 ${l1.length} / L2 ${l2.length}  ·  1회용 ${oneShotCount} (Engineer 인계)`)
}

main().catch(err => {
    console.error(`\n✗ Sentinel 오류: ${err.message}`)
    process.exit(1)
})
