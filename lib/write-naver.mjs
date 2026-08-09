// 네이버맵 즐겨찾기 writer (라이브 검증된 DOM 기준 — references/naver-dom.md)
//
// 흐름: 장소명 검색 → 결과 클릭 → 장소상세 iframe의 a[href="#bookmark"](저장) 클릭 →
//       저장 위젯(#swt-save-widget-wrap)에서 타겟 폴더 체크(없으면 새 리스트 생성) → 저장.
//
// 안정/불안정 구분:
//  - ✅ 저장 위젯은 `swt-*` 클래스(안정적). 폴더 체크상태 = dedup(이미 저장됐으면 체크됨).
//  - ⚠️ 검색 결과 리스트는 해시 클래스(빌드마다 변동) → 아래 result 파싱/클릭은 e2e에서 보정 필요.
import { sleep } from './browser.mjs';
import { scoreCandidate, sameRegion } from './match.mjs';

// 프레임 헬퍼 (네이버 검색/장소는 pcmap.place.naver.com iframe 안)
const LIST_RE = /pcmap\.place\.naver\.com\/[^/]+\/list/;
const PLACE_RE = /pcmap\.place\.naver\.com\/[^/]+\/\d+(\/|$|\?|#)/;

function findFrame(page, re) {
  return page.frames().find((f) => re.test(f.url()));
}
async function waitForFrame(page, re, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const f = findFrame(page, re);
    if (f) return f;
    await sleep(400);
  }
  return null;
}

// ── 검색 → 후보 추출 (라이브 구조 검증됨; 클래스는 해시라 구조 기반으로 선택) ─────────
// 결과 항목 = `li:has(a[role="button"])` (Chrome :has 지원). 결과는 수 초 뒤 렌더되므로 폴링.
const RESULT_ITEM = 'li:has(a[role="button"])';

// 검색 직후 결과 형태 판별. 라이브 관찰(_probe-frames) 결과:
//  - 단일 결과 → 네이버가 top URL을 `/search/<q>/place/<id>?isCorrectAnswer=true`로 리다이렉트.
//    (list 프레임도 listCount=1로 잠깐 뜨지만, 곧 place 프레임이 자동 등장)
//  - 다중 결과 → top URL은 `/search/<q>` 유지, list 프레임 listCount>=2, place 프레임 안 뜸.
// → top URL의 `/place/<id>`가 가장 빠르고 확실한 '단일진입' 신호(약 2초). 이걸 최우선으로 본다.
const PLACE_IN_URL = /\/place\/\d+/;
const EMPTY_TEXT = '조건에 맞는 업체가 없습니다';
async function waitForListOrPlace(page, timeout = 12000) {
  const start = Date.now();
  let singleSince = null; // listCount===1이 처음 관측된 시각(단일 결과의 /place/ 자동전환을 잠깐 기다림)
  while (Date.now() - start < timeout) {
    if (PLACE_IN_URL.test(page.url())) {
      // 단일 결과 자동진입 — place 프레임은 곧 뜨므로 있으면 넘기고, 없어도 autoEntered로 알림.
      return { kind: 'place', frame: findPlaceFrame(page) || null };
    }
    const list = findFrame(page, LIST_RE);
    if (list) {
      const count = await list.locator(RESULT_ITEM).count().catch(() => 0);
      if (count >= 2) return { kind: 'list', frame: list }; // 확실한 다중
      if (count === 1) {
        // 단일 결과도 list에 잠깐 1개가 뜸 → /place/ 자동진입을 ~2.5s만 기다린 뒤 안 오면 '리스트 1개'로 확정.
        // (count>=2 가정으로 무조건 12초 기다리던 문제 해결)
        if (singleSince === null) singleSince = Date.now();
        else if (Date.now() - singleSince >= 2500) return { kind: 'list', frame: list };
      } else {
        singleSince = null;
        // 0건: "조건에 맞는 업체가 없습니다." 문구가 뜨면(약 2초) 즉시 빈 결과로 판정(타임아웃 대기 없이).
        const empty = await list.getByText(EMPTY_TEXT).count().catch(() => 0);
        if (empty > 0) return { kind: 'empty', frame: list };
      }
    }
    await sleep(250);
  }
  const list = findFrame(page, LIST_RE);
  return list ? { kind: 'list', frame: list } : { kind: 'none', frame: null };
}

async function searchCandidates(page, query) {
  await page.goto('https://map.naver.com/p/search/' + encodeURIComponent(query), {
    waitUntil: 'domcontentloaded',
  });
  // 다중 결과(list) vs 단일 결과 자동진입(place) vs 0건(empty) 판별.
  const { kind, frame } = await waitForListOrPlace(page, 12000);
  // 단일 결과 → 리스트 없이 장소 상세로 직행. 후보 파싱 불필요, autoEntered로 알림.
  if (kind === 'place') return { frame: null, candidates: [], autoEntered: true };
  // 0건("조건에 맞는 업체가 없습니다") → 결과 폴링(최대 13초) 없이 즉시 종료.
  if (kind === 'empty') return { frame: null, candidates: [], autoEntered: false };
  if (kind !== 'list' || !frame) return { frame: null, candidates: [], autoEntered: false };
  // 결과 li가 렌더될 때까지 폴링(최대 ~13초)
  let count = 0;
  for (let i = 0; i < 30; i++) {
    count = await frame.locator(RESULT_ITEM).count().catch(() => 0);
    if (count > 0) break;
    await sleep(450);
  }
  if (count === 0) return { frame, candidates: [], autoEntered: false };
  const candidates = await frame
    .$$eval('li:has(a[role="button"])', (els) =>
      els.slice(0, 10).map((li, i) => {
        const btns = [...li.querySelectorAll('a[role="button"]')];
        const nameEl = btns[0]?.querySelector('span') || btns[0];
        const name = (nameEl?.textContent || '').trim();
        const address = (btns[1]?.textContent || '').replace('상세주소 열기', '').trim();
        return { name, address, _index: i };
      })
    )
    .catch(() => []);
  return { frame, candidates: candidates.filter((c) => c.name), autoEntered: false };
}

// 후보 i번째 결과의 이름 링크 클릭 → 장소 상세 진입
async function clickResult(frame, index) {
  await frame
    .locator(RESULT_ITEM)
    .nth(index)
    .locator('a[role="button"]')
    .first()
    .click()
    .catch(() => {});
  await sleep(1200);
}

// 장소 상세 iframe(pcmap.place/.../<id>) 찾기 + 장소 id 추출
function findPlaceFrame(page) {
  return page
    .frames()
    .find((f) => /pcmap\.place\.naver\.com\/[^/]+\/\d+/.test(f.url()) && !/\/list/.test(f.url()));
}
function placeIdOf(frame) {
  const m = frame.url().match(/\/(\d+)(?:[/?#]|$)/);
  return m ? m[1] : null;
}
// 장소 상세 프레임에서 도로명 full 주소를 패턴으로 추출(클래스 해시 무관). 가장 짧은(군더더기 없는) 것.
async function readAddrFromFrame(frame) {
  return frame
    .evaluate(() => {
      // 진짜 주소는 항상 시/도로 시작(설명문·안내문 배제) + 구/군/시 포함. 도로명/번지처럼 숫자가 있거나,
      // 번지 없는 동단위 주소(예: "경기 성남시 분당구 운중동" — 하천 등)는 동/읍/면/리로 끝나면 인정.
      const SIDO = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주)/;
      const cands = [];
      for (const el of document.querySelectorAll('a, span, div')) {
        const t = (el.textContent || '').trim();
        if (t.length <= 50 && SIDO.test(t) && /(구|군|시)/.test(t) && (/\d/.test(t) || /[동읍면리]$/.test(t))) cands.push(t);
      }
      cands.sort((a, b) => a.length - b.length); // 가장 짧은(군더더기 없는) 주소
      return cands[0] || '';
    })
    .catch(() => '');
}
// 클릭 후 '새 장소 id'의 상세 프레임이 뜰 때까지 기다린 뒤 full 주소를 읽는다(stale 방지).
// 프레임 찾기/주소 읽기 시간 예산을 분리한다(프레임 탐색이 느려도 주소 읽을 시간 확보).
async function readNewPlaceAddress(page, prevId, { frameTimeout = 25000, addrTimeout = 20000 } = {}) {
  let pf = null;
  let id = null;
  const t1 = Date.now();
  while (Date.now() - t1 < frameTimeout) {
    const f = findPlaceFrame(page);
    if (f) {
      const fid = placeIdOf(f);
      if (fid && fid !== prevId) {
        pf = f;
        id = fid;
        break;
      }
    }
    await sleep(300);
  }
  if (!pf) return { id: prevId, address: '' };
  const t2 = Date.now();
  while (Date.now() - t2 < addrTimeout) {
    const a = await readAddrFromFrame(pf);
    if (a) return { id, address: a };
    await sleep(400);
  }
  return { id, address: '' };
}
// 특정 장소 id 상세가 뜰 때까지 대기
async function waitPlaceId(page, targetId, timeout = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const f = findPlaceFrame(page);
    if (f && placeIdOf(f) === targetId) return true;
    await sleep(350);
  }
  return false;
}


// ── 저장 위젯 (✅ 안정적 swt-* 클래스) ────────────────────────────────────────
async function openSaveWidget(page) {
  const placeFrame = await waitForFrame(page, PLACE_RE, 12000);
  if (!placeFrame) return null;
  await placeFrame.locator('a[href="#bookmark"]').first().click().catch(() => {});
  // 위젯 표시 대기
  const start = Date.now();
  while (Date.now() - start < 8000) {
    const has = await placeFrame
      .locator('#swt-save-widget-wrap .swt-save-list-view')
      .count()
      .catch(() => 0);
    if (has) return placeFrame;
    await sleep(400);
  }
  return placeFrame; // 위젯이 안 떠도 프레임은 반환(상위에서 처리)
}

// 위젯 폴더 목록에서 타겟 폴더 찾기(스크롤하며). 반환: 찾은 li index 또는 -1
async function findFolderIndex(frame, folderName) {
  const scroll = frame.locator('.swt-save-scroll-area').first();
  // ⚠️ 위젯 열린 직후 폴더목록(group-list)이 비어있을 수 있음(다중결과 경로에서 list-view보다 ~0.6s
  //    늦게 채워짐 — _probe-widget-multi 관찰). 빈 목록을 '폴더 없음'으로 오인해 중복 생성하지 않도록 대기.
  for (let w = 0; w < 24; w++) {
    const c = await frame.locator('ul.swt-save-group-list > li.swt-save-group-item').count().catch(() => 0);
    if (c > 0) break;
    await sleep(250);
  }
  for (let attempt = 0; attempt < 12; attempt++) {
    const idx = await frame
      .$$eval(
        'ul.swt-save-group-list > li.swt-save-group-item',
        (els, target) =>
          els.findIndex(
            (li) =>
              (li.querySelector('.swt-save-group-name')?.textContent || '')
                .replace('폴더명', '')
                .trim() === target
          ),
        folderName
      )
      .catch(() => -1);
    if (idx >= 0) return idx;
    // 더 스크롤해서 폴더 더 로드
    const before = await frame.locator('ul.swt-save-group-list > li.swt-save-group-item').count();
    await scroll.evaluate((el) => (el.scrollTop = el.scrollHeight)).catch(() => {});
    await sleep(500);
    const after = await frame.locator('ul.swt-save-group-list > li.swt-save-group-item').count();
    if (after === before) break; // 더 안 늘면 끝
  }
  return -1;
}

// 폴더 li 가 이미 체크(=이미 저장됨)인지. 여러 신호로 판별.
async function isFolderChecked(frame, index) {
  return frame
    .locator('ul.swt-save-group-list > li.swt-save-group-item')
    .nth(index)
    .evaluate((li) => {
      const area = li.querySelector('.swt-save-group-check-area');
      // 결정적 신호: 체크 아이콘 클래스 swt-icon-checked (미체크엔 없음)
      if (area && area.querySelector('.swt-icon-checked')) return true;
      // 보조: blind 텍스트. 미체크="선택해제됨", 체크="선택됨"("선택해제됨"엔 "선택됨" 부분문자열 없음)
      const t = (area?.textContent || '').replace(/\s/g, '');
      return t.includes('선택됨') && !t.includes('해제');
    })
    .catch(() => false);
}

// 새 리스트(폴더) 생성
async function createFolder(frame, folderName) {
  await frame.locator('button.swt-save-group-add-btn').first().click().catch(() => {});
  await sleep(700);
  await frame.locator('#swt-save-input-folderview-list').fill(folderName).catch(() => {});
  await sleep(400);
  await frame.locator('button.swt-complete-btn').first().click().catch(() => {});
  await sleep(1000); // list-view 복귀 대기
}

// 한 장소를 타겟 폴더에 저장. 반환 상태: transferred | skipped_duplicate | not_found | low_confidence | error
export async function saveOnePlace(page, src, folderName, { threshold = 0.5, topN = 5, earlyExit = 0.6 } = {}) {
  // 네이버 검색은 지도 중심 위치로 결과가 편향됨 → 카카오 주소의 앞 2단어(시/도 + 구/군/시)를
  // 검색어에 붙여 지역을 고정. (예: "카사블랑카 서울 용산구" → 해방촌 그곳이 1위)
  // 앞 2단어는 "서울 용산구 / 대전 유성구 / 경기 양평군 / 세종특별자치시 …"처럼 지역을 안정적으로 잡음.
  const region = (src.address || '').trim().split(/\s+/).slice(0, 2).join(' ');
  let { frame: listFrame, autoEntered } = await searchCandidates(page, region ? `${src.name} ${region}` : src.name);
  let resultCount = listFrame ? await listFrame.locator(RESULT_ITEM).count().catch(() => 0) : 0;
  // 지역을 붙여 0건이고 '자동진입'도 아닐 때만 이름으로 폴백 재검색.
  // (자동진입=단일 결과로 이미 정답 장소에 진입한 상태 → 재검색하면 그 장소를 떠나고 12초만 더 낭비)
  if (resultCount === 0 && !autoEntered && region) {
    ({ frame: listFrame, autoEntered } = await searchCandidates(page, src.name));
    resultCount = listFrame ? await listFrame.locator(RESULT_ITEM).count().catch(() => 0) : 0;
  }
  // 그래도 0건이면 지점명(끝의 'XX점')을 떼고 재검색 — 프로마치 안암점 → 프로마치
  if (resultCount === 0 && !autoEntered) {
    const base = src.name.replace(/\s+\S+점$/, '').trim();
    if (base && base !== src.name) {
      ({ frame: listFrame, autoEntered } = await searchCandidates(page, region ? `${base} ${region}` : base));
      resultCount = listFrame ? await listFrame.locator(RESULT_ITEM).count().catch(() => 0) : 0;
    }
  }

  let matched = null;
  let score = 0;
  let lowConf = false; // 점수가 낮아도(확인 권장) 일단 저장하고 status로만 구분 — 사용자가 나중에 확인

  if (resultCount > 0) {
    // 상위 N개를 리스트 순서대로 클릭. 각 후보는 '장소 창(주소)이 실제로 뜬 뒤'에만 점수내고 넘어간다.
    // (클릭 직후 창 뜨기 전에 넘어가면 주소를 못 읽어 오판 → readNewPlaceAddress가 새 장소 창이 뜰 때까지 대기)
    // 장소명 링크 = role=button 링크 중 텍스트 있는 첫 번째(썸네일/사진 링크는 텍스트 없어 제외).
    const nameLinkOf = (i) =>
      listFrame
        .locator(RESULT_ITEM)
        .nth(i)
        .locator('a[role="button"]')
        .filter({ hasText: /[가-힣A-Za-z0-9]/ })
        .first();
    const N = Math.min(resultCount, topN);
    let best = null;
    // 직전 장소의 잔여 프레임 id를 prevId로 잡아, 후보 클릭 후 '다른' 장소 창이 뜰 때까지 기다린다.
    const initFrame = findPlaceFrame(page);
    let prevId = initFrame ? placeIdOf(initFrame) : null;
    for (let i = 0; i < N; i++) {
      const link = nameLinkOf(i);
      // 장소명만(배지·카테고리 제외): 장소명 버튼의 첫 span = 상호명(예: "해방식당"). innerText는
      // "해방식당 네이버페이 한식"처럼 배지까지 합쳐 읽혀 이름 유사도를 떨어뜨림 → 첫 span만 읽는다.
      const nm = (await link.locator('span').first().innerText().catch(() => '')).trim() || src.name;
      // 이 후보의 '새 장소 주소가 실제로 읽힐 때까지' 무조건 대기(타임아웃으로 포기 안 함).
      // 클릭 후 창이 안 뜨면 재클릭하며, 주소가 읽힐 때까지 다음 후보로 넘어가지 않는다.
      let id = prevId;
      let address = '';
      let opened = false; // 새 장소 창이 실제로 떴는지(주소 없는 장소 구분용)
      // 최대 3회 재클릭하며 새 장소 창의 주소를 읽는다. 단 '새 창은 떴는데 주소가 없는' 장소
      // (하천·공원 등 — 예: 운중천)는 무한 대기하지 않고 주소 없이 넘어간다(점수 낮아 자동 제외).
      for (let attempt = 0; attempt < 3 && !address; attempt++) {
        await link.click().catch(() => {}); // 썸네일 말고 이름 링크 → 홈 탭(주소 보임)
        const until = Date.now() + 8000; // 이 시간 안에 새 창이 뜨고 주소가 읽히길 기다림
        while (Date.now() < until && !address) {
          const f = findPlaceFrame(page);
          if (f) {
            const fid = placeIdOf(f);
            if (fid && fid !== prevId) {
              opened = true;
              id = fid;
              const a = await readAddrFromFrame(f);
              if (a) address = a;
            }
          }
          if (!address) await sleep(350);
        }
        if (opened) break; // 새 장소 창이 떴으면(주소 유무 무관) 그 후보로 확정 — 무한 방지
      }
      prevId = id;
      const s = scoreCandidate(src, { name: nm, address });
      if (!best || s.total > best.score) // 동점이면 교체 안 함 → 상단(네이버 1위) 우선
        best = { index: i, id, name: nm, address, score: s.total };
      // 맨 위부터 보다 충분히 확실한 매칭(earlyExit↑)을 만나면 나머지 후보는 안 보고 즉시 확정(속도).
      if (best.score >= earlyExit) break;
    }
    matched = best ? { name: best.name, address: best.address } : null;
    score = Number((best?.score ?? 0).toFixed(2));
    // 상위 후보를 다 봤는데 끝내 주소를 못 읽음(주소 없는 장소) → 저장하지 않고 별도 분류(no_address).
    if (best && !best.address) return { status: 'no_address', matchScore: score, matched, autoEntered };
    if (!best) return { status: 'not_found', matchScore: 0, matched: null };
    if (best.score < threshold) lowConf = true; // 저장하되 확인 권장으로 표기
    // best가 지금 떠 있는 장소가 아니면 다시 띄운다(early-exit면 마지막 클릭=best라 재선택 생략).
    const cur = findPlaceFrame(page);
    if (!cur || placeIdOf(cur) !== best.id) {
      await nameLinkOf(best.index).click().catch(() => {});
      if (best.id) await waitPlaceId(page, best.id);
    }
  }
  // 검색 0건 + 자동진입 아님 + place 프레임도 없음 → 진짜 못 찾음(위젯 대기 12초 낭비 회피).
  if (resultCount === 0 && !autoEntered && !findPlaceFrame(page)) {
    return { status: 'not_found', matchScore: 0, matched: null };
  }
  // 리스트가 없거나(단일 결과 자동 진입) 후보 클릭 후 → 장소 상세의 저장 위젯 열기
  const placeFrame = await openSaveWidget(page);
  if (!placeFrame) return { status: 'not_found', matchScore: score, matched };

  // 자동 단일진입(결과 리스트 없음): 위젯 타이틀의 장소명 + full 주소로 매칭 평가.
  // ⚠️ list-view가 떠도 타이틀(.swt-save-title-info-name)은 ~0.4s 늦게 채워짐 → 채워질 때까지 폴링.
  if (resultCount === 0) {
    let openedName = '';
    for (let i = 0; i < 15 && !openedName; i++) {
      openedName = (
        await placeFrame.locator('.swt-save-title-info-name').first().innerText().catch(() => '')
      ).trim();
      if (!openedName) await sleep(300);
    }
    if (!openedName) return { status: 'not_found', matchScore: 0, matched: null };
    const openedAddr = (
      await placeFrame.locator('.swt-save-title-info-sub span').last().innerText().catch(() => '')
    ).trim();
    const s = scoreCandidate(src, { name: openedName, address: openedAddr });
    matched = { name: openedName, address: openedAddr };
    score = Number(s.total.toFixed(2));
    // 주소를 못 읽음(주소 없는 장소) → 저장하지 않고 별도 분류(no_address).
    if (!openedAddr) {
      await placeFrame.locator('#swt-save-widget-wrap .swt-close-btn').first().click().catch(() => {});
      return { status: 'no_address', matchScore: score, matched, autoEntered };
    }
    if (s.total < threshold) lowConf = true; // 저장하되 확인 권장으로 표기
  }

  // 확인 권장인데 시/도+구가 다르면(다른 지역 동명 가게) 옮기지 않고 못 찾음으로 분류
  if (lowConf && matched && !sameRegion(src.address, matched.address)) {
    await placeFrame.locator('#swt-save-widget-wrap .swt-close-btn').first().click().catch(() => {});
    return { status: 'not_found', matchScore: score, matched, autoEntered };
  }

  let idx = await findFolderIndex(placeFrame, folderName);
  const preExisted = idx >= 0;
  if (!preExisted) {
    await createFolder(placeFrame, folderName);
    idx = await findFolderIndex(placeFrame, folderName);
    if (idx < 0) return { status: 'error', matchScore: score, matched, note: '폴더 생성 실패' };
  }

  // 이미 그 폴더에 저장돼 있으면 절대 건드리지 않고 스킵(토글하면 삭제되므로).
  if (preExisted && (await isFolderChecked(placeFrame, idx))) {
    await placeFrame.locator('#swt-save-widget-wrap .swt-close-btn').first().click().catch(() => {});
    return { status: 'skipped_duplicate', matchScore: score, matched, autoEntered };
  }
  // 폴더가 '체크됨' 상태가 되도록만 만든다(최대 2회). 절대 '해제' 상태로 끝내지 않음.
  const folderBtn = placeFrame
    .locator('ul.swt-save-group-list > li.swt-save-group-item')
    .nth(idx)
    .locator('button.swt-save-group-info');
  for (let t = 0; t < 2 && !(await isFolderChecked(placeFrame, idx)); t++) {
    await folderBtn.click().catch(() => {});
    await sleep(600);
  }
  // 안전장치: 체크 확인 실패 시 저장하지 않고 닫음(기존 데이터 삭제 위험 회피).
  if (!(await isFolderChecked(placeFrame, idx))) {
    await placeFrame.locator('#swt-save-widget-wrap .swt-close-btn').first().click().catch(() => {});
    return { status: 'error', matchScore: score, matched, note: '폴더 체크 확인 실패 — 저장 보류' };
  }
  // 저장 커밋
  await placeFrame.locator('button.swt-save-btn').first().click().catch(() => {});
  await sleep(1500);
  return { status: lowConf ? 'low_confidence' : 'transferred', matchScore: score, matched, autoEntered };
}

// places 구조를 네이버에 기록. 반환: result 구조(report.mjs 호환).
// prevResult: 이전 실행 결과(이어하기) — 이미 처리된 장소(에러 제외)는 다시 검색하지 않고 그대로 둠.
// onProgress: 장소 1건 처리할 때마다 현재까지의 result로 호출(증분 저장 → 중단돼도 처리분 보존).
export async function writeNaverFavorites(page, places, { direction = 'kakao->naver', log = () => {}, delayMs = 1500, prevResult = null, onProgress = null, threshold = 0.5, earlyExit = 0.6 } = {}) {
  // 이어하기용: 이전 결과의 처리된 장소를 (폴더명|장소명) → entry 로 인덱싱.
  const done = new Map();
  if (prevResult) {
    for (const f of prevResult.folders ?? []) {
      for (const p of f.places ?? []) {
        // error·not_found만 이어하기 재처리(low_confidence는 이미 저장됨 → 재처리하면 SAVED로 '이미있음' 흡수되므로 제외)
        if (p.status && p.status !== 'error' && p.status !== 'not_found') done.set(`${f.name}|${p.source?.name}`, p);
      }
    }
  }
  const outFolders = [];
  let curFolder = null;
  const snapshot = () => ({ direction, folders: curFolder ? [...outFolders, curFolder] : [...outFolders] });
  for (const folder of places.folders) {
    curFolder = { name: folder.name, created: true, places: [] };
    for (const src of folder.places) {
      const prev = done.get(`${folder.name}|${src.name}`);
      if (prev) {
        // 이전 실행에서 이미 처리됨 → 재검색 없이 그대로 유지(이어하기)
        curFolder.places.push(prev);
        log(`    ${folder.name} ▸ ${src.name}: ${prev.status} (이전 처리됨, 건너뜀)`);
        continue;
      }
      const entry = { source: src, status: 'error', matchScore: 0, matched: null, note: null };
      if (src.closed) {
        // 카카오에서 폐업/삭제된 장소 → 검색 안 하고 바로 분류
        entry.status = 'closed';
        entry.note = '카카오 폐업/삭제';
        curFolder.places.push(entry);
        log(`    ${folder.name} ▸ ${src.name}: closed (폐업/삭제, 건너뜀)`);
        if (onProgress) onProgress(snapshot());
        continue;
      }
      const t0 = Date.now();
      try {
        const r = await saveOnePlace(page, src, folder.name, { threshold, earlyExit });
        Object.assign(entry, r);
      } catch (e) {
        entry.status = 'error';
        entry.note = String(e?.message ?? e).slice(0, 120);
      }
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      entry.elapsedSec = Number(secs);
      curFolder.places.push(entry);
      log(`    ${folder.name} ▸ ${src.name}: ${entry.status} (${secs}s${entry.autoEntered ? ', 단일진입' : ''})`);
      if (onProgress) onProgress(snapshot()); // 증분 저장(중단 대비)
      await sleep(delayMs); // 저속 실행(봇 탐지/ rate-limit 완화)
    }
    outFolders.push(curFolder);
    curFolder = null;
  }
  return { direction, folders: outFolders };
}
