# FrameSync — 결제 받을 준비 가이드 (SOP)

> 이 문서 순서대로 한 번만 하면 끝. 예상 소요: **30분**.

---

## 1. 랜딩 페이지 배포 (5분)

```bash
cd landing/
doppler run -- wrangler pages deploy . --project-name framesync
```

처음 실행 시 Cloudflare 가 프로젝트 자동 생성. 이후 같은 커맨드로 업데이트.

배포 후 나오는 URL → 다음 단계에서 사용.

---

## 2. Lemon Squeezy 상품 등록 (10분, 클릭만)

1. **lemon squeezy 가입**: lemonsqueezy.com → Sign up
2. **Store 생성**: Dashboard → Stores → Add Store
   - Name: `FrameSync`
   - URL: `framesync` (또는 원하는 slug)
3. **Starter 상품**:
   - Products → Add Product → "FrameSync Starter"
   - Type: **Subscription**
   - Price: **$49/month**
   - Variants: "1 site"
4. **Agency 상품**:
   - Products → Add Product → "FrameSync Agency"
   - Type: **Subscription**
   - Price: **$149/month**
   - Variants: "up to 5 sites"
5. **결제 링크 복사**: 각 상품 → Share → Copy Link

6. **`landing/index.html` 링크 교체**:

```js
// 파일 상단 <script> 안
const LS_STARTER_URL = "https://YOUR_STORE.lemonsqueezy.com/buy/STARTER_ID"  // ← 여기 교체
const LS_AGENCY_URL  = "https://YOUR_STORE.lemonsqueezy.com/buy/AGENCY_ID"   // ← 여기 교체
```

교체 후 `wrangler pages deploy . --project-name framesync` 다시 실행.

---

## 3. 고객 자격증명 수집 폼 (5분, Tally)

**tally.so** 무료 가입 → New Form:

| 필드명 | 타입 | 필수 |
|---|---|---|
| Your name | Short text | ✓ |
| Airtable Base ID | Short text | ✓ |
| Airtable PAT (Personal Access Token) | Short text | ✓ |
| Framer Plugin URL | Short text | ✓ |
| Framer Token | Short text | ✓ |
| Plan | Multiple choice (Starter / Agency) | ✓ |
| Notes | Long text | - |

- **설정 → Notifications**: 제출 시 본인 이메일로 알림
- 폼 링크를 Lemon Squeezy "Thank you page" URL 에 넣기 (결제 완료 → 자동으로 폼으로 이동)

---

## 4. 첫 고객 등록 (결제 받을 때마다)

고객이 결제 → Tally 폼 제출 → 이메일 알림 수신 → 아래 실행:

```bash
# 1. 고객 D1 에 등록
doppler run -- node saas/cli/framesync-admin.mjs add cus_<이름> \
  --base <Airtable Base ID> \
  --pat <Airtable PAT> \
  --framer-url <Framer Plugin URL> \
  --framer-token <Framer Token> \
  --plan starter \
  --notes "결제일 2026-XX-XX"

# 2. 등록 확인
doppler run -- node saas/cli/framesync-admin.mjs info cus_<이름>

# 3. 첫 sync 실행 (환경변수 오버라이드로 고객 자격증명 사용)
AIRTABLE_BASE_ID=<base> AIRTABLE_PAT=<pat> \
FRAMER_PLUGIN_URL=<url> FRAMER_TOKEN=<token> \
framer push
```

완료. 고객한테 이메일: "연결됐습니다, Framer 에서 확인해보세요."

---

## 5. 고객에게 보내는 시작 안내 (이메일 템플릿)

```
안녕하세요!

FrameSync 구독이 시작됐습니다. 첫 동기화가 완료됐어요.

Framer 에서 확인하는 법:
1. Framer 편집기 열기
2. CMS → Collections → [연결된 컬렉션] 확인
3. 레코드가 Airtable 와 일치하면 완료

앞으로 Airtable 에서 데이터를 바꾸면 sync 요청 주시면
24시간 내 반영해드립니다.

문의: [이메일]
```

---

## 체크리스트 (완료 여부)

- [ ] 랜딩 배포 완료 (URL: _____________)
- [ ] Lemon Squeezy Starter 상품 링크: _____________
- [ ] Lemon Squeezy Agency 상품 링크: _____________
- [ ] Tally 폼 링크: _____________
- [ ] landing/index.html LS 링크 교체 + 재배포
- [ ] 첫 고객 등록 테스트 (cus_test 로 dry-run)

---

## Doppler 에 추가해야 할 키

```bash
doppler secrets set CLOUDFLARE_ACCOUNT_ID=<your-account-id>
doppler secrets set CLOUDFLARE_D1_CUSTOMERS_ID=76bf5389-0f1a-46a9-bc3e-2c0fde6f7d64
```

Cloudflare Account ID: Dashboard → 우측 하단 "Account ID"
