// 네이버 즐겨찾기(내 장소) 폴더/장소 읽기 — CDP로 연결된 실제 Chrome에서 동작(역방향 source).
// 구조(2026-06 기준):
//   map.naver.com/p/favorite/myPlace
//     - 폴더 목록: "all-list" iframe, li[class*="folder_list_item"] (텍스트: 공개여부 | 폴더명 | 저장된 장소 수 | N | ...)
//     - 폴더 전환은 href가 없어 '클릭'으로만 가능 → 클릭 시 URL .../folder/<id> + "detail-list" iframe 로드
//     - 장소: "detail-list" iframe, li[class*="place_info_card"]
//         이름 [class*="main_title"], 카테고리 [class*="category_title"], 주소 [class*="address_area"]
//     - 장소 목록은 무한 스크롤(페이지네이션 버튼 없음) → 끝까지 스크롤해야 전체 로드됨
//   좌표는 노출되지 않음(주소만) → 매칭은 주소 기반(addr Jaccard)으로 수행.

const MY_PLACE_URL = 'https://map.naver.com/p/favorite/myPlace';
const FOLDER_ITEM = 'li[class*="folder_list_item"]';
const PLACE_CARD = 'li[class*="place_info_card"]';

async function waitFrame(page, re, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const f = page.frames().find((fr) => re.test(fr.url()));
    if (f) return f;
    await page.waitForTimeout(300);
  }
  throw new Error(`프레임을 못 찾음: ${re}`);
}

// 폴더 li 텍스트 파싱: "비공개 | <폴더명> | 저장된 장소 수 | <N> | 비공개 | 메뉴"
// '저장된 장소 수' 라벨을 기준으로 앞=폴더명, 뒤=개수를 잡아 표기 변화에 비교적 강하게.
function parseFolder(text) {
  const parts = text.split(/[\n|]/).map((s) => s.trim()).filter(Boolean);
  const li = parts.indexOf('저장된 장소 수');
  const name = li > 0 ? parts[li - 1] : parts[1] || parts[0] || '';
  const cntStr = li >= 0 ? parts[li + 1] : '';
  const placeCount = /^\d+$/.test(cntStr || '') ? parseInt(cntStr, 10) : null;
  return { name, placeCount };
}

// detail-list iframe에서 장소 카드 수가 안 늘 때까지 스크롤(무한 스크롤 전체 로드)
async function scrollToEnd(page, frame, expected = 0) {
  let cur = await frame.locator(PLACE_CARD).count().catch(() => 0);
  let stable = 0;
  let guard = 0;
  // 무한 스크롤은 로딩 지연으로 잠깐 개수가 안 늘 수 있음 → 한 번 안 늘었다고 끝내지 말고
  // 연속 5회 정체했을 때만 종료. 목록상 개수(expected)에 도달하면 즉시 종료.
  while (guard++ < 150) {
    await frame.evaluate(() => {
      const el = document.scrollingElement || document.documentElement;
      if (el) el.scrollTop = el.scrollHeight;
      document.querySelectorAll('ul, [class*="list"], [class*="scroll"], [class*="container"]').forEach((e) => { e.scrollTop = e.scrollHeight; });
    }).catch(() => {});
    await page.waitForTimeout(900);
    const next = await frame.locator(PLACE_CARD).count().catch(() => 0);
    if (next > cur) { cur = next; stable = 0; }
    else if (++stable >= 5) break;
    if (expected && cur >= expected) break;
  }
  return cur;
}

async function readPlaces(frame) {
  const cards = frame.locator(PLACE_CARD);
  const n = await cards.count();
  const places = [];
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i);
    const name = (await card.locator('[class*="main_title"]').first().innerText().catch(() => '')).trim();
    const category = (await card.locator('[class*="category_title"]').first().innerText().catch(() => '')).trim();
    const address = (await card.locator('[class*="address_area"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (name) places.push({ name, category, address });
  }
  return places;
}

async function readFolderMetas(page) {
  await page.goto(MY_PLACE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  let ff = await waitFrame(page, /all-list/);
  const items = ff.locator(FOLDER_ITEM);
  let count = await items.count().catch(() => 0);
  // 폴더 목록이 비동기로 채워짐 → li가 잡힐 때까지 폴링(간헐 로딩 지연으로 0개 읽히는 것 방지)
  for (let w = 0; w < 24 && count === 0; w++) { await page.waitForTimeout(400); count = await items.count().catch(() => 0); }
  const metas = [];
  for (let i = 0; i < count; i++) {
    const t = await items.nth(i).innerText().catch(() => '');
    const { name, placeCount } = parseFolder(t);
    if (name) metas.push({ index: i, name, placeCount });
  }
  return metas;
}

// source 폴더 선택용: 장소 상세를 읽지 않고 폴더 이름과 목록상 장소 수만 수집한다.
export async function listNaverFavoriteFolders(page, { log = () => {} } = {}) {
  const metas = await readFolderMetas(page);
  log(`네이버 폴더 ${metas.length}개: ${metas.map((m) => `${m.name}(${m.placeCount ?? '?'})`).join(', ')}`);
  return metas.map(({ name, placeCount }) => ({ name, placeCount }));
}

export async function scrapeNaverFavorites(page, { log = () => {}, only = null } = {}) {
  const metas = await readFolderMetas(page);
  log(`폴더 ${metas.length}개: ${metas.map((m) => `${m.name}(${m.placeCount ?? '?'})`).join(', ')}`);

  const onlyList = only ? only.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const targets = onlyList ? metas.filter((m) => onlyList.includes(m.name)) : metas;

  const folders = [];
  for (const meta of targets) {
    // 폴더 목록 재진입 후 인덱스로 클릭(폴더 전환은 클릭으로만 가능 — href 없음)
    await page.goto(MY_PLACE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const ff = await waitFrame(page, /all-list/);
    const reitems = ff.locator(FOLDER_ITEM);
    for (let w = 0; w < 24 && !(await reitems.count().catch(() => 0)); w++) await page.waitForTimeout(400);
    await reitems.nth(meta.index).click();
    await page.waitForTimeout(2500);
    const detail = await waitFrame(page, /detail-list/);
    await page.waitForTimeout(1000);
    const total = await scrollToEnd(page, detail, meta.placeCount || 0);
    const places = await readPlaces(detail);
    folders.push({ name: meta.name, places });
    log(`  ${meta.name}: ${places.length}곳 읽음 (목록상 ${meta.placeCount ?? '?'}, 스크롤 후 카드 ${total})`);
  }
  return { source: 'naver', folders };
}
