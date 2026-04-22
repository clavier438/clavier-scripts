---
name: 데이터 소스 직접 읽기
description: Sana가 CSV 등 파일로 데이터를 제공하면 하드코딩하지 말고 파일을 파싱해서 사용할 것
type: feedback
originSessionId: 62abaf37-2596-4bf1-89a6-d1bd46cf0b28
---
Sana나 사용자가 CSV/JSON 파일로 데이터를 제공했을 때, 그 데이터를 코드 안에 직접 타이핑(하드코딩)하지 말 것.

**Why:** 데이터 전사(transcription)가 작업 시간의 대부분을 차지하게 됨. 19개 항목에도 체감 시간이 크고, 100개 이상이면 사실상 불가능. 파일을 읽어서 변환하면 데이터 양과 무관하게 시간이 일정함.

**How to apply:** 파일 경로가 주어지면 → 파일 읽기 → programmatic mapping/변환 → API 호출. mapping 로직(db값 변환, LNK 해석 등)만 코드로 작성하고 데이터 자체는 파일에서 가져올 것.
