# GitHub gh CLI 작업 가능/불가 — Claude 작업 컨텍스트

> 자동 주입: UserPromptSubmit hook (`tools/contextInject.json` domain=github)
> 마지막 갱신: 2026-05-04

---

## 한 줄

**`gh` CLI + `gh api` REST 로 거의 모든 작업 가능. "사용자가 직접 하셔야 합니다" 발화 전 1번 더 self-check.**

---

## 가능 ✅ (`gh` CLI / `gh api`)

### Repo·코드
- repo: `gh repo clone/view/list/create/delete/fork`
- branch: `gh api repos/:o/:r/branches`, push 는 `git push` (원격 추가 후)
- commit: `git commit` 후 `git push origin <branch>`

### PR
- create: `gh pr create --title --body --base --head`
- review: `gh pr review --approve / --comment / --request-changes` (본인 PR 은 X)
- merge: `gh pr merge --squash/--rebase/--merge`
- list/view: `gh pr list / view <num>`
- 코멘트: `gh pr comment <num> --body`

### Issue
- `gh issue create / list / view / comment / close / reopen`

### Workflow / Release
- workflow: `gh workflow list / view / run / disable / enable`
- 수동 trigger: `gh workflow run <name.yml> -f input=value`
- run watch: `gh run list / view <id> / watch <id> / cancel <id> / rerun <id>`
- release: `gh release create / list / view / delete`

### Secret / Variable (★ 자주 떠넘겨지는 영역)
- repo secret: `gh secret set NAME --body "value" --repo owner/repo`
- repo secret list: `gh secret list --repo owner/repo`
- env-scoped: `gh secret set --env production --body ...`
- org secret: `gh secret set --org myorg --visibility selected`
- variable: `gh variable set / list / delete`

### 직접 REST API
- `gh api /repos/:o/:r/...` — 모든 GitHub REST endpoint
- 예: webhook 등록, deploy key, branch protection, code scanning 등

### Auth
- `gh auth status` — 현재 토큰·scope 확인
- `gh auth refresh -s workflow,write:org,admin:public_key` — scope 추가

---

## 불가 ❌

| 작업 | 우회·대안 |
|---|---|
| 2FA OTP 입력 | 사용자가 직접 (휴대전화) |
| 비밀번호 변경 | 사용자가 직접 (web UI) |
| 결제·플랜 변경 | 사용자가 직접 |
| 본인 PR self-approve | 다른 reviewer 필요 — 정책상 |

---

## 시도 전 체크리스트

1. **토큰 살아있음**: `gh auth status` → "Logged in to github.com as <user>"
2. **scope 충분**: secret 다루려면 `repo` + `admin:org` (org secret 인 경우) 또는 `workflow` (workflow trigger)
3. **repo private 접근**: `gh repo view owner/repo` 가 200 인지

---

## 잘못 알기 쉬운 것

- ❌ "GH Actions secret 등록은 사용자가 web UI 에서만 가능" → **거짓**. `gh secret set NAME --body "value" --repo o/r` 한 줄.
- ❌ "workflow 수동 실행 못함" → **거짓**. `gh workflow run` 가능.
- ❌ "branch protection 못 만든다" → **거짓**. `gh api -X PUT repos/:o/:r/branches/main/protection -f ...`.
- ❌ "환경(environment) 스코프 secret 은 web UI 만" → **거짓**. `--env <name>` 플래그.

---

## 작업 시작 전 자동 주입 키워드

`github | 깃허브 | gh secret | gh pr | gh workflow | gh api | gh release | actions | pull request | github action`
