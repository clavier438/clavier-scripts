# Clouds — 원격 서버 / 클라우드 연결 관리

SSH 또는 API로 연결 가능한 외부 컴퓨팅 자원을 여기서 관리한다.

## 폴더 구조 원칙

```
clouds/
└── {서비스명}/
    ├── README.md    ← 서버 정보, 연결법, 아키텍처 설명
    └── connectSsh.sh   ← 실제 연결 스크립트 (키/토큰은 env.md에서 읽어옴)
```

- **키/토큰은 여기에 두지 않는다.** 항상 `env.md`에서 읽어온다.
- `connectSsh.sh`는 `installScripts.sh`를 통해 `~/bin/`에 배포된다.

## 현재 연결 가능한 서버 목록

| 서비스 | 종류 | IP / 주소 | 용도 | 연결 |
|--------|------|-----------|------|------|
| OCI | Oracle Cloud VM | 168.107.63.94 | n8n 자동화 서버 | `oci-connect` |

## 새 서버 추가 방법

1. `clouds/{서비스명}/` 폴더 생성
2. `README.md` 작성 (서버 정보, 아키텍처)
3. `connectSsh.sh` 작성 (env.md에서 키 읽어오는 방식 유지)
4. `env.md`에 접속 정보 및 키 추가
5. 이 파일(README.md)의 목록 업데이트
6. git commit
