---
name: 피드백: platform-workers 배포·머지 프로세스
description: platform-workers(framer-sync 등) 변경 ship 시 정식 순서 — 브랜치→커밋→수동배포 검증→머지
type: feedback
originSessionId: 146591fd-38a4-45bb-b47d-127c3e833bdd
---
platform-workers repo (clavier438/platform-workers, Cloudflare Workers) 코드 변경을 ship 할 때 4단계 프로세스를 따른다:

1. **main 에서 새 브랜치 분기** — 작업 성격에 맞는 이름 (예: `fix/cron-idle-churn`).
2. **변경분 커밋** — 목적+수단 포함 메시지.
3. **로컬 `wrangler deploy` 수동 배포로 운영 검증** — 영향 작은 env 먼저 (mukayu → 이후 sisoso). 증상(churn 등) 1~2분 관찰.
4. **검증되면 PR 로 main 머지** → CI(`.github/workflows/deploy-framer-sync.yml`)가 sisoso+mukayu 자동 재배포로 정식화.
   - `main` 은 branch protection 으로 직접 push 불가 ("Changes must be made through a pull request"). 반드시 `git push -u origin <branch>` → `gh pr create --base main` → `gh pr merge <N> --merge`.

**Why:** 이 repo 는 스테이징 워커가 없어 sisoso/mukayu 둘 다 운영이다. main push = CI 자동 배포라 "머지 = 배포"가 묶여 있다. 수동 배포로 운영에서 먼저 검증한 뒤 머지로 정식화하면, 깨진 코드가 CI 를 통해 양쪽 운영에 동시 반영되는 사고를 막는다. 사용자가 2026-05-16 이 순서를 공식 프로세스로 채택.
**How to apply:** framer-sync 등 platform-workers 코드 변경 배포 시 이 4단계를 그대로 따른다. 3단계 수동 배포는 운영 워커 대상이므로 사용자 확인 후 실행. mukayu 를 1차 검증 env 로 쓴다. 배포 명령: `doppler run --project clavier --config prd_mukayu -- npx wrangler deploy --env mukayu` (mukayu), `doppler run --project clavier --config prd -- npm run deploy:sisoso` (sisoso).
