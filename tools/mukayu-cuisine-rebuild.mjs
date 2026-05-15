#!/usr/bin/env node
// mukayu-cuisine-rebuild.mjs
// 9.0.3_mukayu 의 요리 영역 전체 재정리
// 1. 기존 요리 records (items + subitems) 전부 DELETE
// 2. intro/story 새 1 item 씩 (매끄러운 한국어)
// 3. list section 에 21 items (시즌별 + 연중)
// 4. 코스의 메뉴 항목 = subitems (~80)
// 5. season tags binding (spring/summer/autumn/winter — yearRound 는 tag 없음)

const BASE = 'appDyu0d6afRVeJiZ';
const TOKEN = process.env.AIRTABLE_PAT;
if (!TOKEN) throw new Error('AIRTABLE_PAT not set');
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const T = {
    section: 'tblKy64yavSnr5WPG',
    items: 'tblIrbig24H0axx5h',
    subitems: 'tblH7xgPQDp6Df5dV',
    tags: 'tblH0N7YFH9xZ72Zk',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchAll(tableId, filter, fields) {
    const records = [];
    let offset = '';
    while (true) {
        const url = new URL(`https://api.airtable.com/v0/${BASE}/${tableId}`);
        if (filter) url.searchParams.set('filterByFormula', filter);
        if (fields) fields.forEach(f => url.searchParams.append('fields[]', f));
        url.searchParams.set('pageSize', '100');
        if (offset) url.searchParams.set('offset', offset);
        const r = await (await fetch(url, { headers: H })).json();
        records.push(...r.records);
        if (!r.offset) break;
        offset = r.offset;
    }
    return records;
}

async function deleteAll(tableId, ids) {
    let total = 0;
    for (let i = 0; i < ids.length; i += 10) {
        const batch = ids.slice(i, i + 10);
        const url = new URL(`https://api.airtable.com/v0/${BASE}/${tableId}`);
        batch.forEach(id => url.searchParams.append('records[]', id));
        const res = await fetch(url, { method: 'DELETE', headers: H });
        if (!res.ok) throw new Error(`DELETE: ${res.status} ${await res.text()}`);
        total += batch.length;
        if (i + 10 < ids.length) await sleep(220);
    }
    return total;
}

async function createBatch(tableId, recs) {
    const out = [];
    for (let i = 0; i < recs.length; i += 10) {
        const batch = recs.slice(i, i + 10);
        const res = await fetch(`https://api.airtable.com/v0/${BASE}/${tableId}`, {
            method: 'POST',
            headers: H,
            body: JSON.stringify({ records: batch.map(f => ({ fields: f })), typecast: true }),
        });
        if (!res.ok) throw new Error(`POST: ${res.status} ${await res.text()}`);
        const j = await res.json();
        out.push(...j.records);
        if (i + 10 < recs.length) await sleep(220);
    }
    return out;
}

// ─── [1] 기존 요리 영역 records 식별 + DELETE ─────────────────────────────

console.log('[1] 기존 요리 영역 records 식별...');
const existingItems = await fetchAll(T.items, "FIND('요리-', {slug})=1", ['slug', 'name']);
const existingSubitems = await fetchAll(T.subitems, "FIND('요리-', {slug})=1", ['slug', 'name']);
console.log(`  items: ${existingItems.length}`);
console.log(`  subitems: ${existingSubitems.length}`);

console.log('[2] DELETE...');
if (existingSubitems.length > 0) {
    const n = await deleteAll(T.subitems, existingSubitems.map(r => r.id));
    console.log(`  ✅ subitems ${n}`);
}
if (existingItems.length > 0) {
    const n = await deleteAll(T.items, existingItems.map(r => r.id));
    console.log(`  ✅ items ${n}`);
}

// ─── [3] sections + tags fetch ─────────────────────────────────────────────

console.log('\n[3] 요리 sections + season tags fetch...');
const sections = await fetchAll(T.section, "FIND('요리-', {slug})=1", ['slug', 'role']);
const sectionByRole = Object.fromEntries(sections.map(s => [s.fields.role?.name || s.fields.role, s.id]));
console.log(`  sections: ${Object.keys(sectionByRole).join(', ')}`);

const seasonTags = await fetchAll(T.tags, "{group}='season'", ['name']);
const tagByName = Object.fromEntries(seasonTags.map(t => [t.fields.name, t.id]));
console.log(`  season tags: ${Object.keys(tagByName).join(', ')}`);

const F = {
    items: {
        section: 'fldOHZZe3m76HbSfh',
        name: 'fldQsGF8KULDI2Xdr',
        subName: 'fldfXiQ20lsLzyb86',
        notes: 'fldvvQ6MI7PLwvE7C',
        price: 'fldteQpBnefH4g96o',
        caption: 'fldB4gT5wHfIjEIy6',
        tags: 'fldpurAPI52CI1ZFK',
    },
    subitems: {
        items: 'fldnbrtaAnZ0btTW6',
        name: 'fldtj8Z90Fr8XlEWE',
        notes: 'fld2HSmyvUgYB8z2k',
        price: 'fldQJkBob8jSW42VJ',
    },
};

// ─── [4] DATA — intro + story + list ─────────────────────────────────────

const introItem = {
    [F.items.section]: [sectionByRole.intro],
    [F.items.name]: '가이세키 호린',
    [F.items.subName]: '숲을 마주한 파인 다이닝',
    [F.items.notes]: `가이세키 호린은 적송, 모과, 산벚나무, 동백, 단풍이 자유롭게 자라는 숲 정원을 굽어보는 넓은 테라스를 갖춘 파인 다이닝 레스토랑입니다.

저희는 지역 곳곳의 식재료 중 가장 좋은 것들만 정성껏 골라, 손님들의 즐거움을 위해 신선한 계절 코스를 준비합니다.`,
};

const storyItem = {
    [F.items.section]: [sectionByRole.story],
    [F.items.name]: '오마카세 — 계절을 한 상에',
    [F.items.subName]: '가가의 자연이 빚는 한 그릇',
    [F.items.notes]: `일본의 오마카세 전통을 따라, 가이세키 호린의 디너 메뉴는 그 계절 최고의 식재료를 한 상에 담습니다. 손님 한 분 한 분의 식이 요건과 취향을 헤아려, 지역의 가장 좋은 재료로 요리를 짓습니다.

가가 시는 다이니치 산을 등에 두고 두 강이 흐르는 땅입니다. 이 자연이 빚어내는 풍부한 생물 다양성 — 일본 전체 맹금류의 70%에 달하는 11종이 이곳에 살고 있습니다 — 이 산과 호수, 그리고 일본해의 다채로운 식재료를 가능하게 합니다.`,
};

// list items + 메뉴 항목 (subitems)
const LIST_DATA = [
    // ────── 봄 ──────
    {
        name: '봄의 한 상 예시',
        subName: 'Example Spring Dishes',
        notes: '봄에 마주하는 디너의 한 상 예시입니다.',
        price: '',
        season: 'spring',
        menu: [
            '부드럽게 익힌 전복',
            '봄 채소와 두부·참깨소스 무침',
            '하시타테 항 털게',
            '사시미 — 시로토라 새우, 넙치, 학꽁치',
            '죽순 구이',
            '가리비와 성게 솥밥 (또는 조개와 채소 전골)',
            '노토 소금 젤라토 모나카',
        ],
    },
    {
        name: '햇 죽순 코스',
        subName: 'New Season Bamboo Shoot Tasting Menu',
        notes: `저녁 식사를 햇 죽순 코스로 업그레이드하실 수 있습니다.

◎ 계절에 따라 제공 여부가 달라집니다 (3월 하순~4월).
◎ 사전 예약 필수.
◎ 2인 이상부터 업그레이드 가능.`,
        price: '1인 ¥6,050 (서비스료 10% 및 소비세 10% 포함)',
        season: 'spring',
        menu: [
            '다시국물 죽순',
            '하시타테 항 털게',
            '사시미 — 죽순, 벚꽃 도미, 다타키 고등어, 창꼴뚜기',
            '죽순 숯불구이와 키노메 허브 된장',
            '노도구로(눈볼대) 숯불구이',
            '와규 소고기와 죽순 전골',
            '죽순 솥밥',
            '노토 소금 젤라토 모나카',
        ],
    },
    // ────── 여름 ──────
    {
        name: '여름의 한 상 예시',
        subName: 'Example Summer Dishes',
        notes: '여름에 마주하는 디너의 한 상 예시입니다.',
        price: '',
        season: 'summer',
        menu: [
            '여름 채소와 호두 페이스트',
            '하시타테 항 털게',
            '가가 큰 오이 속 조갯국',
            '사시미 — 자라 농어, 히라마사 방어, 전갱이',
            '쇼가와 협곡 은어 숯불구이',
            '졸인 가가 채소 — 가지, 붉은 호박, 킨지소 시금치 등',
            '전복과 소라 솥밥 (또는 와규 소고기 전골)',
            '아몬드 아이스크림',
        ],
    },
    {
        name: '전복 사시미 업그레이드',
        subName: 'Abalone Sashimi Upgrade',
        notes: `한 접시 단품으로 추가하실 수 있습니다.

◎ 4월 28일~9월 중순 제공 (천연 재료, 날씨에 따라 변동).
◎ 사전 예약 필수.

쫄깃한 식감과 깊은 감칠맛 — 전복 본연의 풍미를 즐기실 수 있습니다.`,
        price: '1접시 ¥14,800 (서비스료 10% 및 소비세 10% 포함)',
        season: 'summer',
        menu: [],
    },
    {
        name: '전복 스테이크 업그레이드',
        subName: 'Abalone Steak Upgrade',
        notes: `한 접시 단품으로 추가하실 수 있습니다.

◎ 4월 28일~9월 중순 제공 (천연 재료, 날씨에 따라 변동).
◎ 사전 예약 필수.

전복 깊은 감칠맛을 그대로 가두어 정성껏 구워낸 한 접시입니다.`,
        price: '1접시 ¥14,800 (서비스료 10% 및 소비세 10% 포함)',
        season: 'summer',
        menu: [],
    },
    {
        name: '찐 전복 업그레이드',
        subName: 'Steamed Abalone Upgrade',
        notes: `한 접시 단품으로 추가하실 수 있습니다.

◎ 4월 28일~9월 중순 제공.
◎ 사전 예약 필수.`,
        price: '1접시 ¥6,050 (서비스료 10% 및 소비세 10% 포함)',
        season: 'summer',
        menu: [],
    },
    {
        name: '시즌 바위굴 업그레이드',
        subName: 'Seasonal Rock Oyster Upgrade',
        notes: `한 접시 단품으로 추가하실 수 있습니다.

◎ 6월 10일~8월 9일 제공.
◎ 사전 예약 필수.`,
        price: '1접시 ¥3,000 (서비스료 10% 및 소비세 10% 포함)',
        season: 'summer',
        menu: [],
    },
    {
        name: '전복 스페셜 코스',
        subName: 'Abalone Special Course',
        notes: `저녁 식사를 전복 스페셜 코스로 업그레이드하실 수 있습니다.

◎ 6월 20일~9월 10일 제공.
◎ 사전 예약 필수.
◎ 2인 이상부터 업그레이드 가능.`,
        price: '1인 ¥30,000 (서비스료 10% 및 소비세 10% 포함)',
        season: 'summer',
        menu: [
            '가가 큰 오이 속 조갯국',
            '부드럽게 익힌 전복',
            '전복 사시미',
            '전복 숯불구이',
            '가가 채소 모둠',
            '전복 죽',
            '디저트 — 계절 특선',
        ],
    },
    {
        name: '바위굴 코스',
        subName: 'Rock Oyster Course',
        notes: `저녁 식사를 바위굴 코스로 업그레이드하실 수 있습니다.

◎ 6월 10일~8월 9일 제공.
◎ 사전 예약 필수.
◎ 2인 이상부터 업그레이드 가능.`,
        price: '1인 ¥12,100 (서비스료 10% 및 소비세 10% 포함)',
        season: 'summer',
        menu: [
            '바위굴 레몬즙',
            '여름 채소와 두부·참깨소스 무침',
            '바위굴 만두국',
            '사시미 — 모둠',
            '쇼가와 협곡 은어 숯불구이',
            '바위굴 숯불구이',
            '바위굴 솥밥',
            '오바 차조기 아이스크림',
        ],
    },
    // ────── 가을 ──────
    {
        name: '가을의 한 상 예시',
        subName: 'Example Autumn Dishes',
        notes: '가을에 마주하는 디너의 한 상 예시입니다.',
        price: '',
        season: 'autumn',
        menu: [
            '약초 야마나카 닭곰탕',
            '하시타테 항 털게',
            '도빈무시 — 다관에 찐 송이버섯',
            '사시미 — 단새우, 가자미, 적이까',
            '노도구로 구이와 누룽지',
            '졸인 가을 채소 — 표고, 밤, 은행, 꼬치고기 등',
            '와규 소고기 숯불구이와 무화과 소스',
            '송이 솥밥',
            '꿀 젤리 우유 푸딩',
            '가가 배, 가가 포도',
        ],
    },
    {
        name: '7가지 버섯 전골 업그레이드',
        subName: 'Regional Seven Mushrooms Hot Pot Upgrade',
        notes: `저녁 식사에 추가하실 수 있습니다.

◎ 10월 1일~11월 6일 제공 (천연 재료, 날씨에 따라 변동).
◎ 사전 예약 필수.
◎ 2인 이상부터 업그레이드 가능.

다채로운 색과 식감의 계절 식재료로 가을의 풍미를 즐기실 수 있습니다.`,
        price: '1인 ¥6,050 (서비스료 10% 및 소비세 10% 포함)',
        season: 'autumn',
        menu: [],
    },
    {
        name: '송이 숯불구이 업그레이드',
        subName: 'Char-Grilled Matsutake Mushroom Upgrade',
        notes: `한 조각 단품으로 추가하실 수 있습니다.

◎ 10월 1일~11월 6일 제공 (천연 재료, 날씨에 따라 변동).
◎ 사전 예약 필수.`,
        price: '1조각 (~50g) ¥9,680 (서비스료 10% 및 소비세 10% 포함)',
        season: 'autumn',
        menu: [],
    },
    {
        name: '송이 코스',
        subName: 'Matsutake Mushroom Course',
        notes: `저녁 식사를 송이 코스로 업그레이드하실 수 있습니다.

◎ 10월 1일~11월 6일 제공 (천연 재료, 날씨에 따라 변동).
◎ 사전 예약 필수.
◎ 2인 이상부터 업그레이드 가능.`,
        price: '1인 ¥12,100 (서비스료 10% 및 소비세 10% 포함)',
        season: 'autumn',
        menu: [
            '마즙 메밀국수',
            '도빈무시 — 다관에 찐 송이버섯',
            '사시미 — 아코 농어, 사와라 삼치, 시로가이 조개, 적이까',
            '졸인 가을 채소 — 표고, 밤, 은행, 꼬치고기 등',
            '졸인 털게와 박',
            '노도구로와 가지 숯불구이',
            '송이 솥밥',
            '두유 아이스크림과 가가 배',
        ],
    },
    // ────── 겨울 ──────
    {
        name: '겨울의 한 상 예시',
        subName: 'Example Winter Dishes',
        notes: '겨울에 마주하는 디너의 한 상 예시입니다.',
        price: '',
        season: 'winter',
        menu: [
            '찐 마 만두',
            '암 대게와 호박 젤리',
            '순무 새우 수프',
            '사시미 — 토라에비 새우, 바이가이 고동, 부리 방어',
            '대게 숯불구이',
            '가가 연근 만두',
            '노도구로 솥밥',
            '귤 셔벗',
            '계절 과일',
        ],
    },
    {
        name: '대게 사시미 업그레이드',
        subName: 'Snow Crab Sashimi Upgrade',
        notes: `한 접시 단품으로 추가하실 수 있습니다.

◎ 11월 7일~3월 20일 제공.
◎ 사전 예약 필수.`,
        price: '1접시 ¥9,680 (서비스료 10% 및 소비세 10% 포함)',
        season: 'winter',
        menu: [],
    },
    {
        name: '야생오리 전골 업그레이드',
        subName: 'Wild Duck Hot Pot Upgrade',
        notes: `저녁 식사에 추가하실 수 있습니다.

◎ 1월 10일~3월 19일 제공 (천연 재료, 날씨에 따라 변동).
◎ 사전 예약 필수.
◎ 2인 이상부터 업그레이드 가능.

지부니 방식으로 가루 입힌 오리 가슴살과 간을 졸인 후 미즈나, 구운 대파, 오리 완자를 더해 죽으로 마무리합니다.`,
        price: '1인 ¥12,100 (서비스료 10% 및 소비세 10% 포함)',
        season: 'winter',
        menu: [],
    },
    {
        name: '대게 가이세키 코스',
        subName: 'Snow Crab Kaiseki Course',
        notes: `저녁 식사를 대게 가이세키 코스로 업그레이드하실 수 있습니다.

◎ 11월 7일~3월 20일 제공 (천연 재료, 날씨에 따라 변동).
◎ 사전 예약 필수.
◎ 2인 이상부터 업그레이드 가능.`,
        price: '1인 ¥26,950 (서비스료 10% 및 소비세 10% 포함)',
        season: 'winter',
        menu: [
            '순무 수프',
            '암 대게와 호박 젤리',
            '제철 지역 채소와 두부·참깨소스 무침',
            '사시미 — 수 대게, 부리 방어, 단새우, 쿠에 농어',
            '수 대게 숯불구이',
            '가가 연근 만두',
            '대게와 카라스미 솥밥',
            '아몬드 아이스크림',
        ],
    },
    {
        name: '대게 풀 메뉴',
        subName: 'Full Snow Crab Menu',
        notes: `저녁 식사를 대게 풀 메뉴로 업그레이드하실 수 있습니다.

◎ 11월 7일~3월 20일 제공 (천연 재료, 날씨에 따라 변동).
◎ 사전 예약 필수.
◎ 2인 이상부터 업그레이드 가능.`,
        price: '1인 ¥47,630 (서비스료 10% 및 소비세 10% 포함)',
        season: 'winter',
        menu: [
            '순무 수프',
            '암 대게와 호박 젤리',
            '수 대게 사시미',
            '수 대게 숯불구이',
            '수 대게 삶음',
            '대게와 카라스미 솥밥',
            '아몬드 아이스크림',
        ],
    },
    // ────── 연중 ──────
    {
        name: '가나자와 스시 가이세키',
        subName: 'Kanazawa Sushi Kaiseki',
        notes: `이시카와의 신선한 해산물을 정성껏 골라낸 스시 가이세키 코스. 스시와 사시미를 중심으로 다채로운 요리가 함께하여 잊지 못할 한 상이 됩니다.

◎ 사전 예약 필수.
◎ 2인 이상부터 업그레이드 가능.`,
        price: '1인 ¥9,680 (서비스료 10% 및 소비세 10% 포함)',
        season: null,
        menu: [],
    },
    {
        name: '고기 코스',
        subName: 'Meat Course',
        notes: `와규를 비롯한 다양한 고기 요리를 즐기실 수 있습니다.

◎ 사전 예약 필수.`,
        price: '',
        season: null,
        menu: [],
    },
    {
        name: '베지테리언 코스',
        subName: 'Vegetarian Course',
        notes: `일본의 지역 채소를 음미하실 수 있습니다.

◎ 사전 예약 필수.`,
        price: '',
        season: null,
        menu: [],
    },
];

// ─── [5] CREATE intro + story + list items ─────────────────────────────────

console.log('\n[5] intro + story items CREATE...');
const created12 = await createBatch(T.items, [introItem, storyItem]);
console.log(`  ✅ intro=${created12[0].id}  story=${created12[1].id}`);

console.log(`\n[6] list items CREATE (${LIST_DATA.length}개)...`);
const listItemsPayload = LIST_DATA.map(d => {
    const fields = {
        [F.items.section]: [sectionByRole.list],
        [F.items.name]: d.name,
        [F.items.subName]: d.subName,
        [F.items.notes]: d.notes,
        [F.items.price]: d.price,
    };
    if (d.season && tagByName[d.season]) {
        fields[F.items.tags] = [tagByName[d.season]];
    }
    return fields;
});
const createdList = await createBatch(T.items, listItemsPayload);
console.log(`  ✅ ${createdList.length} list items`);

// LIST_DATA index ↔ created record id 매핑
const listMap = LIST_DATA.map((d, i) => ({ ...d, recordId: createdList[i].id }));

// ─── [7] subitems CREATE ─────────────────────────────────────────────────

console.log('\n[7] subitems CREATE (메뉴 항목)...');
const subPayload = [];
for (const item of listMap) {
    if (!item.menu || item.menu.length === 0) continue;
    for (let i = 0; i < item.menu.length; i++) {
        subPayload.push({
            [F.subitems.items]: [item.recordId],
            [F.subitems.name]: item.menu[i],
        });
    }
}
console.log(`  대상: ${subPayload.length}개`);
const createdSubs = await createBatch(T.subitems, subPayload);
console.log(`  ✅ ${createdSubs.length} subitems`);

console.log('\n=== 완료 ===');
console.log(`  items 신설: ${created12.length + createdList.length}개 (intro 1 + story 1 + list ${createdList.length})`);
console.log(`  subitems 신설: ${createdSubs.length}개`);
console.log(`  season tags binding: spring/summer/autumn/winter`);
