## Summary

<!-- 1-3 lines: 무엇이 바뀌었고 왜 -->

## Sisters 점검

> `tools/lib/<family>/` 또는 `tools/lib/<family>-*.mjs` 를 *건드리거나 추가* 한 PR 만 해당.
> 무관한 PR (capability md / hook / 단일 도구 수정) 은 이 섹션 생략 가능.

- [ ] `sisters <family>` 출력을 확인했다 (또는 새 세션에서 UserPromptSubmit hook 이 자동 주입함을 확인)
- [ ] 같은 책무 모듈이 family 안에 *없음*. 있었으면 신설 대신 import.
- [ ] (신설 시) `lib/<family>-<책무>.mjs` 또는 `lib/<family>/<책무>.mjs` 컨벤션 준수 → sisters 가 자동 발견.

## Test

<!-- 검증 방법 -->
