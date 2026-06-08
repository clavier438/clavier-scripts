// Stibee v2 API wrapper — email create / send / fetch + 웹 아카이브 URL 추출
// Self-contained. AccessToken 은 environ STIBEE_ACCESS_TOKEN (Doppler).
// airtable-api.mjs 와 같은 모양 (createClient(token) → 메서드 객체).
//
// 문서 확인 완료 (developers.stibee.com / api.stibee.com/docs, 2026-06-08):
//   • 베이스: https://api.stibee.com/v2
//   • 인증: `AccessToken` 헤더 (워크스페이스 설정 > API 키)
//   • GET /v2/emails (목록) 존재
//   • 이메일 생성/편집/발송 + HTML 코드 본문 지원
//
// ⚠️ CONFIRM (라이브 검증 대기 — background task task_8b0ecf4e):
//   아래 ENDPOINTS / PAYLOAD / ARCHIVE_URL_FIELDS 는 OpenAPI 스펙·실호출로
//   최종 확정 필요. 그 전까지 createEmail/sendEmail 은 best-effort 로 동작하고
//   실패 시 호출자(offer.mjs)가 "스티비 UI에서 수동 발송" fallback 으로 graceful 강등.
//   확정되면 *이 파일 한 곳*만 고치면 됨 (단일 진실 소스).

const BASE = 'https://api.stibee.com/v2';

// CONFIRM: 경로 일부 미확정 — send 경로는 스펙에서 확정 후 교체.
const ENDPOINTS = {
  listEmails: () => `${BASE}/emails`,
  getEmail: (id) => `${BASE}/emails/${id}`,
  createEmail: () => `${BASE}/emails`,
  sendEmail: (id) => `${BASE}/emails/${id}/send`, // CONFIRM: 발송 경로/메서드
};

// CONFIRM: 응답 어디에 공개 웹버전(아카이브) URL 이 오는지 미확정.
// 후보 필드명을 순서대로 스캔 — 스펙 확정 시 정확한 1개로 좁히면 됨.
const ARCHIVE_URL_FIELDS = ['webUrl', 'archiveUrl', 'shareUrl', 'previewUrl', 'url', 'publicUrl'];

export function createClient(accessToken) {
  if (!accessToken) throw new Error('STIBEE_ACCESS_TOKEN not provided');

  async function call(method, url, body, attempt = 0) {
    const res = await fetch(url, {
      method,
      headers: {
        AccessToken: accessToken,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) {
      const wait = parseInt(res.headers.get('Retry-After') || '30', 10) * 1000;
      if (attempt >= 3) throw new Error(`429 after ${attempt} retries: ${url}`);
      await sleep(wait);
      return call(method, url, body, attempt + 1);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${method} ${url}: ${res.status} ${text}`);
    }
    return res.status === 204 ? null : res.json();
  }

  return {
    listEmails: () => call('GET', ENDPOINTS.listEmails()),

    getEmail: (id) => call('GET', ENDPOINTS.getEmail(id)),

    // 이메일 생성. payload 는 호출자가 구성 — 최소 { subject, html }.
    // CONFIRM: 실제 필드명(subject/title, html/content/body, listId/addressBookId)은 스펙으로 확정.
    createEmail: (payload) => call('POST', ENDPOINTS.createEmail(), payload),

    // 발송. CONFIRM: body 스키마(예약시각·수신 주소록 등) 스펙으로 확정.
    sendEmail: (id, payload = {}) => call('POST', ENDPOINTS.sendEmail(id), payload),
  };
}

// 응답 객체(또는 중첩 value)에서 공개 웹 아카이브 URL 을 best-effort 로 추출.
// 스펙 확정 전까지 후보 필드를 순회 — 못 찾으면 null (호출자가 수동 복붙 fallback).
export function extractArchiveUrl(emailResponse) {
  if (!emailResponse || typeof emailResponse !== 'object') return null;
  const obj = emailResponse.value ?? emailResponse.data ?? emailResponse;
  for (const f of ARCHIVE_URL_FIELDS) {
    const v = obj?.[f];
    if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
  }
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
