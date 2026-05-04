# Framer ManagedCollection plugin API — 정확한 시그니처

> 자동 주입: UserPromptSubmit hook (`tools/contextInject.json` domain=framer)
> 마지막 갱신: 2026-05-04

---

## 한 줄

**ManagedCollection 메서드 시그니처를 *추측하지 말 것*. 아래 표만 사용. 모르면 `framer.com/developers` doc 직접 fetch.**

---

## 가능 ✅ (실제 존재하는 메서드)

| 메서드 | 시그니처 | 비고 |
|---|---|---|
| `framer.getManagedCollection()` | `() => Promise<ManagedCollection>` | Plugin entry — 핸들 획득 |
| `mc.setFields(fields)` | `(fields: ManagedCollectionField[]) => Promise<void>` | 정의 갱신 (★ 기존 items 무효화 가능) |
| `mc.getFields()` | `() => Promise<ManagedCollectionField[]>` | read-only 조회 |
| `mc.addItems(items)` | `(items: ManagedCollectionItem[]) => Promise<void>` | slug 중복 시 *에러* (upsert 아님) |
| `mc.getItemIds()` | `() => Promise<string[]>` | item ID 배열 |
| `mc.removeItems(ids)` | `(ids: string[]) => Promise<void>` | ID 로 삭제 |
| `mc.setItemOrder(ids)` | `(ids: string[]) => Promise<void>` | 정렬 |

---

## 불가 ❌ (존재하지 않는 메서드 — 호출 시 TypeError)

| 잘못된 메서드 | 실제 우회 |
|---|---|
| ~~`mc.getItems()`~~ | `mc.getItemIds()` 사용 |
| ~~`mc.updateItems()`~~ | `mc.removeItems(ids)` + `mc.addItems(items)` (slug 중복 회피) |
| ~~`mc.clear()`~~ | `mc.removeItems(await mc.getItemIds())` |
| ~~`mc.upsertItems()`~~ | 위와 동일 |
| ~~`mc.findBySlug(slug)`~~ | items 측에서 미리 dedup |

---

## Idempotency 패턴 (★ 반드시 따를 것)

mukayu·sisoso 마스터 템플릿 push 표준 시퀀스:

```ts
// 1. 필드 정의 갱신
await mc.setFields(fieldsDef)

// 2. push session 처음 1번만 비움 (mc_init flag)
const initFlagKey = `mc_init:${col.collectionName}`
if ((await getWorkerState(db, initFlagKey)) !== "1") {
    const existing = await mc.getItemIds().catch(() => [])
    if (existing.length > 0) await mc.removeItems(existing).catch(() => {})
    await setWorkerState(db, initFlagKey, "1")
}

// 3. 새 items add (slug 중복 X — 위에서 비웠으니)
await mc.addItems(items)
```

→ duplicate slug 에러 = mc_init flag 가 사라진 회귀. **silent regression 의 가장 흔한 형태.**

---

## 시도 전 체크리스트

1. `@framer/plugin` SDK 버전 — package.json 의 dependency 확인
2. mc 핸들 null 아닌지: `framer.getManagedCollection()` 직후 throw 체크
3. fields 갱신 시 기존 items 데이터 무효화 가능성 — *idempotent push 시퀀스* 따름

---

## 잘못 알기 쉬운 것

- ❌ "addItems 가 upsert 동작" → **거짓**. slug 중복 = 에러.
- ❌ "setFields 가 안전한 in-place update" → **거짓**. 필드 type 바뀌면 기존 items 가 invalid.
- ❌ "framer SDK 가 React Component lifecycle 따라간다" → **거짓**. plugin context 는 별도. async/await 만.
- ❌ "removeItems 안 부르고 addItems 만 반복" → **거짓**. duplicate slug 폭주.

---

## 작업 시작 전 자동 주입 키워드

`framer-sync | ManagedCollection | mc\.add | mc\.get | mc\.remove | setFields | getItemIds | addItems | removeItems | framer.*plugin`
