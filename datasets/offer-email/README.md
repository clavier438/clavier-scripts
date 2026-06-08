# offer-email — 오퍼 이메일 마스터 템플릿

`offer` 도구(`tools/offer.mjs`)가 읽는 폴더. **사람용 안내일 뿐, 도구는 이 README 를 무시한다.**

## 정신

오퍼마다 이메일을 새로 디자인하지 않는다. **마스터 템플릿 1개**(`template.html`)를 두고, 오퍼 콘텐츠(Airtable 레코드)만 슬롯에 갈아끼운다. 디자인을 바꾸려면 `template.html` 하나만 고치면 모든 오퍼에 반영된다.

## 파일

- `template.html` — 600px table 레이아웃. `{{title}}` `{{hero_image}}` `{{body_html}}` `{{cta_text}}` `{{cta_url}}` `{{footer_html}}` 슬롯.
- `slot-map.json` — Airtable 필드명 → 슬롯 매핑. 후보를 배열로 두면 레코드에 실제 있는 첫 필드를 쓴다(스키마 적응형). 레코드 스키마에 맞춰 자유롭게 고쳐라. `archive_url_field` = 아카이브 URL 을 써넣을 필드명.
- `README.md` — 이 파일.

## 현재 루프

```
offer draft <레코드>   → 로컬 HTML 미리보기 (.local/offer/offer-<recId>.html)
  ↓ 브라우저로 확인
스티비 HTML 편집기에 붙여넣어 발송 (수동)
  ↓ 웹 아카이브 URL 복사
offer link <레코드> <archiveUrl>   → Airtable 에 URL 기록 + framer push
```

오퍼 카드는 Framer CMS 에서 그 아카이브 URL 로 연결된다 = 스티비 웹버전이 곧 오퍼 디테일 페이지.

## 왜 Framer 디자인을 매번 변환하지 않나

이메일은 table 레이아웃이 필수라 Framer HTML 을 그대로 못 쓴다. 그래서 *마스터 table 템플릿 1개*를 한 번 만들어 두고 슬롯만 치환 — Stripo/BEE Free 에서 매번 손으로 재구성하는 단계가 사라진다. 디테일 페이지는 어차피 스티비 **웹 아카이브**(브라우저 렌더)라, 인박스 호환은 이 마스터 템플릿이 흡수한다.

## 발송 자동화 (나중에)

지금은 스티비 발송이 수동(HTML 붙여넣기). 스티비 v2 API 계약(엔드포인트·페이로드·아카이브 URL 필드)이 확정되면 `tools/lib/stibee-api.mjs`(transport 준비됨)를 쓰는 발송 모듈을 붙여 `offer send` 한 줄로 자동화한다. 확정 전엔 추측 자동화를 만들지 않는다.
