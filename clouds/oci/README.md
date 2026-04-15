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
└── 자동 백업 → GitHub (clavier0/OCI_hyuk439)
```

## Private Key 위치

보안상 키는 코드에 포함하지 않음.  
`env.md > OCI (Oracle Cloud) 서버 > Private Key (base64)` 섹션 참조.
