#!/usr/bin/env node
// 웹도구 브라우저 검증 — 명세 01의 완료 조건을 실제로 실행해서 확인한다.
//
//   npm install && node tools/build.mjs && node tools/verify-ui.mjs
//
// 명세 02/03을 구현할 때도 여기에 검사를 덧붙이세요. "구현했다"가 아니라
// "실행해서 확인했다"를 남기는 게 이 파일의 목적입니다.

import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const URL = 'file://' + join(process.cwd(), 'web/index.html');
const chars = JSON.parse(readFileSync('data/characters.json', 'utf8'));

// PLAYWRIGHT_BROWSERS_PATH의 chromium을 찾는다. 없으면 기본 해석에 맡긴다.
function chromePath() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  for (const d of ['chromium-1194', 'chromium']) {
    const p = join(base, d, 'chrome-linux', 'chrome');
    if (existsSync(p)) return p;
  }
  return undefined;
}

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

const browser = await chromium.launch({ executablePath: chromePath() });
const page = await browser.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(e.message));

const bodyText = () => page.evaluate(() => document.body.innerText);
async function join_(name, code) {
  await page.fill('#in-name', name);
  await page.fill('#in-code', code);
  await page.click('#btn-join');
  await page.waitForTimeout(700);
}

// ── XSS: 플레이어 이름 ───────────────────────────────────────────────
await page.goto(URL);
await join_('<img src=x onerror="document.title=\'PWNED\'">', 'VER01');
check('플레이어 이름의 스크립트가 실행되지 않음', !(await page.title()).includes('PWNED'));

// ── 스토리지 모드와 키 분리 ──────────────────────────────────────────
const topbar = await page.evaluate(() => document.querySelector('.topbar')?.innerText ?? '');
check('저장 모드가 UI에 표시됨', /로컬 저장|공유 세션|저장 안 됨/.test(topbar), topbar.replace(/\n/g, ' '));

const keys = await page.evaluate(() => Object.keys(localStorage));
check('키가 주체별로 분리 저장됨 (명세 01 §2)',
  keys.some((k) => /^hg:VER01:char:/.test(k)) && keys.includes('hg:VER01:claims'),
  `${keys.length}개 키`);

// ── 캐릭터 렌더 ──────────────────────────────────────────────────────
await page.click('.tab-btn[data-tab="char"]');
await page.waitForTimeout(300);
check('캐릭터 16종 렌더', (await page.locator('.char-card').count()) === chars.length);

// ── 비밀: 점유자 본인에게는 보인다 ───────────────────────────────────
// 카드 클릭은 곧 점유다. 따라서 '미점유 열람'은 남이 점유한 캐릭터를
// 열었을 때만 성립하며, 그 검사는 아래 플레이어 B 흐름에서 한다.
await page.locator('.char-card', { hasText: '세라' }).first().click();
await page.waitForTimeout(600);
const sera = chars.find((c) => c.name === '세라');
let text = await bodyText();
check('점유한 본인의 비밀은 보임', text.includes(sera.secret));
check('본인 캐릭터를 열어도 남의 비밀은 안 보임',
  chars.filter((c) => c.name !== '세라' && text.includes(c.secret)).length === 0);

// ── 편집 대상이 선택한 캐릭터와 일치하는가 ───────────────────────────
// 카드 클릭 후 시트가 그 캐릭터로 바뀌지 않으면, 편집이 이전 캐릭터에
// 저장된다. 실제로 있었던 버그라 회귀 검사로 남긴다.
const sheetName = (await page.locator('.sheet .name').innerText()).trim();
check('카드를 클릭하면 시트도 그 캐릭터로 바뀜', sheetName === '세라', `시트=${sheetName}`);

await page.fill('#f-hp', '7');
await page.dispatchEvent('#f-hp', 'change');
await page.waitForTimeout(600);

// 입력값이 아니라 저장소를 본다 — 크롬은 reload 시 폼 값을 복원하므로
// inputValue로 확인하면 저장이 안 돼도 통과하는 오탐이 난다.
const stored = await page.evaluate(() => ({
  sera: localStorage.getItem('hg:VER01:char:세라'),
  eden: localStorage.getItem('hg:VER01:char:이든'),
}));
check('HP 변경이 해당 캐릭터에 저장됨', JSON.parse(stored.sera || '{}').hp === 7, `세라=${stored.sera}`);
check('다른 캐릭터가 오염되지 않음', JSON.parse(stored.eden || '{}').hp !== 7, `이든=${stored.eden}`);

// ── 플레이어 B로 재접속 — 영속 + 남의 비밀 차단 ──────────────────────
// 폼 복원이 없는 새 탐색으로 확인한다 (reload는 크롬이 입력값을 되살려
// 저장이 안 돼도 통과하는 오탐을 만든다).
page.on('dialog', (d) => d.accept()); // '이미 선택된 캐릭터입니다' 확인창
await page.goto('about:blank');
await page.goto(URL);
await join_('플레이어B', 'VER01');
await page.click('.tab-btn[data-tab="char"]');
await page.waitForTimeout(300);
await page.locator('.char-card', { hasText: '세라' }).first().click();
await page.waitForTimeout(600);

check('재접속 후에도 HP가 유지됨 (localStorage 영속)',
  (await page.inputValue('#f-hp').catch(() => null)) === '7');

text = await bodyText();
check('남이 점유한 캐릭터의 비밀은 안 보임', !text.includes(sera.secret));
check('비밀 자리에 안내 문구가 남음', /비밀[^\n]*GM/.test(text));
check('B의 화면 어디에도 비밀이 없음',
  chars.filter((c) => text.includes(c.secret)).length === 0);

// ── XSS: 로그 + 평문 보존 ────────────────────────────────────────────
await page.click('.tab-btn[data-tab="log"]');
await page.waitForTimeout(300);
await page.fill('#new-log', '<img src=x onerror="document.title=\'LOGPWN\'"> HP < 10일 때');
await page.click('#add-log');
await page.waitForTimeout(600);
check('로그 입력의 스크립트가 실행되지 않음', !(await page.title()).includes('LOGPWN'));
check('로그의 `HP < 10` 같은 평문이 깨지지 않음', (await bodyText()).includes('HP < 10'));

// ── 기존 기능 회귀 ───────────────────────────────────────────────────
await page.click('.tab-btn[data-tab="dice"]');
await page.waitForTimeout(300);
check('주사위 탭 동작', (await page.locator('.dice-grid button').count()) >= 6);

check('페이지 에러 없음', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

await browser.close();

// ── 출력 ─────────────────────────────────────────────────────────────
console.log('\n웹도구 브라우저 검증\n' + '─'.repeat(62));
for (const r of results) {
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
const failed = results.filter((r) => !r.pass).length;
console.log('─'.repeat(62));
console.log(`  ${results.length - failed}/${results.length} 통과\n`);
process.exit(failed ? 1 : 0);
