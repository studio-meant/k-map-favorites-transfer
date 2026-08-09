// 네이버 source(이름+주소)를 카카오맵에서 검색·매칭 후 즐겨찾기에 저장 (역방향 write).
// 구조(2026-06 기준):
//   검색: map.kakao.com/?q=<이름 동> → #info.search.place.list > li.PlaceItem
//     이름 [data-id="name"](title), 도로명 [data-id="address"], 지번 [data-id="otherAddr"]("(지번) ..."),
//     북마크버튼 [data-id="fav"](class에 ACTIVE면 이미 즐겨찾기됨)
//   저장 흐름(카카오는 2단계):
//     - fav 클릭 → '그룹 선택' 레이어(ul.list_folder, a.link_folder > .txt_folder=폴더명, .utile_folder=고정표시)
//     - 폴더 없으면: '새 그룹 추가' → input[placeholder=그룹명을 입력하세요.] 채우고 button[data-id="addFolderOK"](완료)
//        → 폴더는 '생성만' 됨(장소 저장 X) → fav 다시 클릭해 그룹 선택 레이어 재오픈
//     - 폴더 클릭 → '즐겨찾기 저장' 팝업 → button[data-id="addOK"](완료) 눌러야 실제 저장됨
//   좌표 없음 → 매칭은 주소 기반(도로명+지번 합치면 네이버 지번 주소와 포함관계로 매칭됨).
import { scoreCandidate, sameRegion } from './match.mjs';

const SEARCH_ITEMS = '#info\\.search\\.place\\.list > li.PlaceItem';

// 검색어: 이름 + 동(주소에서). 동이 없으면 구.
function buildQuery(src) {
  const addr = src.address || '';
  const dong = (addr.match(/([가-힣A-Za-z0-9]+(?:동|읍|면))/) || [])[1];
  const gu = (addr.match(/([가-힣]+구)(?=\s|$)/) || [])[1];
  const region = dong || gu || '';
  return (src.name + (region ? ' ' + region : '')).trim();
}

async function searchKakao(page, q) {
  await page.goto('https://map.kakao.com/?q=' + encodeURIComponent(q), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500); // 카카오는 검색 결과를 비동기 렌더 — 고정 대기 후 폴링
  const items = page.locator(SEARCH_ITEMS);
  let n = await items.count().catch(() => 0);
  for (let w = 0; w < 8 && n === 0; w++) {
    await page.waitForTimeout(500);
    n = await items.count().catch(() => 0);
  }
  const cands = [];
  for (let i = 0; i < Math.min(n, 8); i++) {
    const it = items.nth(i);
    let name = await it.locator('[data-id="name"]').getAttribute('title').catch(() => '');
    if (!name) name = await it.locator('[data-id="name"]').innerText().catch(() => '');
    const road = (await it.locator('[data-id="address"]').innerText().catch(() => '')).trim();
    const jibun = (await it.locator('[data-id="otherAddr"]').innerText().catch(() => '')).replace(/^\(지번\)\s*/, '').trim();
    cands.push({ name: (name || '').trim(), address: [road, jibun].filter(Boolean).join(' '), index: i });
  }
  return { items, cands };
}

// fav(북마크) 클릭 → '그룹 선택' 레이어(ul.list_folder) 열기
async function openGroupLayer(page, item) {
  const fav = item.locator('a[data-id="fav"]');
  await fav.scrollIntoViewIfNeeded().catch(() => {});
  const dimmed = page.locator('#dimmedLayer');
  // 직전 작업의 딤드 오버레이가 클릭을 가로채면: 사라질 때까지 폴링(최대 ~9s) 후 클릭, 가려지면 재시도(최대 3회)
  for (let t = 0; t < 3; t++) {
    for (let w = 0; w < 30 && (await dimmed.isVisible().catch(() => false)); w++) await page.waitForTimeout(300);
    try { await fav.click({ timeout: 6000 }); break; } catch { await page.waitForTimeout(800); }
  }
  const layer = page.locator('ul.list_folder:visible');
  for (let w = 0; w < 40 && !(await layer.count().catch(() => 0)); w++) await page.waitForTimeout(250); // 대량 연속 처리 시 레이어 로딩 지연 대비(~10s)
  await page.waitForTimeout(400);
  return (await layer.count().catch(() => 0)) > 0;
}

// 그룹 선택 레이어에서 폴더명(.txt_folder)으로 폴더 링크 찾기 (고정표시 .utile_folder는 제외됨)
async function findFolderLink(page, folderName) {
  const links = page.locator('ul.list_folder:visible a.link_folder');
  const cnt = await links.count().catch(() => 0);
  for (let i = 0; i < cnt; i++) {
    const txt = (await links.nth(i).locator('.txt_folder').innerText().catch(() => '')).trim();
    if (txt === folderName) return links.nth(i);
  }
  return null;
}

export async function saveOnePlaceKakao(page, src, folderName, { threshold = 0.5, earlyExit = 0.6 } = {}) {
  const q = buildQuery(src);
  let { items, cands } = await searchKakao(page, q);
  if (!cands.length) {
    // 지점명(끝의 'XX점/본점/지점')을 통째로 떼고 재검색 — 프로마치 안암점 → 프로마치
    const base = src.name.replace(/\s+\S+점$/, '').trim();
    if (base && base !== src.name) ({ items, cands } = await searchKakao(page, buildQuery({ ...src, name: base })));
  }
  if (!cands.length) return { status: 'not_found', query: q };

  let best = null;
  for (const c of cands) {
    const s = scoreCandidate(src, c);
    if (!best || s.total > best.score) best = { cand: c, score: s.total, breakdown: s };
    if (best.score >= earlyExit) break;
  }
  const matched = { name: best.cand.name, address: best.cand.address };
  const lowConf = best.score < threshold; // 점수가 낮아도(확인 권장) 일단 저장하고 status로만 구분
  // 단, 확인 권장인데 시/도+구가 다르면(다른 지역 동명 가게) 옮기지 않고 못 찾음으로 분류
  if (lowConf && !sameRegion(src.address, best.cand.address)) {
    return { status: 'not_found', matchScore: best.score, matched };
  }

  const item = items.nth(best.cand.index);
  const err = (note) => ({ status: 'error', matchScore: best.score, matched, note });

  // 1) 그룹 선택 레이어 열기 (fav가 ACTIVE여도 '타겟 폴더'에 없으면 추가하므로 ACTIVE만으로 skip 안 함)
  if (!(await openGroupLayer(page, item))) return err('그룹 선택 레이어 안 뜸');

  // 2) 타겟 폴더 찾기
  let created = false;
  let link = await findFolderLink(page, folderName);
  if (link) {
    // 이미 '타겟 폴더'에 저장돼 있으면(li.SAVED) 멱등 skip
    const saved = await link.evaluate((el) => el.closest('li')?.classList.contains('SAVED')).catch(() => false);
    if (saved) {
      await page.keyboard.press('Escape').catch(() => {});
      return { status: 'skipped_duplicate', matchScore: best.score, matched };
    }
  } else {
    // 폴더 없음 → '새 그룹 추가'로 폴더만 생성 후 레이어 재오픈
    const add = page.locator('ul.list_folder:visible a.link_folder').filter({ has: page.locator('.ico_folder.add') }).first();
    if (!(await add.count().catch(() => 0))) return err('새그룹 버튼 없음');
    await add.click();
    const nameInput = page.getByPlaceholder('그룹명을 입력하세요.');
    for (let w = 0; w < 16 && !(await nameInput.count().catch(() => 0)); w++) await page.waitForTimeout(300);
    if (!(await nameInput.count().catch(() => 0))) return err('그룹명 입력칸 안 뜸');
    await nameInput.fill(folderName).catch(() => {});
    const folderOK = page.locator('button[data-id="addFolderOK"]:visible').first();
    if (!(await folderOK.count().catch(() => 0))) return err('폴더 생성 완료 버튼 없음');
    await folderOK.click().catch(() => {});
    await page.waitForTimeout(1800);
    created = true;
    // 폴더 생성만 됨 → 북마크 다시 클릭해 그룹 선택 레이어 재오픈
    if (!(await openGroupLayer(page, item))) return err('폴더 생성 후 레이어 안 뜸');
    link = await findFolderLink(page, folderName);
    if (!link) return err('폴더 생성 후에도 못 찾음');
  }

  // 3) 폴더 클릭 → '즐겨찾기 저장' 팝업 → 완료(addOK) 눌러야 실제 저장
  await link.click();
  const saveOK = page.locator('button[data-id="addOK"]:visible').first();
  for (let w = 0; w < 16 && !(await saveOK.count().catch(() => 0)); w++) await page.waitForTimeout(250);
  if (!(await saveOK.count().catch(() => 0))) return err('저장 완료 버튼(addOK) 안 뜸');
  await saveOK.click().catch(() => {});
  await page.waitForTimeout(1500);

  return { status: lowConf ? 'low_confidence' : 'transferred', matchScore: best.score, matched, folderCreated: created };
}

export async function writeKakaoFavorites(page, places, { direction = 'naver->kakao', log = () => {}, delayMs = 1500, threshold = 0.5, earlyExit = 0.6, prevResult = null, onProgress = null } = {}) {
  const done = new Map();
  if (prevResult) {
    for (const f of prevResult.folders || []) {
      for (const p of f.places || []) {
        // error·not_found만 이어하기 재처리(low_confidence는 이미 저장됨 → 재처리하면 SAVED로 '이미있음' 흡수되므로 제외)
        if (p.status !== 'error' && p.status !== 'not_found') done.set(f.name + '|' + (p.source?.name || ''), p);
      }
    }
  }
  const result = { direction, folders: [] };
  for (const folder of places.folders) {
    const out = { name: folder.name, places: [] };
    result.folders.push(out);
    for (const src of folder.places) {
      const key = folder.name + '|' + src.name;
      if (done.has(key)) { out.places.push(done.get(key)); continue; }
      const t0 = Date.now();
      let entry;
      try {
        const r = await saveOnePlaceKakao(page, src, folder.name, { threshold, earlyExit });
        entry = { source: src, ...r };
      } catch (e) {
        entry = { source: src, status: 'error', note: e.message };
      }
      entry.elapsedSec = (Date.now() - t0) / 1000;
      out.places.push(entry);
      log(`    ${folder.name} ▸ ${src.name}: ${entry.status}${entry.matchScore != null ? ` (${entry.matchScore.toFixed(2)})` : ''}`);
      if (onProgress) onProgress(result);
      await page.waitForTimeout(delayMs);
    }
  }
  return result;
}
