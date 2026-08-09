// 카카오맵 즐겨찾기 스크레이퍼 (라이브 검증된 DOM 기준 — references/kakao-dom.md)
// 구조: MY탭 → 즐겨찾기. 폴더 목록(li.FavoriteDirectoryItem)에서 폴더 클릭 시 같은 패널이
// "상세"로 전환(navigate-in-place)되고 장소(li.FavoriteDetailItem)가 보인다. 뒤로가기로 복귀.
// 폴더/장소 모두 페이지당 100개 + 페이지번호 버튼([id="info.my.favorite.page.no{N}"])으로 페이징.
import { sleep } from './browser.mjs';

const SEL = {
  myTab: '[id="search.tab5"]',
  favSubtab: '[id="my.subtab.favorite"]',
  folderItem: 'ul.list_detail > li.FavoriteDirectoryItem',
  folderName: 'a.link_txt',
  detailSummary: '.FavoriteDetailSummary',
  placeItem: 'ul.list_detail > li.FavoriteDetailItem',
  backBtn: 'a[data-id="detailBackBtn"]',
};

// 현재 보이는 페이저(폴더 목록 OR 상세 모두 같은 id 재사용)의 사용 가능 페이지 번호 배열
async function availablePages(page) {
  return page.evaluate(() => {
    const btns = [...document.querySelectorAll('[id^="info.my.favorite.page.no"]')];
    const nums = btns
      .filter((b) => b.offsetParent !== null && !/HIDDEN/.test(b.className))
      .map((b) => parseInt(b.textContent.trim(), 10))
      .filter((n) => !Number.isNaN(n));
    return nums.length ? [...new Set(nums)].sort((a, b) => a - b) : [1];
  });
}

async function gotoPage(page, n) {
  await page.click(`[id="info.my.favorite.page.no${n}"]`).catch(() => {});
  await sleep(900);
}

async function readPlacesOnCurrentPage(page, deadCheck) {
  const places = await page.$$eval('ul.list_detail > li.FavoriteDetailItem', (els) =>
    els
      .map((li) => ({
        name: li.querySelector('a.link_txt')?.textContent?.trim() || '',
        address: li.querySelector('.desc_region')?.textContent?.trim() || '',
        lat: null,
        lng: null,
        url: null,
      }))
      .filter((p) => p.name)
  );
  // 죽은 장소(폐업/삭제) 감지: 장소 클릭 시 native confirm("데이터를 불러올 수 없습니다…")이 뜨면 closed.
  if (deadCheck?.enabled) {
    const items = page.locator('ul.list_detail > li.FavoriteDetailItem');
    const n = Math.min(await items.count(), places.length);
    // 폐업 다이얼로그 지연 실측(2021 폴더): 45~186ms (n=7). 950ms 고정은 과함 →
    // 다이얼로그가 뜨면(이벤트 핸들러가 flag 기록) 즉시 다음으로, 안 뜨면 DIALOG_MAX까지만 확인.
    const DIALOG_MAX = 500; // 최대 186ms의 ~2.7배 여유
    const STEP = 60;
    for (let j = 0; j < n; j++) {
      deadCheck.state.flag = null;
      await items.nth(j).locator('a.link_txt').click().catch(() => {});
      for (let w = 0; w * STEP < DIALOG_MAX && !deadCheck.state.flag; w++) await sleep(STEP);
      if (deadCheck.state.flag) places[j].closed = true;
    }
  }
  return places;
}

// 상세 화면에서 모든 페이지의 장소를 누적해서 읽는다.
async function readAllPlaces(page, deadCheck) {
  const all = [];
  const seen = new Set();
  const pages = await availablePages(page);
  for (const n of pages) {
    if (n > 1) await gotoPage(page, n);
    const items = await readPlacesOnCurrentPage(page, deadCheck);
    for (const it of items) {
      const key = `${it.name}|${it.address}`;
      if (!seen.has(key)) {
        seen.add(key);
        all.push(it);
      }
    }
  }
  return all;
}

async function ensureFavoritesView(page) {
  await page.goto('https://map.kakao.com/', { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  await page.click(SEL.myTab).catch(() => {});
  await sleep(800);
  await page.click(SEL.favSubtab).catch(() => {});
  await sleep(1000);
  await page.waitForSelector(SEL.folderItem, { timeout: 15000 });
}

// source 폴더 선택용: 장소 상세를 읽지 않고 폴더 이름만 빠르게 수집한다.
export async function listKakaoFavoriteFolders(page, { log = () => {} } = {}) {
  await ensureFavoritesView(page);

  const folders = [];
  const folderPages = await availablePages(page);
  for (const fp of folderPages) {
    if (fp > 1) await gotoPage(page, fp);
    const countOnPage = await page.locator(SEL.folderItem).count();
    log(`카카오 폴더 목록 ${fp}페이지: ${countOnPage}개`);

    for (let j = 0; j < countOnPage; j++) {
      const name = (
        await page.locator(SEL.folderItem).nth(j).locator(SEL.folderName).innerText().catch(() => '')
      ).trim();
      if (name) folders.push({ name, placeCount: null });
    }
  }
  return folders;
}

// 반환: { source:'kakao', folders:[{ name, places:[{name,address,lat,lng,url,closed?}] }] }
// checkClosed=true: 각 장소를 클릭해 폐업/삭제(죽은 장소) 여부를 감지(place.closed=true). 느리지만 정확.
export async function scrapeKakaoFavorites(page, { log = () => {}, only = null, checkClosed = true } = {}) {
  await ensureFavoritesView(page);

  // ⚠️ 죽은 장소 클릭 시 뜨는 confirm 다이얼로그는 반드시 dismiss(취소). accept하면 즐겨찾기 삭제됨!
  const deadState = { flag: null };
  if (checkClosed) {
    page.on('dialog', async (d) => {
      deadState.flag = d.message();
      await d.dismiss().catch(() => {});
    });
  }
  const deadCheck = checkClosed ? { enabled: true, state: deadState } : null;

  const folders = [];
  const folderPages = await availablePages(page); // 폴더 목록도 페이징될 수 있음
  for (const fp of folderPages) {
    if (fp > 1) await gotoPage(page, fp);
    const countOnPage = await page.locator(SEL.folderItem).count();
    log(`폴더 목록 ${fp}페이지: ${countOnPage}개`);

    for (let j = 0; j < countOnPage; j++) {
      const item = page.locator(SEL.folderItem).nth(j).locator(SEL.folderName);
      const name = (await item.innerText().catch(() => '')).trim() || `폴더${fp}-${j + 1}`;

      if (only && !only.split(',').map((s) => s.trim()).includes(name)) continue; // 타겟 폴더(들)만 진입(콤마구분)

      await item.click();
      await page.waitForSelector(SEL.detailSummary, { timeout: 10000 }).catch(() => {});
      await sleep(1000);

      const places = await readAllPlaces(page, deadCheck);
      const deadN = places.filter((p) => p.closed).length;
      folders.push({ name, places });
      log(`  [${fp}p ${j + 1}/${countOnPage}] ${name}: ${places.length}곳${deadN ? ` (폐업/삭제 ${deadN})` : ''}`);

      await page.click(SEL.backBtn).catch(() => {});
      await sleep(900);
      await page.waitForSelector(SEL.folderItem, { timeout: 10000 }).catch(() => {});
      if (fp > 1) await gotoPage(page, fp); // 뒤로가면 보통 1페이지 → 원래 폴더 페이지로 복귀
    }
  }

  return { source: 'kakao', folders };
}
