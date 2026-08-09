// Interactive skill runner:
// direction 선택 → 로그인 확인 → source 폴더 목록 수집/선택 → transfer 실행 → 요약 + report.md 경로 출력.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { chromium } from 'playwright';
import { listKakaoFavoriteFolders, scrapeKakaoFavorites } from '../lib/scrape-kakao.mjs';
import { listNaverFavoriteFolders, scrapeNaverFavorites } from '../lib/scrape-naver.mjs';
import { writeKakaoFavorites } from '../lib/write-kakao.mjs';
import { writeNaverFavorites } from '../lib/write-naver.mjs';
import { formatDetailTable, formatReport } from '../lib/report.mjs';

const SERVICES = {
  kakao: { label: '카카오맵', loginUrl: 'https://map.kakao.com/' },
  naver: { label: '네이버맵', loginUrl: 'https://map.naver.com/p/favorite/myPlace' },
};

const DIRECTION_OPTIONS = [
  { key: '1', from: 'kakao', to: 'naver', label: '카카오맵 -> 네이버맵', dir: 'k_to_n' },
  { key: '2', from: 'naver', to: 'kakao', label: '네이버맵 -> 카카오맵', dir: 'n_to_k' },
];

function parseArgs(argv) {
  const a = {
    cdp: process.env.MAP_TRANSFER_CDP || process.env.CAPTURE_CDP || 'http://127.0.0.1:9222',
    cacheDir: process.env.MAP_TRANSFER_CACHE || join(process.env.HOME || process.cwd(), '.map-transfer-cache'),
    delay: 1500,
    threshold: 0.5,
    earlyExit: 0.6,
    waitLoginMs: 10 * 60 * 1000,
    targetGraceMs: 15000,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--from') a.from = argv[++i];
    else if (k === '--to') a.to = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--cdp') a.cdp = argv[++i];
    else if (k === '--only' || k === '--folders') a.only = argv[++i];
    else if (k === '--select') a.select = argv[++i];
    else if (k === '--all') a.all = true;
    else if (k === '--list-folders') a.listFolders = true;
    else if (k === '--skip-closed-check') a.skipClosedCheck = true;
    else if (k === '--folders-cache') a.foldersCache = argv[++i];
    else if (k === '--no-folders-cache') a.noFoldersCache = true;
    else if (k === '--cache-dir') a.cacheDir = argv[++i];
    else if (k === '--delay') a.delay = parseInt(argv[++i], 10);
    else if (k === '--threshold') a.threshold = parseFloat(argv[++i]);
    else if (k === '--early-exit') a.earlyExit = parseFloat(argv[++i]);
    else if (k === '--wait-login-ms') a.waitLoginMs = parseInt(argv[++i], 10);
    else if (k === '--target-grace-ms') a.targetGraceMs = parseInt(argv[++i], 10);
  }
  return a;
}

function directionFromArgs(args) {
  return DIRECTION_OPTIONS.find((d) => d.from === args.from && d.to === args.to) || null;
}

function safeName(s) {
  return (s || 'selected')
    .replace(/[\\/:"*?<>|]+/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 60);
}

function printIntro() {
  console.log('');
  console.log('카카오맵 ↔ 네이버맵 즐겨찾기 안전 복사');
  console.log('');
  console.log('- 실제 브라우저를 열어 사용자의 로컬 로그인 세션에서 동작합니다.');
  console.log('- 공개 API가 아니므로 본인 데이터 이전, 소량, 저속 실행을 전제로 합니다.');
  console.log('- 애매한 매칭은 리포트에 남기며, 실행 결과는 report.md/result.json으로 저장합니다.');
  console.log('');
}

function isInteractiveTerminal() {
  return input.isTTY && output.isTTY;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function directionKey(direction) {
  return `${direction.from}_to_${direction.to}`;
}

function foldersCachePath(args, direction) {
  if (args.foldersCache) return resolve(args.foldersCache);
  return join(args.cacheDir, `folders-${directionKey(direction)}.json`);
}

function writeFoldersCache(args, direction, folders) {
  if (args.noFoldersCache) return null;
  const path = foldersCachePath(args, direction);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ direction: directionKey(direction), savedAt: new Date().toISOString(), folders }, null, 2));
  return path;
}

function readFoldersCache(args, direction) {
  if (args.noFoldersCache) return null;
  try {
    const parsed = JSON.parse(readFileSync(foldersCachePath(args, direction), 'utf8'));
    if (parsed.direction === directionKey(direction) && Array.isArray(parsed.folders)) return parsed.folders;
  } catch {}
  return null;
}

function ensureRunnable(args) {
  if (isInteractiveTerminal()) return;
  if (directionFromArgs(args) && (args.listFolders || args.only || args.select || args.all)) return;

  const rawArgs = process.argv.slice(2);
  const suffix = rawArgs.length ? ` -- ${rawArgs.map(shellQuote).join(' ')}` : '';
  const command = `cd ${shellQuote(process.cwd())} && npm run interactive${suffix}`;
  console.error('');
  console.error('현재 shell은 stdin이 닫힌 비대화형 환경입니다.');
  console.error('');
  console.error('비대화형 환경에서는 방향과 폴더 선택을 옵션으로 미리 넘겨야 합니다.');
  console.error('Claude/Codex 안에서 끝까지 진행하려면 CDP Chrome을 먼저 켜세요.');
  console.error('');
  console.error('  npm run chrome:cdp');
  console.error('');
  console.error('먼저 폴더 목록을 보려면:');
  console.error('');
  console.error('  npm run interactive -- --from kakao --to naver --list-folders');
  console.error('');
  console.error('선택한 폴더를 옮기려면:');
  console.error('');
  console.error('  npm run interactive -- --from kakao --to naver --select "1,3-5" --skip-closed-check');
  console.error('  npm run interactive -- --from kakao --to naver --only "폴더명" --skip-closed-check');
  console.error('');
  console.error('전체 폴더를 옮기려면:');
  console.error('');
  console.error('  npm run interactive -- --from kakao --to naver --all --skip-closed-check');
  console.error('');
  console.error('대화형 터미널에서는 기존 명령을 그대로 사용할 수 있습니다.');
  console.error('');
  console.error(`  ${command}`);
  console.error('');
  process.exit(1);
}

async function chooseDirection(rl, args) {
  const byArgs = directionFromArgs(args);
  if (byArgs) return byArgs;
  if (!rl) throw new Error('비대화형 실행에서는 --from/--to 방향을 반드시 지정해야 합니다.');

  console.log('어디서 어디로 옮길까요?');
  for (const opt of DIRECTION_OPTIONS) console.log(`  ${opt.key}. ${opt.label}`);
  while (true) {
    const answer = (await rl.question('번호를 입력하세요 (1/2): ')).trim();
    const opt = DIRECTION_OPTIONS.find((d) => d.key === answer);
    if (opt) return opt;
    console.log('1 또는 2를 입력해 주세요.');
  }
}

function serviceHost(service) {
  return new URL(SERVICES[service].loginUrl).hostname;
}

function pageMatchesService(page, service) {
  try {
    return new URL(page.url()).hostname === serviceHost(service);
  } catch {
    return false;
  }
}

function isBlankLikePage(page) {
  const url = page.url();
  return url === 'about:blank' || url.startsWith('chrome://newtab') || url.startsWith('chrome://new-tab-page');
}

async function getServicePage(context, service, usedPages) {
  const pages = context.pages().filter((page) => !page.isClosed() && !usedPages.has(page));
  let page = pages.find((candidate) => pageMatchesService(candidate, service));
  let reused = true;

  if (!page) {
    page = pages.find(isBlankLikePage);
    if (!page) {
      page = await context.newPage();
    }
    reused = false;
    await page.goto(SERVICES[service].loginUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  }

  usedPages.add(page);
  return { page, reused };
}

async function openLoginTabs(context, direction) {
  const usedPages = new Set();
  const source = await getServicePage(context, direction.from, usedPages);
  const target = await getServicePage(context, direction.to, usedPages);
  const sourcePage = source.page;
  const targetPage = target.page;
  await sourcePage.bringToFront().catch(() => {});
  console.log(
    `[browser] source ${source.reused ? '기존 탭 재사용' : '새 탭 열기'} / target ${
      target.reused ? '기존 탭 재사용' : '새 탭 열기'
    }`
  );
  return { sourcePage, targetPage };
}

async function listFolders(page, service, { log = console.log } = {}) {
  if (service === 'kakao') return listKakaoFavoriteFolders(page, { log });
  if (service === 'naver') return listNaverFavoriteFolders(page, { log });
  throw new Error(`지원하지 않는 source: ${service}`);
}

function printFolders(folders) {
  console.log('');
  console.log('옮길 수 있는 source 폴더:');
  folders.forEach((f, i) => {
    const count = Number.isFinite(f.placeCount) ? ` (${f.placeCount}곳)` : '';
    console.log(`  ${i + 1}. ${f.name}${count}`);
  });
  console.log('');
}

function parseFolderSelection(answer, folders) {
  const s = answer.trim();
  if (!s || /^all|전체$/i.test(s)) return folders.map((f) => f.name);
  const selected = new Set();
  for (const part of s.split(',').map((p) => p.trim()).filter(Boolean)) {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const a = parseInt(range[1], 10);
      const b = parseInt(range[2], 10);
      for (let n = Math.min(a, b); n <= Math.max(a, b); n++) {
        if (folders[n - 1]) selected.add(folders[n - 1].name);
      }
      continue;
    }
    if (/^\d+$/.test(part)) {
      const f = folders[parseInt(part, 10) - 1];
      if (f) selected.add(f.name);
      continue;
    }
    const byName = folders.find((f) => f.name === part);
    if (byName) selected.add(byName.name);
  }
  return [...selected];
}

async function chooseFolders(rl, folders) {
  printFolders(folders);
  while (true) {
    const answer = await rl.question('옮길 폴더 번호/이름을 입력하세요. 여러 개는 쉼표, 전체는 Enter: ');
    const selected = parseFolderSelection(answer, folders);
    if (selected.length) return selected;
    console.log('선택된 폴더가 없습니다. 예: 1,3 또는 전체');
  }
}

function chooseFoldersFromArgs(args, folders) {
  if (folders.length) printFolders(folders);
  if (args.all) return folders.map((f) => f.name);
  if (args.only && !args.select) return args.only.split(',').map((s) => s.trim()).filter(Boolean);
  const selected = parseFolderSelection(args.select || args.only || '', folders);
  if (selected.length) return selected;
  throw new Error('선택된 폴더가 없습니다. --only "폴더명" 또는 --all을 지정해 주세요.');
}

function canUseCachedFolderSelection(args) {
  return !args.all && !!args.select && !args.only;
}

function needsLiveFolderList(args) {
  return args.listFolders || args.all || (!args.only && !canUseCachedFolderSelection(args));
}

async function scrapeSelectedFolders(page, service, selectedNames, args) {
  const only = selectedNames.join(',');
  if (service === 'kakao') return scrapeKakaoFavorites(page, { log: console.log, only, checkClosed: !args.skipClosedCheck });
  if (service === 'naver') return scrapeNaverFavorites(page, { log: console.log, only });
  throw new Error(`지원하지 않는 source: ${service}`);
}

async function waitForSourceFolders(page, service, timeoutMs) {
  const started = Date.now();
  let attempt = 0;
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    attempt++;
    try {
      const folders = await listFolders(page, service, { log: () => {} });
      if (folders.length) return folders;
    } catch (e) {
      lastError = e;
    }
    const elapsedSec = Math.round((Date.now() - started) / 1000);
    console.log(`[login] ${service} source 폴더 목록을 기다리는 중... (${elapsedSec}s)`);
    await delay(Math.min(5000, 1500 + attempt * 500));
  }
  throw new Error(
    `source 폴더 목록을 제한 시간 안에 읽지 못했습니다. 열린 Chrome에서 source 지도 로그인을 확인해 주세요.` +
      (lastError ? ` 마지막 오류: ${lastError.message}` : '')
  );
}

async function openBrowserContext(args) {
  try {
    const browser = await chromium.connectOverCDP(args.cdp);
    const context = browser.contexts()[0] || (await browser.newContext({ locale: 'ko-KR' }));
    return { browser, context, close: async () => browser.close().catch(() => {}) };
  } catch (e) {
    const reason = String(e.message || e).split('\n')[0];
    throw new Error(
      `Chrome CDP에 연결하지 못했습니다: ${args.cdp}\n` +
        `먼저 별도 명령으로 CDP Chrome을 열어 주세요: npm run chrome:cdp\n` +
        `원인: ${reason}`
    );
  }
}

function makeFolderOutDirs(args, direction, folderNames) {
  const baseDir = args.out ? resolve(args.out) : resolve(join('out', direction.dir));
  const outDirs = new Map();

  for (const name of folderNames) {
    const outDir = args.out && folderNames.length === 1 ? baseDir : join(baseDir, safeName(name));
    outDirs.set(name, outDir);
  }
  return outDirs;
}

function saveReport(outDir, result, sort = false) {
  const summary = formatReport(result);
  const report = `${summary}\n\n${formatDetailTable(result, sort)}`;
  writeFileSync(join(outDir, 'result.json'), JSON.stringify(result, null, 2));
  writeFileSync(join(outDir, 'report.md'), report);
  return summary;
}

async function writeSelectedFolders(page, service, places, direction, args, outDir) {
  let prevResult = null;
  try {
    prevResult = JSON.parse(readFileSync(join(outDir, 'result.json'), 'utf8'));
    console.log(`[resume] 기존 결과를 이어서 사용합니다: ${join(outDir, 'result.json')}`);
  } catch {}

  const common = {
    direction: `${direction.from}->${direction.to}`,
    log: console.log,
    delayMs: args.delay,
    threshold: args.threshold,
    earlyExit: args.earlyExit,
    prevResult,
    onProgress: (r) => saveReport(outDir, r, false),
  };
  if (service === 'naver') return writeNaverFavorites(page, places, common);
  if (service === 'kakao') return writeKakaoFavorites(page, places, common);
  throw new Error(`지원하지 않는 target: ${service}`);
}

const args = parseArgs(process.argv);
ensureRunnable(args);
const interactive = isInteractiveTerminal();
const rl = interactive ? readline.createInterface({ input, output }) : null;
let browserSession = null;

try {
  printIntro();
  const direction = await chooseDirection(rl, args);
  console.log(`선택: ${direction.label}`);
  console.log('');

  browserSession = await openBrowserContext(args);
  console.log(`[browser] Chrome CDP에 연결했습니다: ${args.cdp}`);
  const { sourcePage, targetPage } = await openLoginTabs(browserSession.context, direction);

  console.log('브라우저 탭을 열었습니다.');
  console.log(`- source: ${SERVICES[direction.from].label}`);
  console.log(`- target: ${SERVICES[direction.to].label}`);
  if (interactive) {
    await rl.question('두 탭에서 각각 로그인한 뒤 Enter를 눌러 주세요: ');
  } else {
    console.log('');
    console.log('열린 Chrome 탭에서 source/target 지도에 각각 로그인해 주세요.');
    console.log('스크립트가 source 폴더 목록을 감지할 때까지 자동으로 기다립니다.');
  }

  await sourcePage.bringToFront().catch(() => {});
  console.log('');
  console.log(`[1/3] ${SERVICES[direction.from].label} 폴더 목록을 준비하는 중...`);
  let folders = null;
  if (canUseCachedFolderSelection(args)) {
    folders = readFoldersCache(args, direction);
    if (folders) console.log(`[cache] 이전 폴더 목록을 사용합니다: ${foldersCachePath(args, direction)}`);
  }
  if (!folders && needsLiveFolderList(args)) {
    folders = interactive
      ? await listFolders(sourcePage, direction.from)
      : await waitForSourceFolders(sourcePage, direction.from, args.waitLoginMs);
    const cachePath = writeFoldersCache(args, direction, folders);
    if (cachePath) console.log(`[cache] 폴더 목록 저장: ${cachePath}`);
  }
  if (!folders && args.only) folders = [];
  if (!folders) throw new Error('source 폴더 목록이 필요하지만 캐시를 찾지 못했습니다. 먼저 --list-folders를 실행해 주세요.');
  if (!folders.length && !args.only) throw new Error('source 폴더를 찾지 못했습니다. 로그인 상태와 지도 UI를 확인해 주세요.');

  if (args.listFolders) {
    printFolders(folders);
    console.log('폴더 목록만 출력하고 종료합니다.');
    console.log('');
    console.log('선택한 폴더를 옮기려면 예를 들어 다음 명령을 실행하세요.');
    console.log(`  npm run interactive -- --from ${direction.from} --to ${direction.to} --select "1,3-5" --skip-closed-check`);
    console.log(`  npm run interactive -- --from ${direction.from} --to ${direction.to} --only "폴더명" --skip-closed-check`);
    console.log('');
    console.log('전체 폴더를 옮기려면:');
    console.log(`  npm run interactive -- --from ${direction.from} --to ${direction.to} --all --skip-closed-check`);
    process.exitCode = 0;
  } else {
    const hasSelectionArgs = args.all || args.only || args.select;
    const selectedNames = hasSelectionArgs ? chooseFoldersFromArgs(args, folders) : await chooseFolders(rl, folders);
    console.log('');
    console.log(`선택한 폴더: ${selectedNames.join(', ')}`);

    console.log('');
    console.log(`[2/3] 선택한 폴더의 장소를 읽는 중...`);
    const places = await scrapeSelectedFolders(sourcePage, direction.from, selectedNames, args);
    const placeCount = places.folders.reduce((sum, f) => sum + (f.places?.length || 0), 0);
    console.log(`[ok] 폴더 ${places.folders.length}개 / 장소 ${placeCount}개 읽음`);
    if (!places.folders.length) throw new Error('선택한 폴더에서 장소를 읽지 못했습니다.');

    await targetPage.bringToFront().catch(() => {});
    if (interactive) {
      await rl.question(`${SERVICES[direction.to].label} 로그인 상태를 확인한 뒤 Enter를 누르면 옮기기를 시작합니다: `);
    } else if (args.targetGraceMs > 0) {
      console.log('');
      console.log(`${SERVICES[direction.to].label} 로그인 상태 확인을 위해 ${Math.round(args.targetGraceMs / 1000)}초 대기합니다.`);
      await delay(args.targetGraceMs);
    }

    console.log('');
    console.log(`[3/3] ${SERVICES[direction.to].label}에 옮기는 중...`);
    const outDirs = makeFolderOutDirs(
      args,
      direction,
      places.folders.map((folder) => folder.name)
    );
    const reports = [];

    for (const folder of places.folders) {
      const outDir = outDirs.get(folder.name);
      mkdirSync(outDir, { recursive: true });
      const singleFolderPlaces = { ...places, folders: [folder] };
      writeFileSync(join(outDir, 'places.json'), JSON.stringify(singleFolderPlaces, null, 2));

      console.log('');
      console.log(`[폴더] ${folder.name} -> ${outDir}`);
      const result = await writeSelectedFolders(targetPage, direction.to, singleFolderPlaces, direction, args, outDir);
      const summary = saveReport(outDir, result, true);
      reports.push({ folderName: folder.name, outDir, summary });
    }

    console.log('');
    console.log('폴더별 이전 결과 요약');
    for (const report of reports) {
      console.log('');
      console.log(`[${report.folderName}]`);
      console.log(report.summary);
    }
    console.log('');
    console.log('전체 결과 리포트:');
    for (const report of reports) console.log(`- ${report.folderName}: ${join(report.outDir, 'report.md')}`);
    console.log('');
    console.log('원본 데이터:');
    for (const report of reports) console.log(`- ${report.folderName}: ${join(report.outDir, 'places.json')}`);
  }
} catch (e) {
  console.error('');
  console.error(`[error] ${e.message}`);
  process.exitCode = 1;
} finally {
  if (rl) rl.close();
  if (browserSession) await browserSession.close();
}
