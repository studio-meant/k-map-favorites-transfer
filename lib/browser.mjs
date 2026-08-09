import { chromium } from 'playwright';
import { services } from '../config/selectors.mjs';

// headed Google Chrome 1개. 세션은 디스크에 저장하지 않음(매번 로그인).
export async function launchBrowser() {
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const context = await browser.newContext({ locale: 'ko-KR' });
  return { browser, context };
}

// 사람 같은 속도를 위한 대기
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 해당 서비스 즐겨찾기 페이지로 이동 후, 사용자가 로그인할 때까지 대기.
// loginCheck 셀렉터가 보이면 로그인 완료로 판단. 없으면 콘솔 안내 후 수동 Enter 대기.
export async function gotoAndWaitLogin(page, service, { onPrompt } = {}) {
  const cfg = services[service];
  await page.goto(cfg.favoritesUrl, { waitUntil: 'domcontentloaded' });
  if (cfg.loginCheck) {
    if (onPrompt) onPrompt(`${cfg.label}에 로그인해 주세요. 로그인 감지 중...`);
    await page.waitForSelector(cfg.loginCheck, { timeout: 0 });
  } else if (onPrompt) {
    onPrompt(`${cfg.label}에 로그인한 뒤 터미널에서 Enter를 눌러주세요.`);
  }
}

// 무한스크롤 로딩: 컨테이너(또는 window)를 더 이상 높이가 안 늘 때까지 스크롤
export async function autoScroll(page, containerSelector) {
  let lastHeight = -1;
  for (let i = 0; i < 50; i++) {
    const height = await page.evaluate((sel) => {
      const el = sel ? document.querySelector(sel) : null;
      const target = el || document.scrollingElement || document.body;
      target.scrollTop = target.scrollHeight;
      return target.scrollHeight;
    }, containerSelector);
    if (height === lastHeight) break;
    lastHeight = height;
    await sleep(700);
  }
}
