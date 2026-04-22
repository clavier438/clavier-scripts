---
name: Airtable CSV 임포트 파이프라인
description: OCI→GDrive 싱크 + Mac→Airtable 업로드 구조, schema.json 자동생성 프로토콜
type: project
originSessionId: 62abaf37-2596-4bf1-89a6-d1bd46cf0b28
---
## 핵심 구조

```
Airtable 변경
  → OCI 웹훅 → CSV + schema.json 자동생성 → GDrive (works_gdrive/airtable/sync/)
                                                       ↓
GDrive 폴더를 job 폴더로 복사 → 컨텐츠 채움 → airtableUpload [folder] → 새 Airtable base
```

## OCI 싱크 (`~/oci-scripts/airtableGdriveSync.py`)

- 웹훅 드리븐: Airtable 변경 → GDrive CSV 업데이트
- **schema.json 자동생성**: `sync_base()`에서 Airtable 메타데이터 API로 필드타입 읽어 schema.json 함께 저장
- `GDRIVE_SYNC_FOLDER_ID=13ZPygd1_WK_GRWTODjyz6XrGtZJ0X9qu` — 루트 싱크 폴더 ID 직접 지정 (이동/이름변경해도 추적)
- GDrive 루트 위치: `works_gdrive/airtable/sync/`

## schema.json 포맷 (OCI 자동생성, 직접 작성 금지)

```json
{
  "version": "auto",
  "job": "base이름",
  "base": "base이름",
  "workspaceId": "wsp...",
  "tables": [{
    "name": "테이블명",
    "csv": "테이블명.csv",
    "primary_key": "_record_id",
    "fields": {
      "_record_id": "TXT",
      "텍스트필드": "TXT",
      "긴텍스트": "LNG",
      "단일선택": "SEL",
      "다중선택": "MSEL",
      "첨부파일": "ATT",
      "링크필드": { "type": "LNK", "target": "타겟테이블명" }
    }
  }]
}
```

**Why:** schema를 OCI가 Airtable 메타데이터에서 직접 읽어 생성 → AI가 필드타입 오해석할 여지 없음, 오류 확률 거의 0

## Mac 업로더 (`~/Library/.../scripts/airtableGeneric.py` v4)

- `airtableUpload [folder]` 로 실행
- schema.json의 `workspaceId`로 대상 워크스페이스 직접 지정
- ATT 필드: JSON export 형식(`[{"url":"..."}]`) 또는 plain URL 모두 처리
- MSEL 필드: JSON array 또는 comma-separated 처리

## claude 워크스페이스

- ID: `wsp9s9TITA2bUxIdq`
- 새 base 생성 시 schema.json의 workspaceId가 이걸 가리키면 claude ws에 생성됨

## OCI 재시작 필요 상황

`sudo systemctl restart airtable-sync` — .env 변경 후 또는 코드 변경 후
현재 상태: GDRIVE_SYNC_FOLDER_ID 추가됨, 아직 재시작 안 함 (2026-04-22)
