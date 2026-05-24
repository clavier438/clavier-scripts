# 프로젝트: clavier-vault-site

> Obsidian vault → public static site. AI fetch endpoint.

## 한 줄

iCloud Obsidian vault 의 공개 가능한 노트를 Quartz v4 로 빌드해 Cloudflare Pages 에 호스팅. AI(Claude, GPT) 가 URL 로 fetch.

## 위치

- **로컬 작업 디렉터리**: `~/Developer/clavier-vault-site`
- **GitHub**: `clavier438/clavier-vault-site` (private)
- **CF Pages 프로젝트**: `clavier-vault`
- **Live URL**: https://clavier-vault.pages.dev
- **Vault source**: `/Users/clavier/Library/Mobile Documents/iCloud~md~obsidian/Documents/folders` (iCloud)

## 파이프라인

```
iCloud vault (SoT)
  ↓ ./publish.sh  (rsync 화이트리스트 + frontmatter normalize)
content/ (커밋 대상)
  ↓ git push origin main
GitHub Actions: npm ci + npx quartz build + wrangler pages deploy
  ↓
https://clavier-vault.pages.dev
```

## 노트 추가 후 배포 (1줄)

```bash
cd ~/Developer/clavier-vault-site && ./publish.sh && git add -A && git commit -m "sync: $(date +%F)" && git push
```

## 환경 요구

- **Node 22 강제** (Quartz `.node-version`). `fnm use 22` 필요. Node 26 은 esbuild deadlock.
- **GH Secrets**: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (Doppler `clavier/prd` 에서 동기화)

## 제외 폴더 (sync 안 됨)

`_archive/`, `_inbox/`, `logs/`, `.obsidian/`, `.claude/`, `*.heic`.

추가 제외: `publish.sh` 의 `rsync --exclude` 라인 편집.

## 알려진 vault 이슈

- 일부 노트가 `---\n\n응, ...본문...\n---` 형태로 frontmatter 가 깨져 있음. `normalize_frontmatter.py` 가 YAML key 휴리스틱으로 자동 제거 (publish.sh 가 호출).
- 한국어 파일명은 Quartz 가 URL-encoded 로 처리 (예: `___________________`). fetch 가능하지만 가독성 낮음.

## AI fetch 사용 예

```bash
curl -s https://clavier-vault.pages.dev/sitemap.xml | grep -oE '<loc>[^<]+</loc>' | head -20
curl -s https://clavier-vault.pages.dev/buildInPublic/day3
```

WebFetch 도구로 클로드/GPT 가 직접 노트 조회 가능.
