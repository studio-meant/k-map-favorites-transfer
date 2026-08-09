// 라이브 셀렉터 탐색 보조 (assisted discovery).
// headed 브라우저를 열고, 사용자가 로그인/이동/클릭하는 동안 주기적으로
//   - 스크린샷            out/<service>.png
//   - 구조화 DOM 덤프     out/<service>-dump.json
//   - 활성 패널 outerHTML out/<service>-panel.html
// 를 남긴다. 컨트롤러(Claude)가 이 파일들을 읽어 셀렉터를 찾는다.
//
// 사용법: node scripts/capture.mjs <kakao|naver> [패널셀렉터override]
//
// ⚠️ 탐색 전용: gitignore된 .pw-user/<service> 프로필에 세션을 저장해(로그인 1회) 반복 탐색을
//    빠르게 한다. 일반 실행은 interactive-transfer.mjs를 사용한다.
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';

const service = process.argv[2];
// argv[3]: http(s)로 시작하면 시작 URL, 아니면 패널 셀렉터 override
const arg3 = process.argv[3] || null;
const startUrlArg = arg3 && /^https?:\/\//.test(arg3) ? arg3 : null;
const panelOverride = startUrlArg ? null : arg3;
if (!['kakao', 'naver'].includes(service)) {
  console.error('사용법: node scripts/capture.mjs <kakao|naver> [패널셀렉터override]');
  process.exit(1);
}
const url =
  service === 'naver'
    ? 'https://map.naver.com/p/favorite/myPlace'
    : 'https://map.kakao.com/';

// 서비스별 좌측 패널 컨테이너 후보 (활성 뷰 outerHTML 덤프용; 네이버 iframe 내부에선 body)
const PANEL_SELECTORS = panelOverride
  ? [panelOverride]
  : service === 'naver'
    ? ['body', '.panel_content']
    : ['.FavoriteListView', '.FavoriteBodyList', '.favorite_result', '[id="info.search.place"]'];

mkdirSync('out', { recursive: true });
const DUMP = `out/${service}-dump.json`;
const SHOT = `out/${service}.png`;
const PANEL = `out/${service}-panel.html`;
const MAIN = `out/${service}-main.html`; // 메인 프레임 좌측 패널(검색/저장 UI)
const FRAMES = `out/${service}-frames.json`; // 모든 프레임 url 목록(어느 iframe에 뭐가 있는지)
const PLACE = `out/${service}-place.html`; // 네이버 장소 상세 iframe(pcmap.place) body
const TRIGGER = `out/${service}.trigger`; // 이 파일이 생기면 1장 캡처(평소엔 안 찍음)

// CAPTURE_CDP=http://localhost:9222 면 사용자의 실제 크롬(디버그 포트)에 연결한다.
// (Chrome-for-Testing 지문 회피 목적이 아니라, 실제 브라우저로 정상 동작시키기 위함)
const cdpEndpoint = process.env.CAPTURE_CDP || null;
const userDataDir = `.pw-user/${service}`;
let cdpBrowser = null;
let context;
if (cdpEndpoint) {
  cdpBrowser = await chromium.connectOverCDP(cdpEndpoint);
  context = cdpBrowser.contexts()[0] || (await cdpBrowser.newContext());
  console.log(`[capture] 실제 크롬에 CDP 연결됨 → ${cdpEndpoint}`);
} else {
  mkdirSync(userDataDir, { recursive: true });
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    locale: 'ko-KR',
    viewport: { width: 1440, height: 900 },
  });
  console.log(`[capture] (테스트 크롬) 프로필 ${userDataDir}`);
}
// 페이지 선택: 해당 서비스 도메인 탭 우선, 없으면 첫 탭/새 탭
const wanted = service === 'naver' ? 'naver' : 'kakao';
const page =
  context.pages().find((p) => p.url().includes(wanted)) ||
  context.pages()[0] ||
  (await context.newPage());
// CDP 모드에선 사용자가 이미 보고 있는 페이지를 건드리지 않는다(startUrl 줄 때만 이동).
if (startUrlArg) await page.goto(startUrlArg, { waitUntil: 'domcontentloaded' });
else if (!cdpEndpoint) await page.goto(url, { waitUntil: 'domcontentloaded' });
console.log(`[capture] 현재 페이지: ${page.url()}`);
console.log(`[capture] 'touch ${TRIGGER}' 시 1장 캡처 → ${SHOT}/${DUMP}/${PANEL}`);

// 네이버 즐겨찾기 폴더 목록은 pages.map.naver.com iframe 안에 있다 → 그 프레임을 타겟.
function pickFrame() {
  if (service === 'naver') {
    const f = page
      .frames()
      .find((fr) => /save-pages|pages\.map\.naver/.test(fr.url()));
    return f || page.mainFrame();
  }
  return page.mainFrame();
}

async function capture() {
  try {
    await page.screenshot({ path: SHOT, fullPage: false });
    const frame = pickFrame();
    const inIframe = frame !== page.mainFrame();
    const result = await frame.evaluate(
      ({ panelSelectors, dumpBody }) => {
        const info = (el) => ({
          tag: el.tagName.toLowerCase(),
          cls:
            el.className && el.className.toString
              ? el.className.toString().slice(0, 90)
              : '',
          id: el.id || '',
          role: el.getAttribute('role'),
          aria: el.getAttribute('aria-label'),
          data: [...el.attributes]
            .map((a) => a.name)
            .filter((n) => n.startsWith('data-'))
            .slice(0, 8),
          parentCls:
            el.parentElement &&
            el.parentElement.className &&
            el.parentElement.className.toString
              ? el.parentElement.className.toString().slice(0, 60)
              : '',
          text: (el.textContent || '').trim().slice(0, 60),
        });
        const sel =
          'li, [role="listitem"], a, button, input, [class*="folder" i], [class*="book" i], [class*="place" i], [class*="favorite" i], [class*="bookmark" i], [class*="directory" i], [class*="list" i], [class*="item" i]';
        const items = [...document.querySelectorAll(sel)]
          .filter((e) => (e.textContent || '').trim() || e.tagName === 'INPUT')
          .slice(0, 1500)
          .map(info);

        let panelHtml = '';
        if (dumpBody && document.body) {
          panelHtml = '<!-- iframe body -->\n' + document.body.outerHTML.slice(0, 120000);
        } else {
          for (const ps of panelSelectors) {
            const el = document.querySelector(ps);
            if (el && el.offsetParent !== null) {
              panelHtml = `<!-- panel: ${ps} -->\n` + el.outerHTML.slice(0, 120000);
              break;
            }
          }
          if (!panelHtml) {
            const el = document.querySelector(panelSelectors.join(','));
            if (el) panelHtml = '<!-- panel(hidden?) -->\n' + el.outerHTML.slice(0, 120000);
          }
        }
        return { url: location.href, count: items.length, items, panelHtml };
      },
      { panelSelectors: PANEL_SELECTORS, dumpBody: inIframe }
    );
    writeFileSync(
      DUMP,
      JSON.stringify(
        { url: result.url, inIframe, count: result.count, items: result.items },
        null,
        2
      )
    );
    writeFileSync(PANEL, result.panelHtml || '(no panel matched)');

    // 메인 프레임 좌측 패널도 별도로 덤프 (네이버 검색/저장 UI는 iframe 밖 메인에 있음)
    if (inIframe) {
      const mainHtml = await page.mainFrame().evaluate(() => {
        const el = document.querySelector('.panel_content, [class*="panel-container"]');
        return el ? el.outerHTML.slice(0, 120000) : '(no main panel)';
      });
      writeFileSync(MAIN, mainHtml);
    }

    // 모든 프레임 목록 (어느 iframe에 무엇이 있는지 파악용)
    const frameList = page.frames().map((fr) => ({ url: fr.url(), name: fr.name() }));
    writeFileSync(FRAMES, JSON.stringify(frameList, null, 2));

    // 네이버 장소 상세 iframe(pcmap.place) body 덤프 (저장 버튼/폴더 선택이 여기 있을 수 있음)
    const placeFrames = page
      .frames()
      .filter((fr) => /pcmap\.place\.naver|place\.naver\.com/.test(fr.url()));
    // 상세(/home, #bookmark, /<id>/) 프레임 우선, 검색결과 /list 프레임은 후순위
    const placeFrame =
      placeFrames.find((fr) => /\/home|#bookmark|\/\d+\//.test(fr.url())) ||
      placeFrames.find((fr) => !/\/list/.test(fr.url())) ||
      placeFrames[0];
    if (placeFrame) {
      const placeHtml = await placeFrame
        .evaluate(() => {
          // 저장(북마크) 위젯이 떠 있으면 그것만
          const w = document.querySelector('#swt-save-widget-wrap');
          if (w && w.innerHTML.trim())
            return '<!-- #swt-save-widget-wrap -->\n' + w.outerHTML.slice(0, 200000);
          if (!document.body) return '';
          // 아니면 body에서 style/script/svg/link 제거(=CSS 잡음 제거) 후 덤프
          const clone = document.body.cloneNode(true);
          clone.querySelectorAll('style, script, svg, link, noscript').forEach((e) => e.remove());
          return '<!-- place body (stripped) -->\n' + clone.outerHTML.slice(0, 200000);
        })
        .catch(() => '');
      writeFileSync(PLACE, placeHtml || '(place frame empty)');
    }
  } catch {
    // 페이지 전환/프레임 detach 중이면 이번 틱은 건너뜀
  }
}

// 깨끗한 종료(쿠키 flush → 세션 유지 개선) 위해 SIGTERM/SIGINT 처리
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  if (cdpEndpoint) {
    // 사용자의 실제 크롬은 닫지 않는다. 연결만 끊는다.
    await cdpBrowser.close().catch(() => {});
  } else {
    await context.close().catch(() => {}); // 쿠키 flush
  }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// 트리거 방식: 평소엔 스크린샷을 찍지 않는다(깜빡임 없음). out/<service>.trigger 파일이
// 생기면 그때 1장만 캡처한다. (컨트롤러가 `touch out/<service>.trigger`로 요청)
await capture(); // 시작 시 1회
const startedAt = Date.now();
const tick = async () => {
  try {
    if (existsSync(TRIGGER)) {
      rmSync(TRIGGER, { force: true });
      await capture();
      console.log('[capture] snapshot 갱신됨');
    }
  } catch {}
  if (Date.now() - startedAt > 90 * 60 * 1000) return shutdown(); // 90분 안전장치
  setTimeout(tick, 1500);
};
setTimeout(tick, 1500);
