#!/usr/bin/env node
// 웹도구 브라우저 검증 — 명세 01의 완료 조건을 실제로 실행해서 확인한다.
//
//   npm install && node tools/build.mjs && node tools/verify-ui.mjs
//
// 명세 02/03을 구현할 때도 여기에 검사를 덧붙이세요. "구현했다"가 아니라
// "실행해서 확인했다"를 남기는 게 이 파일의 목적입니다.

import { chromium } from 'playwright';
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const URL = 'file://' + join(process.cwd(), 'web/index.html');
const chars = JSON.parse(readFileSync('data/characters.json', 'utf8'));
const rules = JSON.parse(readFileSync('data/rules.json', 'utf8'));

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

// ══════════════════════════════════════════════════════════════════════
// 명세 04 — 비밀 분리 빌드 (docs/specs/04-secret-split.md)
// 아래 두 검사는 브라우저가 필요 없다 — 빌드 산출물 파일을 그대로 읽는다.
// [렌더링] 기준 검사(위 브라우저 검사들)와 다르게 이건 **소스 기준**이다:
// document.body.innerText가 아니라 파일 바이트 자체에 비밀 문자열이
// 있는지를 본다. docs/adr/001-p2p-sync.md '단서' 절이 지적한 차이가 이거다.
// ══════════════════════════════════════════════════════════════════════
{
  const indexHtmlRaw = readFileSync(join(process.cwd(), 'web/index.html'), 'utf8');
  const leaked = chars.filter((c) => indexHtmlRaw.includes(c.secret));
  check('[소스] web/index.html에 16개 비밀이 하나도 인라인되지 않음 (완료 조건의 node -e 검사 재현)',
    leaked.length === 0, leaked.length ? `누출: ${leaked.map((c) => c.name).join(', ')}` : '0/16');

  const secretsPath = join(process.cwd(), 'web/secrets.json');
  const secretsExists = existsSync(secretsPath);
  check('web/secrets.json이 빌드로 생성됨', secretsExists);
  const secretsMap = secretsExists ? JSON.parse(readFileSync(secretsPath, 'utf8')) : {};
  check('web/secrets.json에 캐릭터 16명의 비밀이 정확히 담김(data/characters.json과 일치)',
    Object.keys(secretsMap).length === chars.length && chars.every((c) => secretsMap[c.name] === c.secret));
}

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

// ── 명세 04: 이 세션의 사용자가 GM을 겸하며 web/secrets.json을 불러온다 ──
// 명세 01/03 시절에는 secret이 항상 PREGENS에 인라인돼 있어 "점유하면 곧
// 보인다"가 전제였다. 명세 04부터는 그 전제 자체가 사라진다 — 아무도
// secrets.json을 불러오지 않으면 PREGENS[].secret이 아예 없다(빌드가
// 뺐다). 그래서 바로 아래 "점유한 본인의 비밀은 보임" 검사(명세 01)가
// 여전히 성립하려면, 그 전에 누군가 GM을 자처하고 비밀 파일을 실제로
// 불러온 상태여야 한다 — 1인 로컬 플레이에서는 GM과 점유자가 같은
// 사람일 수 있으므로 이 흐름 자체가 정상적인 사용 시나리오다.
await page.click('.tab-btn[data-tab="gm"]');
await page.waitForTimeout(200);
await page.click('button:has-text("내가 이 세션의 GM입니다")');
await page.waitForTimeout(300);
check('GM을 자처하면 isGM 전용 "비밀 파일" 슬롯이 나타남', await page.locator('#gm-net-slot').innerText().then((t) => /비밀 파일/.test(t)));
await page.setInputFiles('#gm-net-slot input[type=file]', join(process.cwd(), 'web/secrets.json'));
await page.waitForTimeout(300);
check('GM이 secrets.json을 불러오면 "비밀 로드됨" 배지로 바뀜',
  await page.locator('#gm-net-slot').innerText().then((t) => /비밀 로드됨/.test(t)));
await page.click('.tab-btn[data-tab="char"]');
await page.waitForTimeout(200);

// ── 비밀: 점유자 본인에게는 보인다 ───────────────────────────────────
// 주의: 아래 비밀 검사는 전부 **렌더링 기준**(document.body.innerText)이다.
// 명세 04 이후 사전 제작 캐릭터의 secret 16개는 빌드 시 index.html에
// 인라인되지 않는다(위 [소스] 검사가 그걸 확인한다) — 위에서 이 세션이
// GM으로서 secrets.json을 이미 불러왔으므로, 아래 검사는 "불러온 비밀이
// 점유자 본인에게는 실제로 보이는가"를 확인한다.
// 카드 클릭은 곧 점유다. 따라서 '미점유 열람'은 남이 점유한 캐릭터를
// 열었을 때만 성립하며, 그 검사는 아래 플레이어 B 흐름에서 한다.
await page.locator('.char-card', { hasText: '세라' }).first().click();
await page.waitForTimeout(600);
const sera = chars.find((c) => c.name === '세라');
let text = await bodyText();
check('[렌더링] 점유한 본인의 비밀은 보임', text.includes(sera.secret));
check('[렌더링] 본인 캐릭터를 열어도 남의 비밀은 안 보임',
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
check('[렌더링] 남이 점유한 캐릭터의 비밀은 안 보임', !text.includes(sera.secret));
check('비밀 자리에 안내 문구가 남음', /비밀[^\n]*GM/.test(text));
check('[렌더링] B의 화면 어디에도 비밀이 없음',
  chars.filter((c) => text.includes(c.secret)).length === 0);

// [소스] 명세 04 — GM이 secrets.json을 한 번도 불러오지 않은 이 세션에서는
// page.content()(현재 DOM의 직렬화된 마크업 — 렌더된 텍스트가 아니라 소스)와
// localStorage 어디에도 비밀 문자열이 없어야 한다. [렌더링] 검사와 달리
// document.body.innerText가 아니라 DOM 소스/저장소를 직접 훑는다는 게 차이다.
const bPageSource = await page.content();
check('[소스] B의 페이지 소스(DOM 마크업)에 어떤 비밀 문자열도 없음(명세 04 — 렌더링이 아니라 소스 기준)',
  chars.filter((c) => bPageSource.includes(c.secret)).length === 0);
const bLocalStorageDump = await page.evaluate(() => JSON.stringify(localStorage));
check('[소스] B의 localStorage에 어떤 비밀 문자열도 없음(명세 04)',
  chars.filter((c) => bLocalStorageDump.includes(c.secret)).length === 0);

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

// ══════════════════════════════════════════════════════════════════════
// 명세 02 — 판정 엔진 (docs/specs/02-check-engine.md)
// 여전히 '플레이어B'로 VER01 방에 접속해 있다.
// ══════════════════════════════════════════════════════════════════════
const checkSlot = () => page.locator('#check-slot');
const checkSelects = () => checkSlot().locator('select');
async function selectCheckChar(label) { await checkSelects().nth(0).selectOption({ label }); await page.waitForTimeout(250); }
async function selectCheckSkill(value) { await checkSelects().nth(1).selectOption(value); await page.waitForTimeout(250); }

// ── 보정 내역 자동 산출 + 부상 자동 반영 ──────────────────────────────
// 세라는 이전 단계에서 hp=7/19(<50%)로 저장되어 있다 → 중상이어야 한다.
await selectCheckChar('세라');
await selectCheckSkill('skill:melee'); // 근접전투 — 세라의 숙련 기술(결투 별칭으로도 매칭)
let checkText = await checkSlot().innerText();
check('보정 내역이 항상 펼쳐 보임(자동 합산 근거 표시)', /보정 내역/.test(checkText));
check('숙련 기술은 숙련 +2가 보정 내역에 자동으로 붙음', /숙련/.test(checkText) && /\+2/.test(checkText));
check('중상 캐릭터(세라, HP 7/19)의 판정에 부상 -2가 자동 반영됨', checkText.includes('부상(중상)'));

// ── HP를 절반 아래로 내리면 부상 단계가 자동으로 중상이 됨 ────────────
// (기존 수동 드롭다운은 ui.js 소유라 이 명세가 제거할 수 없다 — 대신
// 자동 계산값을 판정에 실제로 적용하고 불일치를 표시한다. 아래에서
// 그 자동 계산이 HP 변경 직후 실제로 갱신됨을 확인한다.)
await page.click('.tab-btn[data-tab="char"]');
await page.waitForTimeout(300);
await page.locator('.char-card', { hasText: '라비' }).first().click();
await page.waitForTimeout(500);
const 라비Sheet = chars.find((c) => c.name === '라비');
await page.fill('#f-hp', String(Math.floor(라비Sheet.maxHp / 2) - 1)); // 절반 미만이 되도록
await page.dispatchEvent('#f-hp', 'change');
await page.waitForTimeout(600);
await page.click('.tab-btn[data-tab="dice"]');
await page.waitForTimeout(300);
await selectCheckChar('라비');
await selectCheckSkill('skill:stealth'); // 은신 — 라비의 숙련
checkText = await checkSlot().innerText();
check('HP를 절반 아래로 내리면 부상 단계가 자동으로 중상이 됨', /중상/.test(checkText) && checkText.includes('부상(중상)'));

// ── 잔향 페널티는 신체 능력치(STR/AGI/CON) 판정에만 붙는다 ────────────
await page.click('.tab-btn[data-tab="char"]');
await page.waitForTimeout(300);
await page.locator('.char-card', { hasText: '이든' }).first().click();
await page.waitForTimeout(500);
await page.fill('#f-rad', '55'); // 50 이상 임계치
await page.dispatchEvent('#f-rad', 'change');
await page.waitForTimeout(600);
await page.click('.tab-btn[data-tab="dice"]');
await page.waitForTimeout(300);
await selectCheckChar('이든');
await selectCheckSkill('skill:melee'); // 근접전투 = STR(신체)
checkText = await checkSlot().innerText();
check('잔향 50 이상 캐릭터의 STR(신체) 판정에는 -2가 붙음', checkText.includes('잔향(50 이상)'));
await selectCheckSkill('skill:lore'); // 지식 = INT(비신체)
checkText = await checkSlot().innerText();
check('잔향 50 이상이어도 INT(비신체) 판정에는 안 붙음', !checkText.includes('잔향(50 이상)'));

// ── 판정 버튼 → 4단계 결과 표시 ────────────────────────────────────────
await checkSlot().locator('button.primary', { hasText: '판정 (d20)' }).first().click();
await page.waitForTimeout(400);
checkText = await checkSlot().innerText();
check('판정 후 4단계 결과 중 하나가 표시됨',
  rules.outcomeTiers.some((t) => checkText.includes(t.effect)));
check('자연 20/자연 1 우선순위 안내가 UI에 남아 있음(룰북 모호 지점)', /자연 1[\s\S]{0,20}우선/.test(checkText));

// ── errata R-5: 표에 없는 기술은 임의 매칭하지 않고 능력치 직접 선택으로 넘긴다 ──
await selectCheckChar('도경'); // 도경의 '기계정비(숙련)'는 기술 표에 없음(errata R-5)
const dogyeongOptions = await checkSelects().nth(1).locator('option').allTextContents();
check('숙련 기술이 드롭다운 위쪽에 ★로 정렬됨', dogyeongOptions[0].startsWith('★'));
check("표에 없는 숙련('기계정비')이 ⚠ 표시로 드롭다운에 남아 있음", dogyeongOptions.some((o) => o.includes('⚠') && o.includes('기계정비')));
const rawOption = dogyeongOptions.find((o) => o.includes('기계정비'));
await checkSelects().nth(1).selectOption({ label: rawOption });
await page.waitForTimeout(250);
checkText = await checkSlot().innerText();
check('매칭 실패 시 임의로 추측하지 않고 GM에게 능력치 직접 선택을 요구함', /표에 없습니다/.test(checkText));
await checkSlot().locator('button', { hasText: 'INT · 지능' }).first().click();
await page.waitForTimeout(250);
checkText = await checkSlot().innerText();
check('능력치를 직접 고르면 그 능력치로 보정이 계산됨(숙련 보너스는 자동 적용 안 됨)',
  /능력치 INT/.test(checkText) && !checkText.includes('+2  숙련'));

// ── 그룹 판정: 개시 → 여러 명 굴림(네트워크 없이 혼자 전부 입력) → 과반 집계 ──
const rosterLabels = checkSlot().locator('.char-grid label');
const rosterCount = await rosterLabels.count();
for (let i = 0; i < rosterCount; i++) {
  const cb = rosterLabels.nth(i).locator('input[type=checkbox]');
  if (await cb.isChecked()) await cb.uncheck();
}
const roster = ['이든', '세라', '라비', '준'];
for (const name of roster) {
  await rosterLabels.filter({ hasText: name }).locator('input[type=checkbox]').check();
}
const groupSelects = checkSelects();
const groupSelectCount = await groupSelects.count();
await groupSelects.nth(groupSelectCount - 2).selectOption('stealth'); // 그룹 판정 기술
await groupSelects.nth(groupSelectCount - 1).selectOption('12');      // 그룹 판정 DC
await checkSlot().locator('button.primary', { hasText: '그룹 판정 개시' }).click();
await page.waitForTimeout(500);
checkText = await checkSlot().innerText();
check('그룹 판정 개시 후 대기 목록이 뜸', roster.every((n) => checkText.includes(n)));

for (let i = 0; i < roster.length; i++) {
  await checkSlot().locator('.init-list .init-item button', { hasText: '이 캐릭터로 굴리기' }).first().click();
  await page.waitForTimeout(400);
}
const rows = await checkSlot().locator('.init-list .init-item').allInnerTexts();
function tierOf(text) {
  if (text.includes('대성공')) return 'crit';
  if (text.includes('부분 성공')) return 'partial';
  if (text.includes('실패')) return 'fail';
  if (text.includes('성공')) return 'success';
  return null;
}
const tiers = rows.map(tierOf);
check('혼자서(GM 1명)도 참가자 전원의 그룹 판정을 굴릴 수 있음', tiers.length === roster.length && tiers.every((t) => t !== null));
const successCount = tiers.filter((t) => t === 'crit' || t === 'success').length;
const expectedOutcome = successCount / tiers.length > rules.groupCheck.successThreshold ? rules.groupCheck.onMajority : rules.groupCheck.onMinority;
const expectedLabel = rules.outcomeTiers.find((t) => t.id === expectedOutcome).label;

await checkSlot().locator('button.primary', { hasText: /집계/ }).click();
await page.waitForTimeout(400);
checkText = await checkSlot().innerText();
check('그룹 판정 과반 집계 결과가 Rules.groupResult와 일치함',
  checkText.includes(expectedLabel), `성공 ${successCount}/${tiers.length} → 기대 '${expectedLabel}'`);

// ── 여파화 d10: 결과가 캐릭터에 붙고 로그에 남음 ───────────────────────
await selectCheckChar('이든');
await checkSlot().locator('button', { hasText: '여파화 판정 (d10)' }).click();
await page.waitForTimeout(500);
const eden = await page.evaluate(() => JSON.parse(localStorage.getItem('hg:VER01:char:이든') || '{}'));
check('여파화 d10 결과가 캐릭터 상태에 부착되어 저장됨', Array.isArray(eden.mutations) && eden.mutations.length >= 1, JSON.stringify(eden.mutations || []));

await page.click('.tab-btn[data-tab="log"]');
await page.waitForTimeout(300);
const logText = await bodyText();
check('여파화 판정이 세션 로그에 남음', /여파화 판정/.test(logText));
check('판정 굴림이 세션 로그에 남음', /판정:/.test(logText) || /그룹\]/.test(logText));

check('페이지 에러 없음', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

await browser.close();

// ══════════════════════════════════════════════════════════════════════
// 명세 03 — P2P 동기화 (docs/specs/03-p2p-sync.md)
//
// 중요한 한계부터 밝힌다: 이 환경은 아웃바운드가 정책 프록시를 거치고,
// 공개 PeerJS 시그널링 브로커(0.peerjs.com)는 그 프록시의 CONNECT
// 단계에서 403으로 거부된다 — curl과 이 파일의 "진짜 브로커" 검사
// 둘 다로 직접 확인했다. 즉 **이 스위트는 실제 WebRTC 시그널링·STUN·
// NAT 통과를 검증하지 못한다.** 같은 머신의 두 탭이었어도 마찬가지였을
// 한계지만(그건 프로토콜만 증명하고 NAT 통과는 증명 못 한다), 여기서는
// 시그널링 자체가 막혀 있어 그 단계까지도 못 간다.
//
// 그래서 아래 검사들은 net.js의 실제 프로토콜 로직(클레임 경합, 점유자
// 검증, HP/잔향 클램프, 비밀 필터링, 재접속 시 로컬 조작 유지, 상태
// 내보내기/가져오기)을 "가짜 시그널링"으로 검증한다. 서로 다른
// BrowserContext(= 완전히 분리된 localStorage를 가진 별개의 클라이언트,
// ADR-001이 말하는 "각자의 브라우저"에 해당) 여러 개를 띄우고,
// window.Peer만 실제 PeerJS 대신 Node가 중계하는 인메모리 스텁으로
// 바꿔치기한다. net.js·ui-net.js 코드는 한 글자도 건드리지 않는다 —
// Peer 생성자만 대체하고, DataChannel이 있었을 자리를 Playwright의
// page↔Node 브리지가 대신할 뿐이다. 즉 "네트워크가 실제로 뚫리는가"가
// 아니라 "뚫렸다고 가정했을 때 우리 프로토콜이 옳은가"를 확인하는
// 것이며, 이 구분을 결과 보고에서 분명히 한다.
// ══════════════════════════════════════════════════════════════════════

function installFakePeer() {
  window.__fakeConns = {};
  let connCounter = 0;
  window.__fakeRecv = function (msg) {
    if (msg.type === 'open') { (window.__fakeOpenHandlers || []).forEach((h) => h(msg.id)); }
    else if (msg.type === 'peer-error') { (window.__fakeErrorHandlers || []).forEach((h) => h({ type: msg.err })); }
    else if (msg.type === 'connection') {
      const conn = makeConn(msg.connId, msg.fromPeer);
      window.__fakeConns[msg.connId] = conn;
      (window.__fakeConnHandlers || []).forEach((h) => h(conn));
      setTimeout(() => conn.__fireOpen(), 0);
    } else if (msg.type === 'conn-open') {
      const c = window.__fakeConns[msg.connId]; if (c) c.__fireOpen();
    } else if (msg.type === 'data') {
      const c = window.__fakeConns[msg.connId]; if (c) c.__fireData(msg.data);
    } else if (msg.type === 'close') {
      const c = window.__fakeConns[msg.connId]; if (c) c.__fireClose();
    }
  };
  function makeConn(connId, otherPeer) {
    const dH = [], oH = [], cH = [];
    const conn = {
      peer: otherPeer,
      open: false,
      on(ev, cb) { if (ev === 'data') dH.push(cb); else if (ev === 'open') oH.push(cb); else if (ev === 'close') cH.push(cb); },
      send(obj) { window.__bridgeSend({ type: 'data', connId, data: obj }); },
      close() { conn.open = false; window.__bridgeSend({ type: 'close', connId }); cH.forEach((h) => h()); },
      __fireOpen() { conn.open = true; oH.forEach((h) => h()); },
      __fireData(d) { dH.forEach((h) => h(d)); },
      __fireClose() { conn.open = false; cH.forEach((h) => h()); },
    };
    return conn;
  }
  window.Peer = function (id) {
    window.__fakeOpenHandlers = [];
    window.__fakeConnHandlers = [];
    window.__fakeErrorHandlers = [];
    window.__bridgeSend({ type: 'register', id: id || null });
    return {
      on(ev, cb) {
        if (ev === 'open') window.__fakeOpenHandlers.push(cb);
        else if (ev === 'connection') window.__fakeConnHandlers.push(cb);
        else if (ev === 'error') window.__fakeErrorHandlers.push(cb);
      },
      connect(targetId) {
        const connId = 'c' + (++connCounter) + '-' + Math.random().toString(16).slice(2);
        const conn = makeConn(connId, targetId);
        window.__fakeConns[connId] = conn;
        window.__bridgeSend({ type: 'connect', connId, targetId });
        return conn;
      },
      destroy() { window.__bridgeSend({ type: 'destroy' }); },
      reconnect() {},
    };
  };
}

// 가짜 시그널링 허브(Node 쪽) — peerId 등록/라우팅/데이터 중계만 한다.
// 실제 PeerJS 클라우드 브로커가 하는 일(방 코드 점유, 연결 성사, 메시지
// 전달)을 아주 얇게 흉내 낼 뿐, net.js의 프로토콜 판단에는 관여하지 않는다.
function createFakeSignalingHub() {
  const registry = new Map();
  const pageIds = new Map();
  const routes = new Map();
  let anon = 0;

  async function attach(page) {
    await page.exposeFunction('__bridgeSend', async (msg) => { await handle(page, msg); });
    page.on('close', () => disconnectPeer(page));
  }
  async function deliver(page, msg) {
    try { await page.evaluate((m) => { if (window.__fakeRecv) window.__fakeRecv(m); }, msg); }
    catch (e) { /* 페이지가 이미 닫혔을 수 있음 — 무해 */ }
  }
  async function handle(fromPage, msg) {
    if (msg.type === 'register') {
      let id = msg.id;
      if (id) {
        if (registry.has(id) && registry.get(id) !== fromPage) { await deliver(fromPage, { type: 'peer-error', err: 'unavailable-id' }); return; }
      } else {
        id = 'anon-' + (++anon);
      }
      registry.set(id, fromPage);
      pageIds.set(fromPage, id);
      await deliver(fromPage, { type: 'open', id });
    } else if (msg.type === 'connect') {
      const target = registry.get(msg.targetId);
      if (!target) { await deliver(fromPage, { type: 'peer-error', err: 'peer-unavailable' }); return; }
      routes.set(msg.connId, { a: fromPage, b: target });
      await deliver(target, { type: 'connection', connId: msg.connId, fromPeer: pageIds.get(fromPage) });
      await deliver(fromPage, { type: 'conn-open', connId: msg.connId });
    } else if (msg.type === 'data') {
      const r = routes.get(msg.connId); if (!r) return;
      await deliver(r.a === fromPage ? r.b : r.a, { type: 'data', connId: msg.connId, data: msg.data });
    } else if (msg.type === 'close') {
      const r = routes.get(msg.connId); if (!r) return;
      routes.delete(msg.connId);
      await deliver(r.a === fromPage ? r.b : r.a, { type: 'close', connId: msg.connId });
    } else if (msg.type === 'destroy') {
      const id = pageIds.get(fromPage);
      if (id) registry.delete(id);
      pageIds.delete(fromPage);
    }
  }
  function disconnectPeer(page) {
    for (const [connId, r] of [...routes.entries()]) {
      if (r.a === page || r.b === page) {
        routes.delete(connId);
        deliver(r.a === page ? r.b : r.a, { type: 'close', connId });
      }
    }
    const id = pageIds.get(page);
    if (id) registry.delete(id);
    pageIds.delete(page);
  }
  return { attach, disconnectPeer };
}

async function waitForNetStatus(page, want, timeout = 8000) {
  // Net은 최상위 스크립트의 const 바인딩이라 window.Net이 아니라 맨 식별자로만 보인다
  // (모든 web/src/*.js가 template.html의 <script> 하나에 이어붙여 인라인되기 때문).
  await page.waitForFunction((w) => (typeof Net !== 'undefined') && Net.status === w, want, { timeout });
}
async function newFakePage(browser2, hub) {
  const ctx = await browser2.newContext();
  const p = await ctx.newPage();
  await hub.attach(p);
  await p.goto(URL);
  await p.evaluate(installFakePeer);
  return { ctx, page: p };
}
async function joinAs(p, name, code, mode) {
  await p.fill('#in-name', name);
  await p.fill('#in-code', code);
  if (mode !== 'local') await p.evaluate((m) => { document.getElementById('in-net-mode').value = m; }, mode);
  await p.click('#btn-join');
}

const browser2 = await chromium.launch({ executablePath: chromePath() });

// ── 빌드 산출물: PeerJS가 실제로 벤더링·인라인되었는가 ────────────────
{
  const html = readFileSync(join(process.cwd(), 'web/index.html'), 'utf8');
  check('빌드 산출물에 PeerJS가 인라인됨(주석에 벤더 출처가 남아 있고 CDN이 아님)',
    html.includes('web/vendor/peerjs.min.js') && /window\.Peer\s*=/.test(html));
  check('빌드 산출물에 http(s) 외부 리소스 참조가 없음',
    !/\s(?:src|href)\s*=\s*["']https?:\/\//i.test(html));
}

// ── 네트워크를 완전히 끈 상태(file://)에서도 100% 동작해야 한다 ─────
// (Playwright context의 offline:true는 file:// 자체는 막지 않고, 그
// 위에서 일어나는 모든 네트워크 요청만 끊는다 — "네트워크가 하나도 안
// 붙어도 도구는 100% 동작해야 한다"는 원칙을 실제로 요청을 차단한 채로 검증한다.)
{
  const offCtx = await browser2.newContext({ offline: true });
  const offPage = await offCtx.newPage();
  await offPage.goto(URL);
  await offPage.fill('#in-name', '오프라인유저');
  await offPage.fill('#in-code', 'OFFCAS');
  await offPage.click('#btn-join');
  await offPage.waitForTimeout(500);
  const offUsable = await offPage.evaluate(() => document.getElementById('app').style.display !== 'none');
  await offPage.click('.tab-btn[data-tab="char"]');
  await offPage.waitForTimeout(200);
  await offPage.locator('.char-card', { hasText: '라비' }).first().click();
  await offPage.waitForTimeout(300);
  await offPage.fill('#f-hp', '5');
  await offPage.dispatchEvent('#f-hp', 'change');
  await offPage.waitForTimeout(300);
  await offPage.click('.tab-btn[data-tab="dice"]');
  await offPage.waitForTimeout(200);
  await offPage.click('.dice-grid button:has-text("d20")');
  await offPage.waitForTimeout(300);
  const offStored = await offPage.evaluate(() => localStorage.getItem('hg:OFFCAS:char:라비'));
  check('네트워크를 완전히 끈 상태(context.offline)에서도 입장·캐릭터시트·주사위가 전부 동작함',
    offUsable && JSON.parse(offStored || '{}').hp === 5);
  await offCtx.close();
}

// ── 참고용: 진짜 공개 PeerJS 브로커 도달성(pass/fail 집계에 넣지 않는다) ──
// 실패가 예상되는 이 샌드박스의 환경 한계를 실제로 실행해서 기록만 해 둔다.
{
  const ctx = await browser2.newContext();
  const p = await ctx.newPage();
  await p.goto(URL);
  await p.fill('#in-name', '실브로커테스트');
  await p.fill('#in-code', 'REALX1');
  await p.evaluate(() => { document.getElementById('in-net-mode').value = 'host'; });
  const before = Date.now();
  await p.click('#btn-join');
  await p.waitForTimeout(11000); // net.js의 연결 타임아웃(10s)이 지날 때까지 기다린다
  const realStatus = await p.evaluate(() => (typeof Net !== 'undefined' ? Net.status : 'N/A'));
  const realUsable = await p.evaluate(() => document.getElementById('app').style.display !== 'none');
  console.log(`  [참고] 공개 PeerJS 브로커(0.peerjs.com) 연결 시도 — status=${realStatus}, ` +
    `소요=${Date.now() - before}ms, 실패해도 세션 계속 사용 가능=${realUsable} ` +
    `(이 샌드박스는 아웃바운드 프록시가 0.peerjs.com을 막는다 — curl로도 403 확인됨)`);
  await ctx.close();
}

// ── 가짜 시그널링으로 프로토콜 전체 흐름 검증 ─────────────────────────
const hub = createFakeSignalingHub();
const P2P_ROOM = 'FAKE01';

const { ctx: ctxGM, page: pageGM } = await newFakePage(browser2, hub);
await joinAs(pageGM, 'GM진행자', P2P_ROOM, 'host');
await waitForNetStatus(pageGM, 'host').catch(() => {});
check('호스트가 방을 열면 status=host', (await pageGM.evaluate(() => Net.status)) === 'host');
check('입장 시점에 GM이 자동 지정됨(§6 — GM 지정이 입장 시점에 정해져야 한다)',
  (await pageGM.evaluate(() => ROOM && ROOM.gm)) === 'GM진행자');

const { ctx: ctxB, page: pageB } = await newFakePage(browser2, hub);
const { ctx: ctxC, page: pageC } = await newFakePage(browser2, hub);
pageB.on('dialog', (d) => { pageB.__lastDialogMsg = d.message(); d.accept(); });
pageC.on('dialog', (d) => { pageC.__lastDialogMsg = d.message(); d.accept(); });
await joinAs(pageB, '손님B', P2P_ROOM, 'join');
await waitForNetStatus(pageB, 'guest').catch(() => {});
check('손님이 참가하면 status=guest', (await pageB.evaluate(() => Net.status)) === 'guest');
await joinAs(pageC, '손님C', P2P_ROOM, 'join');
await waitForNetStatus(pageC, 'guest').catch(() => {});
await pageB.waitForTimeout(400);
check('GM 화면에 접속자 2명이 뜬다(ui-net.js 접속자 목록)',
  (await pageGM.evaluate(() => Net.peers().length)) === 2, await pageGM.evaluate(() => JSON.stringify(Net.peers())));

// ── 동시 점유 경합 → 한쪽만 성공, 다른 쪽은 거절 사유 표시 ───────────
await pageB.click('.tab-btn[data-tab="char"]');
await pageC.click('.tab-btn[data-tab="char"]');
await pageB.waitForTimeout(200); await pageC.waitForTimeout(200);
await Promise.all([
  pageB.locator('.char-card', { hasText: '겨울' }).first().click(),
  pageC.locator('.char-card', { hasText: '겨울' }).first().click(),
]);
await pageB.waitForTimeout(900); await pageC.waitForTimeout(900);
const claimWinnerName = await pageGM.evaluate(() => ROOM.claims['겨울']);
check('동시 점유 시도 — GM 쪽에는 정확히 한 명만 점유자로 기록됨',
  claimWinnerName === '손님B' || claimWinnerName === '손님C', `겨울 점유자=${claimWinnerName}`);
const loserDialogMsg = claimWinnerName === '손님B' ? pageC.__lastDialogMsg : pageB.__lastDialogMsg;
check('패자 쪽에 거절 사유가 표시됨', !!loserDialogMsg && /선택|점유/.test(loserDialogMsg), loserDialogMsg || '(없음)');
const winnerPage = claimWinnerName === '손님B' ? pageB : pageC;
const loserPage = claimWinnerName === '손님B' ? pageC : pageB;

// ── HP 동기화 + GM의 클램프(0..maxHp) ─────────────────────────────────
await winnerPage.click('.tab-btn[data-tab="char"]');
await winnerPage.waitForTimeout(200);
await winnerPage.fill('#f-hp', '9999'); // maxHp를 훨씬 넘는 값 — GM이 클램프해야 한다
await winnerPage.dispatchEvent('#f-hp', 'change');
await winnerPage.waitForTimeout(700);
const gmSeesHp = await pageGM.evaluate(() => ROOM.characters['겨울'].hp);
const winterMaxHp = await pageGM.evaluate(() => PREGENS.find((p) => p.name === '겨울').maxHp);
check('플레이어가 과도한 HP를 보내도 GM이 0..maxHp로 클램프함(§3)',
  gmSeesHp === winterMaxHp, `보냄=9999, GM 저장값=${gmSeesHp}, maxHp=${winterMaxHp}`);
await loserPage.waitForTimeout(300);
check('B의 HP 변경이 A(GM)뿐 아니라 다른 접속자에게도 즉시 반영됨(4초 폴링 아님)',
  (await loserPage.evaluate(() => ROOM.characters['겨울'].hp)) === winterMaxHp);

// ── 굴림 즉시 방송 (완료 조건: A/B 어느 쪽 굴림이든 다른 쪽에 즉시 표시) ──
await loserPage.click('.tab-btn[data-tab="dice"]');
await loserPage.waitForTimeout(200);
await loserPage.click('.dice-grid button:has-text("d20")');
await loserPage.waitForTimeout(500);
check('플레이어의 굴림이 GM 화면에 즉시 뜸',
  await pageGM.evaluate(() => (ROOM.log || []).some((l) => l.type === 'roll' && l.text.includes('d20'))));
check('그 굴림이 다른 플레이어 화면에도 즉시 뜸',
  await winnerPage.evaluate(() => (ROOM.log || []).some((l) => l.type === 'roll' && l.text.includes('d20'))));

// 점유하지 않은 캐릭터를 향한 위조 update는 GM이 무시해야 한다(§3 — "점유자
// 본인인지 확인"). 실제 UI로는 만들 수 없는 시나리오라 Net.send()를 직접
// 호출해 흉내 낸다 — net.js 코드는 건드리지 않는다.
await loserPage.evaluate(() => {
  Net.send({ v: 1, t: 'state', room: { ...ROOM, characters: { ...ROOM.characters, 겨울: { ...ROOM.characters['겨울'], hp: 1 } } } });
});
await pageGM.waitForTimeout(500);
check('점유하지 않은 캐릭터를 향한 위조 update는 GM이 무시함(점유자 검증)',
  (await pageGM.evaluate(() => ROOM.characters['겨울'].hp)) === winterMaxHp);

// ── 비밀 필터링(§4) — 남의 캐릭터 메모가 그 브라우저에 아예 도착하지 않음 ──
await pageGM.click('.tab-btn[data-tab="char"]');
await pageGM.waitForTimeout(200);
await pageGM.locator('.char-card', { hasText: '이든' }).first().click();
await pageGM.waitForTimeout(500);
const SECRET_MARKER = 'TOPSECRET-' + Math.random().toString(16).slice(2);
await pageGM.fill('#f-notes', SECRET_MARKER);
await pageGM.dispatchEvent('#f-notes', 'change');
await pageGM.waitForTimeout(600);
check('GM 자신은 남의 캐릭터 메모를 그대로 봄',
  await pageGM.evaluate((m) => JSON.stringify(ROOM).includes(m), SECRET_MARKER));
check('점유하지 않은 손님 브라우저의 메모리(JSON.stringify(ROOM))에는 그 메모가 아예 없음(§4 — 안 보여주기가 아니라 안 보내기)',
  !(await loserPage.evaluate((m) => JSON.stringify(ROOM).includes(m), SECRET_MARKER)) &&
  !(await winnerPage.evaluate((m) => JSON.stringify(ROOM).includes(m), SECRET_MARKER)));

// ══════════════════════════════════════════════════════════════════════
// 비밀 분리 빌드(§4, docs/specs/04-secret-split.md) — GM이 실제 "비밀 파일
// 불러오기" UI(#gm-net-slot의 file input)로 web/secrets.json을 읽어들이면,
// 그 시점부터 점유자에게만 자기 캐릭터의 비밀이 P2P로 도착하는지 확인한다.
// winnerPage는 앞서 '겨울'을 점유했고, loserPage는 아무것도 점유하지 않은
// 상태다(위 동시 점유 경합 결과) — 그래서 winnerPage만 겨울의 비밀을 받아야
// 하고, loserPage는 어떤 비밀도 받지 말아야 한다.
// ══════════════════════════════════════════════════════════════════════
const secretsMap = JSON.parse(readFileSync(join(process.cwd(), 'web/secrets.json'), 'utf8'));
const winterSecret = secretsMap['겨울'];
const otherSecretsForWinner = Object.entries(secretsMap).filter(([n]) => n !== '겨울').map(([, s]) => s);
const allSecretValues = Object.values(secretsMap);

await pageGM.click('.tab-btn[data-tab="gm"]');
await pageGM.waitForTimeout(300);
const secretsDir = mkdtempSync(join(tmpdir(), 'hg-secrets-'));
const secretsFilePath = join(secretsDir, 'secrets.json');
writeFileSync(secretsFilePath, JSON.stringify(secretsMap));
await pageGM.setInputFiles('#gm-net-slot input[type=file]', secretsFilePath);
await pageGM.waitForTimeout(500);

check('GM이 secrets.json을 불러오면 로컬 PREGENS 전체에 비밀이 즉시 채워짐',
  await pageGM.evaluate((expected) => PREGENS.every((p) => p.secret === expected[p.name]), secretsMap));
const gmSecretsSlotText = await pageGM.locator('#gm-net-slot').innerText();
check('GM 화면에 "비밀 로드됨" 배지가 표시됨', /비밀 로드됨/.test(gmSecretsSlotText));

await winnerPage.waitForTimeout(500);
check('[소스] 겨울 점유자(winnerPage)의 PREGENS에 자기 캐릭터의 비밀이 P2P로 도착함(안 보여주기가 아니라 안 보내기)',
  await winnerPage.evaluate((expected) => {
    const p = PREGENS.find((x) => x.name === '겨울');
    return !!p && p.secret === expected;
  }, winterSecret));
check('[소스] 겨울을 점유하지 않은 손님(loserPage)의 PREGENS에는 겨울의 비밀이 오지 않음',
  await loserPage.evaluate(() => {
    const p = PREGENS.find((x) => x.name === '겨울');
    return !p || !p.secret;
  }));

const winnerSourceAfterSecrets = await winnerPage.content();
check('[소스] 겨울 점유자의 페이지 소스(DOM 마크업)에 다른 캐릭터의 비밀 문자열이 없음',
  otherSecretsForWinner.every((s) => !winnerSourceAfterSecrets.includes(s)));
const winnerLocalStorageAfterSecrets = await winnerPage.evaluate(() => JSON.stringify(localStorage));
check('[소스] 겨울 점유자의 localStorage에 다른 캐릭터의 비밀 문자열이 없음',
  otherSecretsForWinner.every((s) => !winnerLocalStorageAfterSecrets.includes(s)));

const loserSourceAfterSecrets = await loserPage.content();
check('[소스] 미점유 손님(loserPage)의 페이지 소스에 어떤 비밀 문자열도 없음',
  allSecretValues.every((s) => !loserSourceAfterSecrets.includes(s)));
const loserLocalStorageAfterSecrets = await loserPage.evaluate(() => JSON.stringify(localStorage));
check('[소스] 미점유 손님(loserPage)의 localStorage에 어떤 비밀 문자열도 없음',
  allSecretValues.every((s) => !loserLocalStorageAfterSecrets.includes(s)));

// 이중 방어(명세 01의 렌더링 차단) 확인 — 자기 비밀을 받은 점유자가 실제로
// 캐릭터시트를 열면 화면에 보이고, 남의 비밀은 여전히 안 보여야 한다.
await winnerPage.click('.tab-btn[data-tab="char"]');
await winnerPage.waitForTimeout(200);
await winnerPage.locator('.char-card', { hasText: '겨울' }).first().click();
await winnerPage.waitForTimeout(400);
const winnerSheetText = await winnerPage.evaluate(() => document.body.innerText);
check('[렌더링] P2P로 비밀을 받은 점유자는 자기 캐릭터의 비밀을 실제로 봄', winnerSheetText.includes(winterSecret));
check('[렌더링] 점유자 화면에도 남의 비밀은 안 보임(이중 방어 — 명세 01 렌더링 게이트 유지)',
  otherSecretsForWinner.every((s) => !winnerSheetText.includes(s)));

// ── GM 이탈 → 플레이어 쪽 "연결 끊김" 표시 + 로컬 조작은 계속 ────────
await ctxGM.close();
await loserPage.waitForTimeout(1500);
check('GM 탭을 닫으면 플레이어 쪽 status가 disconnected로 바뀜',
  (await loserPage.evaluate(() => Net.status)) === 'disconnected');
check('상단바에 "연결 끊김" 배지가 표시됨(ui-net.js §6)',
  (await loserPage.evaluate(() => (document.getElementById('topbar-net-slot') || {}).innerText || '')).includes('연결 끊김'));
await loserPage.click('.tab-btn[data-tab="log"]');
await loserPage.waitForTimeout(200);
await loserPage.fill('#new-log', 'GM 없이도 기록되는 로그');
await loserPage.click('#add-log');
await loserPage.waitForTimeout(400);
check('연결이 끊긴 동안에도 로컬 조작(로그 추가)은 계속 됨',
  await loserPage.evaluate(() => (ROOM.log || []).some((l) => l.text.includes('GM 없이도 기록되는 로그'))));

// ── 존재하지 않는 방 코드로 참가 → 세션을 막지 않고 로컬 모드로 남음 ──
const { ctx: ctxD, page: pageD } = await newFakePage(browser2, hub);
await joinAs(pageD, '손님D', 'NOPE99', 'join');
await pageD.waitForTimeout(1500);
check('존재하지 않는 방 코드 → 세션이 막히지 않고 앱이 계속 뜸(오류 팝업으로 막지 않음)',
  await pageD.evaluate(() => document.getElementById('app').style.display !== 'none'));
await pageD.click('.tab-btn[data-tab="char"]');
await pageD.waitForTimeout(200);
check('로컬 모드로 남아 캐릭터시트가 정상 동작함', (await pageD.locator('.char-card').count()) === chars.length);
await ctxD.close();

// ── 최후 수단: 상태 내보내기 → 다른 탭에서 가져오기 → 새 허브로 동작 ──
await winnerPage.click('.tab-btn[data-tab="gm"]');
await winnerPage.waitForTimeout(300);
const [download] = await Promise.all([
  winnerPage.waitForEvent('download'),
  winnerPage.click('button:has-text("세션 상태 내보내기")'),
]);
const exported = JSON.parse(readFileSync(await download.path(), 'utf8'));
check('내보낸 JSON에 방 코드와 room 스냅샷이 담김',
  exported.v === 1 && exported.roomCode === P2P_ROOM && !!exported.room);

const importDir = mkdtempSync(join(tmpdir(), 'hg-export-'));
const importFile = join(importDir, 'export.json');
writeFileSync(importFile, JSON.stringify(exported));

const { ctx: ctxE, page: pageE } = await newFakePage(browser2, hub);
await pageE.setInputFiles('#join-net-slot input[type=file]', importFile);
await pageE.waitForTimeout(400);
check('가져오기 후 자동으로 "GM으로 방 열기" + 방 코드가 채워짐(§5 4단계)',
  (await pageE.evaluate(() => document.getElementById('in-net-mode').value)) === 'host' &&
  (await pageE.evaluate(() => document.getElementById('in-code').value)) === P2P_ROOM);
await pageE.fill('#in-name', '이어받은사람');
await pageE.click('#btn-join'); // 원래 호스트(pageGM)는 이미 닫았으므로 이 방 코드는 비어 있다
await waitForNetStatus(pageE, 'host').catch(() => {});
check('가져온 상태로 새 허브가 정상적으로 섬(GM 이탈의 해법)',
  (await pageE.evaluate(() => Net.status)) === 'host');
check('가져온 방에 기존 점유 정보가 그대로 남아 있음',
  (await pageE.evaluate(() => ROOM.claims['겨울'])) === claimWinnerName);
await ctxE.close();

await ctxB.close(); await ctxC.close();
await browser2.close();

// ── 출력 ─────────────────────────────────────────────────────────────
console.log('\n웹도구 브라우저 검증\n' + '─'.repeat(62));
for (const r of results) {
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
const failed = results.filter((r) => !r.pass).length;
console.log('─'.repeat(62));
console.log(`  ${results.length - failed}/${results.length} 통과\n`);
process.exit(failed ? 1 : 0);
