// airtable-input.mjs — Airtable 사용자 입력 normalization
//
// 이전엔 workerCtl/airtable-backup/airtableCtl 가 각자 base ID 추출 정규식을
// 박았다 (backup 만 \b 없는 미세 차이). 이 lib 로 통일.

/**
 * Airtable Base ID 추출 — raw ID (appXXXXXXXXXXXXXX) 든 base/table URL 이든
 * 동일한 base ID 만 뽑는다.
 *
 * 사용:
 *   extractBaseId("appAbCdEf1234567")                                  // "appAbCdEf1234567"
 *   extractBaseId("https://airtable.com/appAbCdEf1234567/tblXXX/...")  // "appAbCdEf1234567"
 *   extractBaseId("not-an-airtable-thing")                              // null
 *
 * @param {string|null|undefined} input
 * @returns {string|null}  base ID (e.g. "appXXXXXXXXXXXXXX") 또는 null
 */
export function extractBaseId(input) {
    if (!input) return null
    const m = String(input).match(/\bapp[A-Za-z0-9]{14}\b/)
    return m ? m[0] : null
}
