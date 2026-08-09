// 카카오↔네이버 즐겨찾기 이전 — CDP로 사용자의 실제 크롬에 연결해 동작.
//
// 사전 준비:
//   1) 크롬을 디버그 포트로 실행 + kakao/naver 로그인:
//      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//        --remote-debugging-port=9222 --user-data-dir="$HOME/.map-transfer-chrome"
//   2) 그 크롬에서 map.kakao.com / map.naver.com 둘 다 로그인.
//
// 사용:
//   node scripts/transfer-cdp.mjs --from kakao --to naver [--only "폴더명"] [--max-places N] [--cdp http://localhost:9222]
//
// 안전장치: 사용자의 크롬은 닫지 않는다. 저속 실행(rate-limit 완화).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { scrapeKakaoFavorites } from '../lib/scrape-kakao.mjs';
import { scrapeNaverFavorites } from '../lib/scrape-naver.mjs';
import { writeNaverFavorites } from '../lib/write-naver.mjs';
import { writeKakaoFavorites } from '../lib/write-kakao.mjs';
import { formatReport, formatDetailTable } from '../lib/report.mjs';

function safeName(s) {
  return (s || 'selected')
    .replace(/[\\/:"*?<>|]+/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 60);
}

function parseArgs(argv) {
  const a = { out: 'out', cdp: process.env.CAPTURE_CDP || 'http://localhost:9222' };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--from') a.from = argv[++i];
    else if (k === '--to') a.to = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--cdp') a.cdp = argv[++i];
    else if (k === '--only') a.only = argv[++i];
    else if (k === '--max-places') a.maxPlaces = parseInt(argv[++i], 10);
    else if (k === '--places-cache') a.placesCache = argv[++i];
    else if (k === '--threshold') a.threshold = parseFloat(argv[++i]);
    else if (k === '--early-exit') a.earlyExit = parseFloat(argv[++i]);
    else if (k === '--delay') a.delay = parseInt(argv[++i], 10);
  }
  return a;
}

// 소규모 e2e용: 특정 폴더만 / 폴더당 장소 수 제한
function filterPlaces(places, { only, maxPlaces }) {
  let folders = places.folders;
  if (only) {
    const names = only.split(',').map((s) => s.trim());
    folders = folders.filter((f) => names.includes(f.name));
  }
  if (maxPlaces) folders = folders.map((f) => ({ ...f, places: f.places.slice(0, maxPlaces) }));
  return { ...places, folders };
}

const args = parseArgs(process.argv);
const valid = ['kakao', 'naver'];
if (!valid.includes(args.from) || !valid.includes(args.to) || args.from === args.to) {
  console.error('사용법: node scripts/transfer-cdp.mjs --from <kakao|naver> --to <kakao|naver> [--only "폴더"] [--max-places N]');
  process.exit(1);
}

mkdirSync(args.out, { recursive: true });
const direction = `${args.from}->${args.to}`;
const directionDir = args.from === 'kakao' ? 'k_to_n' : 'n_to_k';
const directionOut = join(args.out, directionDir);
mkdirSync(directionOut, { recursive: true });
const browser = await chromium.connectOverCDP(args.cdp);
const context = browser.contexts()[0] || (await browser.newContext());
const page =
  context.pages().find((p) => /naver|kakao/.test(p.url())) ||
  context.pages()[0] ||
  (await context.newPage());
console.log(`[transfer] CDP 연결 ${args.cdp} / 방향 ${direction}`);

try {
  if (args.from === 'kakao' && args.to === 'naver') {
    let placesAll;
    if (args.placesCache) {
      placesAll = JSON.parse(readFileSync(args.placesCache, 'utf8'));
      console.log(`[1/2] 카카오 캐시 재사용: ${args.placesCache} (읽기 생략)`);
    } else {
      console.log('[1/2] 카카오 즐겨찾기 읽는 중...');
      placesAll = await scrapeKakaoFavorites(page, { log: console.log, only: args.only });
      writeFileSync(join(directionOut, 'places.json'), JSON.stringify(placesAll, null, 2));
    }
    const places = filterPlaces(placesAll, args);
    const folderCnt = places.folders.length;
    const placeCnt = places.folders.reduce((s, f) => s + f.places.length, 0);
    console.log(`[ok] 읽기 완료. 처리 대상: 폴더 ${folderCnt} / 장소 ${placeCnt}` + (args.only ? ` (only="${args.only}")` : ''));

    console.log('[2/2] 네이버에 쓰는 중... (저속, 폴더별 분리 저장)');
    // 폴더별로 out/<방향>/<폴더명>/에 따로 저장 → 장소가 많아도 한 파일에 안 섞임. 이어하기·증분도 폴더 단위.
    for (const folder of places.folders) {
      const outDir = join(directionOut, safeName(folder.name));
      mkdirSync(outDir, { recursive: true });
      let prevResult = null;
      try { prevResult = JSON.parse(readFileSync(join(outDir, 'result.json'), 'utf8')); } catch {}
      const save = (r, sort = false) => {
        writeFileSync(join(outDir, 'result.json'), JSON.stringify(r, null, 2));
        writeFileSync(join(outDir, 'report.md'), formatReport(r) + '\n\n' + formatDetailTable(r, sort));
      };
      console.log(`\n[폴더] ${folder.name} (${folder.places.length}곳) → ${outDir}/`);
      const single = { source: placesAll.source, folders: [folder] };
      const result = await writeNaverFavorites(page, single, { direction, log: console.log, prevResult, onProgress: save, threshold: args.threshold ?? 0.5, earlyExit: args.earlyExit ?? 0.6, delayMs: args.delay ?? 1500 });
      save(result, true); // 최종 저장 시 상태순 정렬
    }
    console.log('\n[완료] 폴더별 저장: ' + places.folders.map((f) => join(directionOut, safeName(f.name)) + '/').join(', '));
  } else if (args.from === 'naver' && args.to === 'kakao') {
    let placesAll;
    if (args.placesCache) {
      placesAll = JSON.parse(readFileSync(args.placesCache, 'utf8'));
      console.log(`[1/2] 네이버 캐시 재사용: ${args.placesCache} (읽기 생략)`);
    } else {
      console.log('[1/2] 네이버 즐겨찾기 읽는 중...');
      placesAll = await scrapeNaverFavorites(page, { log: console.log, only: args.only });
      writeFileSync(join(directionOut, 'places.json'), JSON.stringify(placesAll, null, 2));
    }
    const places = filterPlaces(placesAll, args);
    const folderCnt = places.folders.length;
    const placeCnt = places.folders.reduce((s, f) => s + f.places.length, 0);
    console.log(`[ok] 읽기 완료. 처리 대상: 폴더 ${folderCnt} / 장소 ${placeCnt}` + (args.only ? ` (only="${args.only}")` : ''));

    console.log('[2/2] 카카오에 쓰는 중... (저속, 폴더별 분리 저장)');
    // 폴더별로 out/<방향>/<폴더명>/에 따로 저장. 카카오는 폴더 없으면 '새 그룹 추가'로 생성 후 저장.
    for (const folder of places.folders) {
      const outDir = join(directionOut, safeName(folder.name));
      mkdirSync(outDir, { recursive: true });
      let prevResult = null;
      try { prevResult = JSON.parse(readFileSync(join(outDir, 'result.json'), 'utf8')); } catch {}
      const save = (r, sort = false) => {
        writeFileSync(join(outDir, 'result.json'), JSON.stringify(r, null, 2));
        writeFileSync(join(outDir, 'report.md'), formatReport(r) + '\n\n' + formatDetailTable(r, sort));
      };
      console.log(`\n[폴더] ${folder.name} (${folder.places.length}곳) → ${outDir}/`);
      const single = { source: placesAll.source, folders: [folder] };
      const result = await writeKakaoFavorites(page, single, { direction, log: console.log, prevResult, onProgress: save, threshold: args.threshold ?? 0.5, earlyExit: args.earlyExit ?? 0.6, delayMs: args.delay ?? 1500 });
      save(result, true); // 최종 저장 시 상태순 정렬
    }
    console.log('\n[완료] 폴더별 저장: ' + places.folders.map((f) => join(directionOut, safeName(f.name)) + '/').join(', '));
  } else {
    console.error(`[미구현] ${direction} 는 아직 지원 안 함.`);
    process.exit(2);
  }
} finally {
  await browser.close().catch(() => {}); // CDP 연결만 끊김(사용자 크롬은 유지)
}
