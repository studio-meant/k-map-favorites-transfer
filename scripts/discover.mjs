// 탐색 보조: 브라우저를 열고, 사용자가 즐겨찾기 화면을 띄운 뒤 Enter를 누르면
// 현재 페이지의 후보 요소 구조를 덤프한다. 셀렉터를 직접 찾을 때 참고용.
import readline from 'node:readline';
import { launchBrowser, gotoAndWaitLogin } from '../lib/browser.mjs';

const service = process.argv[2];
if (!['kakao', 'naver'].includes(service)) {
  console.error('사용법: node scripts/discover.mjs <kakao|naver>');
  process.exit(1);
}

function waitEnter(msg) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(msg, () => { rl.close(); res(); }));
}

const { browser, context } = await launchBrowser();
const page = await context.newPage();
await gotoAndWaitLogin(page, service, { onPrompt: console.log });
await waitEnter('\n즐겨찾기 화면을 띄운 뒤 Enter를 누르세요 (구조 덤프)...\n');

// 후보 구조 덤프: 리스트로 보이는 반복 요소들의 태그/클래스/텍스트 일부
const dump = await page.evaluate(() => {
  const items = [...document.querySelectorAll('li, [role="listitem"], a, button')].slice(0, 400);
  return items
    .filter((el) => el.textContent && el.textContent.trim().length > 0)
    .slice(0, 120)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      cls: el.className?.toString().slice(0, 60),
      role: el.getAttribute('role'),
      aria: el.getAttribute('aria-label'),
      text: el.textContent.trim().slice(0, 40),
    }));
});
console.log(JSON.stringify(dump, null, 2));
await waitEnter('\n확인 후 Enter를 누르면 브라우저를 닫습니다...\n');
await browser.close();
