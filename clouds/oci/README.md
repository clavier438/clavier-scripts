# OCI (Oracle Cloud Infrastructure) 서버

## 서버 정보

| 항목 | 값 |
|------|-----|
| IP | 168.107.63.94 |
| PORT | 22 |
| USER | ubuntu |
| OS | Ubuntu 24.04 (Oracle Linux kernel) |
| 스토리지 | 45G (약 20% 사용) |

## 연결 방법

```bash
# clouds/oci/ 폴더에서
./connectSsh.sh

# 또는 ~/bin에 설치된 경우
oci-connect

# 명령어 한 줄만 실행하고 싶을 때
./connectSsh.sh "uptime"
./connectSsh.sh "docker ps"
```

Private key는 env.md에 base64로 보관. connect.sh가 자동으로 복원 → 연결 → 삭제.

## 서버에서 쓸 수 있는 명령어

```
n8n-url          n8n 접속 URL 출력 (Cloudflare 터널 URL)
n8n-restart      n8n 재시작
n8n-status       n8n 상태 확인

oci-backup [메시지]   GitHub에 현재 서버 상태 백업
oci-save              백업 (메시지 없이)
oci-status            서버 전체 상태 요약

oci-auto-start        자동 백업 스케줄 시작
oci-auto-stop         자동 백업 스케줄 중지
oci-auto-status       자동 백업 상태 확인
oci-auto-logs         자동 백업 로그 조회

show-commands         전체 명령어 목록
show-status           전체 상태 요약
```

## 서버 아키텍처

```
OCI 서버 (168.107.63.94)
├── n8n (포트 5678)
│    └── Cloudflare Tunnel → 외부 접근 가능 (URL은 재시작 시 변경됨)
├── Claude 에이전트 peer (2026-05-03~)
│    └── doppler run -- claude  (모바일 SSH 또는 cron 트리거)
└── 자동 백업 → GitHub (clavier0/OCI_hyuk439)
```

> **environment-peer 모델**: OCI 는 Mac 노트북·Claude web 과 동등한 peer. SSOT(GitHub+Doppler) 만 살아있으면 어떤 작업이든 OCI 에서 실행 가능. ARCHITECTURE.md "환경 모델 — Layer 0/1/2" 참조.

## Claude 에이전트 부트스트랩 (2026-05-03~)

fresh OCI VM 에 처음 들어갔을 때 1회만 실행:

```bash
# 1) clavier-scripts clone — clavier0/* 은 private 이라 GH_TOKEN 필요.
#    GH_TOKEN 은 Doppler 의 GH_TOKEN 시크릿 값 (Mac 의 `gh auth token` 으로
#    추출해 둔 것). Mac 에서 OCI 로 단발 호출 시:
#      GH_TOKEN=$(doppler secrets get GH_TOKEN --plain) ssh ubuntu@... \
#        "GH_TOKEN='$GH_TOKEN' git clone https://oauth2:\$GH_TOKEN@github.com/clavier0/clavier-scripts ~/clavier-scripts"
#    또는 OCI 안에서 직접:
GH_TOKEN=<paste-pat> git clone "https://oauth2:$GH_TOKEN@github.com/clavier0/clavier-scripts" ~/clavier-scripts

# 2) 부트스트랩 — apt deps + Node.js LTS + Doppler CLI + Claude Code CLI +
#    sibling repo(clavier-hq, platform-workers) 자동 clone (GH_TOKEN 환경변수 그대로 상속됨)
GH_TOKEN="$GH_TOKEN" bash ~/clavier-scripts/clouds/oci/bootstrap-agent.sh

# 3) Doppler 인증 (인터랙티브 — 모바일 브라우저로도 가능)
doppler login
doppler setup --project clavier --config prd

# 4) 동작 확인
doppler run -- claude --version
doppler run -- node ~/clavier-scripts/tools/workerCtl.mjs   # sibling-first 자동 탐색 검증
```

> 재실행 시 (doppler 이미 인증됨): `bash bootstrap-agent.sh` 만으로 충분. Step 5 가 doppler 에서 GH_TOKEN 자동 조회.

스크립트는 멱등 — 재실행 안전. 부트 후 `~/clavier-scripts`, `~/clavier-hq`, `~/platform-workers` 가 형제로 배치되어 Layer 1 도구(workerCtl, doc-coverage, doppler-sync-wrangler, overnight-runner) 가 zero-config 작동. 자세한 단계는 `bootstrap-agent.sh` 헤더 참조.

## 모바일에서 OCI 에이전트 트리거

전제: 모바일에 SSH 클라이언트(Termius, Blink 등) + OCI private key 등록.

**일회성 작업** (mobile → OCI 단발 실행):
```bash
ssh ubuntu@168.107.63.94 \
  "cd ~/<repo> && doppler run -- claude -p '<task 내용>'"
```

**대화형 세션** (긴 작업, 모바일에서 직접):
```bash
ssh ubuntu@168.107.63.94
cd ~/<repo>
doppler run -- claude
```

**새벽 자동 실행** (예: cron, systemd timer):
- bootstrap 은 단발 실행만 보장. 정기 작업은 별도 systemd timer 또는 cron 으로 `doppler run -- claude -p '<task>'` 호출.
- 향후 별도 commit 으로 `clouds/oci/systemd/` 또는 cron 템플릿 추가 예정.

## Private Key 위치

보안상 키는 코드에 포함하지 않음.  
`env.md > OCI (Oracle Cloud) 서버 > Private Key (base64)` 섹션 참조.
