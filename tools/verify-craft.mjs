#!/usr/bin/env node
// tools/verify-craft.mjs — 즉석 조합 · 캐릭터 빌더 브라우저 검증 (명세 06)
//
//   npm install && node tools/build.mjs && node tools/verify-craft.mjs
//
// tools/verify-ui.mjs의 구조(check() 헬퍼, chromePath(), 결과 집계)를 그대로
// 본떴다 — 다만 verify-ui.mjs 자체는 명세 04/05가 계속 덧붙이고 있어 손대지
// 않는다(docs/specs/06-crafting-and-builder.md). 이 파일은 이 명세의 완료
// 조건(docs/specs/06-crafting-and-builder.md 맨 아래 체크리스트)만 다룬다.
//
// 판정에는 d20/d10/d6 굴림이 섞여 있어 "성공/실패/부분 성공"을 확정적으로
// 재현하려면 Math.random()을 통제해야 한다. ui-craft.js/ui-builder.js 코드는
// 한 글자도 건드리지 않고, 페이지가 로드되기 전에 Math.random을 "미리 채워둔
// 큐에서 하나씩 꺼내 쓰는" 버전으로 바꿔치기한다(queue가 비면 원래 함수로
// 폴백) — verify-ui.mjs가 가짜 PeerJS Peer로 net.js를 흔들지 않고 검증하는
// 것과 같은 원리다.

import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const URL = 'file://' + join(process.cwd(), 'web/index.html');
const rules = JSON.parse(readFileSync('data/rules.json', 'utf8'));
const chars = JSON.parse(readFileSync('data/characters.json', 'utf8'));

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

// ── Math.random 통제 ─────────────────────────────────────────────────
// n번째(1-based) 눈이 나오게 하는 대체값. 버킷 중간(0.4/sides만큼 안쪽)을
// 써서 부동소수점 경계 오차로 옆 눈이 나오는 사고를 피한다.
function randFor(n, sides) { return (n - 1) / sides + 0.4 / sides; }

async function installRandomPatch(page) {
  await page.addInitScript(() => {
    window.__rndQueue = [];
    const orig = Math.random.bind(Math);
    Math.random = () => (window.__rndQueue.length ? window.__rndQueue.shift() : orig());
  });
}
async function queueRandom(page, values) {
  await page.evaluate((vals) => { window.__rndQueue.push(...vals); }, values);
}

const browser = await chromium.launch({ executablePath: chromePath() });
const page = await browser.newPage();
await installRandomPatch(page);
page.on('dialog', (d) => d.accept()); // "결정편이 소모됩니다" 확인창 + 카드 재선택 확인창
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(e.message));

await page.goto(URL);
await page.fill('#in-name', '조합빌더검증');
await page.fill('#in-code', 'CRAFT1');
await page.click('#btn-join');
await page.waitForTimeout(600);
await page.click('.tab-btn[data-tab="char"]');
await page.waitForTimeout(300);

const craftSlot = () => page.locator('#craft-slot');
const builderSlot = () => page.locator('#builder-slot');
// 인벤토리 패널만 따로 — 레시피 <select>의 <option> 텍스트("위상 필터" 등)도
// #craft-slot 전체 innerText에 섞여 나오므로, "아이템이 없다/있다"는 반드시
// 인벤토리 패널 범위에서만 확인해야 오탐이 없다.
const inventoryPanel = () => craftSlot().locator('.panel', { hasText: '인벤토리' });

// 파블로: INT +3, '마도구 정비(숙련)' 보유(정식 기술명과 정확히 일치) →
// tinker 판정 보정 = INT(+3) + 숙련(+2) = +5로 고정된다(hp/radiation 기본값
// 상태에서는 부상/잔향 페널티가 없다). 이 보정을 미리 계산해 두고 자연값만
// 큐로 조절하면 성공/실패/부분 성공을 확정적으로 재현할 수 있다.
await page.locator('.char-card', { hasText: '파블로' }).first().click();
await page.waitForTimeout(500);
const pablo = chars.find((c) => c.name === '파블로');
check('사전 조건: 파블로는 마도구 정비 숙련 + INT +3(보정 +5로 고정)',
  pablo.skills.includes('마도구 정비(숙련)') && pablo.stats.INT === '+3');
const TINKER_MOD = 5; // INT(+3) + 숙련(+2)

// ══════════════════════════════════════════════════════════════════════
// 1) 레시피 5종 노출 + 위상 필터 성공 → 결정편 감소 + 로그 기록
// ══════════════════════════════════════════════════════════════════════
{
  const recipeOptionCount = await craftSlot().locator('select').first().locator('option').count();
  check('조합 레시피 5종(RULES.crafting.recipes)이 드롭다운에 전부 노출됨',
    recipeOptionCount === rules.crafting.recipes.length, `${recipeOptionCount}개`);

  await craftSlot().locator('select').first().selectOption('filter');
  await page.waitForTimeout(200);
  let craftText = await craftSlot().innerText();
  check('위상 필터 선택 시 결정편 2 · DC 10이 표시됨', /결정편\s*2/.test(craftText) && /DC\s*10/.test(craftText));
  check('제작 전 "실패해도 결정편이 소모된다" 경고가 항상 보임', /실패해도 결정편.*소모/.test(craftText));

  // natural 10 + 보정 5 = 15 → DC10 이상(대성공 기준 DC+10=20 미만)이므로 '성공'
  await queueRandom(page, [randFor(10, 20)]);
  const craftBtn = craftSlot().locator('button.primary', { hasText: '제작' });
  check('결정편이 충분하면 제작 버튼이 활성화됨', !(await craftBtn.isDisabled()));
  await craftBtn.click();
  await page.waitForTimeout(500);
  craftText = await craftSlot().innerText();
  check('제작 성공 시 "성공"이 표시됨', /성공/.test(craftText) && !/부분 성공/.test(craftText));
  check('성공 후 보유 결정편이 10 → 8로 줄어듦(비용 2)', /보유\s*8/.test(craftText), craftText.slice(0, 200));
  check('성공 시 인벤토리에 위상 필터가 추가됨', /위상 필터/.test(craftText) && /사용 — 잔향 1d10 감소/.test(craftText));

  await page.click('.tab-btn[data-tab="log"]');
  await page.waitForTimeout(250);
  const logText = await page.evaluate(() => document.body.innerText);
  check('제작 결과가 세션 로그에 남음(결정편 8 → 4 처럼 정확한 표기는 아니지만 성공/수치가 남는지 확인)',
    /위상 필터/.test(logText) && /성공/.test(logText) && /8/.test(logText));
  await page.click('.tab-btn[data-tab="char"]');
  await page.waitForTimeout(250);
}

// ══════════════════════════════════════════════════════════════════════
// 2) 위상 필터 "사용" → 잔향 1d10 감소 + 로그 기록
// ══════════════════════════════════════════════════════════════════════
{
  await page.fill('#f-rad', '50');
  await page.dispatchEvent('#f-rad', 'change');
  await page.waitForTimeout(500);

  await queueRandom(page, [randFor(6, 10)]); // d10[6]
  await craftSlot().locator('button', { hasText: '사용 — 잔향 1d10 감소' }).click();
  await page.waitForTimeout(500);

  const rad = await page.inputValue('#f-rad');
  check('위상 필터 사용 후 잔향이 1d10만큼 감소함(50 → 44)', rad === '44', `잔향=${rad}`);

  const invText = await inventoryPanel().innerText();
  check('사용한 필터는 인벤토리에서 사라짐', /아직 만든 아이템이 없습니다/.test(invText), invText);

  await page.click('.tab-btn[data-tab="log"]');
  await page.waitForTimeout(250);
  const logText = await page.evaluate(() => document.body.innerText);
  check('위상 필터 사용이 로그에 남음', /위상 필터 사용/.test(logText) && /44/.test(logText));
  await page.click('.tab-btn[data-tab="char"]');
  await page.waitForTimeout(250);
}

// ══════════════════════════════════════════════════════════════════════
// 3) 결정편 1개로 룬폭탄(3개 필요) → 버튼 비활성 + 부족분 표시
// ══════════════════════════════════════════════════════════════════════
{
  await page.fill('#f-parts', '1');
  await page.dispatchEvent('#f-parts', 'change');
  await page.waitForTimeout(500);

  await craftSlot().locator('select').first().selectOption('runebomb');
  await page.waitForTimeout(250);
  const craftText = await craftSlot().innerText();
  check('룬폭탄(필요 3) 선택 + 보유 1일 때 부족분이 표시됨', /부족\s*2개/.test(craftText), craftText.slice(0, 200));
  const craftBtn = craftSlot().locator('button.primary', { hasText: '제작' });
  check('결정편이 부족하면 제작 버튼이 비활성화됨', await craftBtn.isDisabled());
}

// ══════════════════════════════════════════════════════════════════════
// 4) 제작 실패 시에도 결정편이 소모됨
// ══════════════════════════════════════════════════════════════════════
{
  await page.fill('#f-parts', '5');
  await page.dispatchEvent('#f-parts', 'change');
  await page.waitForTimeout(500);
  await craftSlot().locator('select').first().selectOption('filter'); // 비용 2, DC 10
  await page.waitForTimeout(200);

  // natural 1 → 자연 1은 total과 무관하게 항상 실패(Rules.resolve)
  await queueRandom(page, [randFor(1, 20)]);
  await craftSlot().locator('button.primary', { hasText: '제작' }).click();
  await page.waitForTimeout(500);
  const craftText = await craftSlot().innerText();
  check('자연 1 → 실패로 표시됨', /실패/.test(craftText));
  check('실패해도 결정편은 소모됨(5 → 3)', /보유\s*3/.test(craftText), craftText.slice(0, 200));
  const invTextAfterFail = await inventoryPanel().innerText();
  check('실패 시에는 인벤토리에 아이템이 추가되지 않음', /아직 만든 아이템이 없습니다/.test(invTextAfterFail), invTextAfterFail);
}

// ══════════════════════════════════════════════════════════════════════
// 5) 부분 성공 → GM 판단 UI (임의 처리하지 않음)
// ══════════════════════════════════════════════════════════════════════
{
  // 현재 보유 3개, 위상 필터(비용 2) 그대로 선택된 상태.
  // natural 3 + 보정 5 = 8 → DC10 기준 [dc-4, dc-1]=[6,9] 범위 → 부분 성공.
  await queueRandom(page, [randFor(3, 20)]);
  await craftSlot().locator('button.primary', { hasText: '제작' }).click();
  await page.waitForTimeout(500);
  let craftText = await craftSlot().innerText();
  check('부분 성공 시에도 결정편은 소모됨(3 → 1)', /보유\s*1/.test(craftText), craftText.slice(0, 200));
  check('부분 성공은 룰북 4.2가 정의하지 않는다는 설명과 함께 GM 판단 UI가 뜸',
    /부분 성공/.test(craftText) && /GM 판단/.test(craftText) && /4\.2는 성공\/실패만 정의/.test(craftText));
  check('GM 판단 UI에 세 선택지(결정편 추가 소모/품질 저하/잔향 획득)가 전부 있음',
    /결정편 추가 소모/.test(craftText) && /품질 저하/.test(craftText) && /잔향 획득/.test(craftText));
  check('부분 성공이 해결되기 전에는 새 제작 버튼이 비활성화됨(임의로 자동 처리하지 않음)',
    await craftSlot().locator('button.primary', { hasText: '제작' }).isDisabled());

  // GM이 "품질 저하"를 선택 — 아이템은 지급되지만 품질 저하로 표시되어야 한다.
  await craftSlot().locator('button', { hasText: '품질 저하 상태로 지급' }).click();
  await page.waitForTimeout(500);
  craftText = await craftSlot().innerText();
  check('GM이 품질 저하를 고르면 아이템이 "(품질 저하)" 표시로 지급됨', /위상 필터.*품질 저하/.test(craftText.replace(/\n/g, ' ')));
  check('부분 성공 처리 후에는 GM 판단 UI가 사라짐', !/GM 판단/.test(craftText));
}

check('페이지 에러 없음(조합 단계)', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

// ══════════════════════════════════════════════════════════════════════
// 6) 캐릭터 빌더 — HP 격차 경고는 항상 보임
// ══════════════════════════════════════════════════════════════════════
{
  const builderText = await builderSlot().innerText();
  check('빌더 화면에 사전 제작 캐릭터와의 HP 격차 경고가 항상 표시됨(열기 전에도)',
    /HP가 2~8 낮습니다/.test(builderText) && /GM과 상의해 HP를 보정/.test(builderText));
}

// ══════════════════════════════════════════════════════════════════════
// 7) 배열을 벗어난 능력치 배분이 막힘 + CON+2 → HP 14 계산 + 방에 추가
// ══════════════════════════════════════════════════════════════════════
{
  await builderSlot().locator('button', { hasText: '+ 새 캐릭터 직접 만들기' }).click();
  await page.waitForTimeout(300);

  const beforeCount = await page.locator('.char-card').count();
  check('빌더를 열기 전 캐릭터는 16명', beforeCount === chars.length, `${beforeCount}명`);

  const sel = builderSlot().locator('select');
  // 순서: [0]아이콘 [1]STR [2]AGI [3]CON [4]INT [5]WIS [6]CHA [7]구역 [8]숙련1 [9]숙련2
  const STR = sel.nth(1), AGI = sel.nth(2), CON = sel.nth(3), INT = sel.nth(4), WIS = sel.nth(5), CHA = sel.nth(6);

  let builderText = await builderSlot().innerText();
  check('기본값은 표준 배열이라 처음부터 유효함', /✓ 유효한 배열입니다/.test(builderText));

  // 기본값 STR3/AGI2/CON1/INT1/WIS0/CHA-1 → AGI와 CON을 맞바꿔 CON을 +2로.
  await CON.selectOption('2');
  await AGI.selectOption('1');
  await page.waitForTimeout(250);
  builderText = await builderSlot().innerText();
  check('CON을 +2로 바꿔도(AGI와 교환) 여전히 유효한 배열', /✓ 유효한 배열입니다/.test(builderText));

  const hpBox = builderSlot().locator('.stat-box', { hasText: 'HP' });
  const hpVal = (await hpBox.locator('.v').innerText()).trim();
  check('CON +2 캐릭터의 시작 HP가 10 + 2*2 = 14로 자동 계산됨', hpVal === '14', `HP=${hpVal}`);

  // 이제 일부러 배열을 깨뜨린다: WIS를 STR과 같은 +3으로.
  await WIS.selectOption('3');
  await page.waitForTimeout(250);
  builderText = await builderSlot().innerText();
  check('중복 배분(WIS도 +3)을 하면 유효하지 않다는 경고가 뜸', /순열이 아닙니다/.test(builderText));
  const addBtnDuringInvalid = builderSlot().locator('button.primary', { hasText: '이 캐릭터를 방에 추가' });
  check('배열을 벗어난 상태에서는 "방에 추가" 버튼이 비활성화됨', await addBtnDuringInvalid.isDisabled());

  // 되돌려서 유효 상태로 복구
  await WIS.selectOption('0');
  await page.waitForTimeout(250);

  // 이름 입력 + 결정편 굴림 후 실제로 방에 추가한다.
  // fill()은 input 이벤트만 내고 change(blur)는 내지 않는다 — change를
  // 명시적으로 보내지 않으면, 다음 클릭의 mousedown이 blur를 유발해
  // onchange 핸들러가 렌더를 다시 그리는 도중에 클릭 대상 버튼이
  // 통째로 교체되어 클릭이 씹히는 경우가 있었다(직접 재현 확인).
  const nameInput = builderSlot().locator('input[type=text]').first(); // 이름 필드가 첫 텍스트 입력
  await nameInput.fill('시험빌더캐릭');
  await nameInput.dispatchEvent('change');
  await page.waitForTimeout(300);
  await builderSlot().locator('button', { hasText: /결정편.*굴리기/ }).click();
  await page.waitForTimeout(300);

  builderText = await builderSlot().innerText();
  check('유효한 배열 + 결정편을 굴리면 "방에 추가" 버튼이 활성화됨',
    !(await builderSlot().locator('button.primary', { hasText: '이 캐릭터를 방에 추가' }).isDisabled()), builderText.slice(-400));

  await builderSlot().locator('button.primary', { hasText: '이 캐릭터를 방에 추가' }).click();
  await page.waitForTimeout(500);

  const afterCount = await page.locator('.char-card').count();
  check('추가 후 캐릭터가 17명으로 늘어남', afterCount === beforeCount + 1, `${afterCount}명`);
  check('새 캐릭터 이름의 카드가 실제로 생김',
    await page.locator('.char-card', { hasText: '시험빌더캐릭' }).count() === 1);

  await page.locator('.char-card', { hasText: '시험빌더캐릭' }).first().click();
  await page.waitForTimeout(500);
  const sheetName = (await page.locator('.sheet .name').innerText()).trim();
  check('만든 캐릭터를 선택하면 시트가 그 캐릭터로 열림', sheetName === '시험빌더캐릭');
  const hpMax = await page.getAttribute('#f-hp', 'max');
  check('실제로 추가된 캐릭터의 최대 HP도 14로 저장됨(부록 A 공식대로)', hpMax === '14', `max=${hpMax}`);
}

check('페이지 에러 없음(빌더 단계)', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));


// ══════════════════════════════════════════════════════════════════════
// 빌더 캐릭터의 영속화 — 새로고침 후에도 살아남는가
// (실제 세션에서 나온 한계. app.js가 hg:{code}:custom 에 정의를 남기고
//  입장할 때 다시 PREGENS에 붙인다.)
// ══════════════════════════════════════════════════════════════════════
{
  const bp = await browser.newPage();
  bp.on('dialog', (d) => d.accept());
  const ROOM = 'PERS';
  await bp.goto(URL);
  await bp.fill('#in-name', '영속검증'); await bp.fill('#in-code', ROOM);
  await bp.click('#btn-join'); await bp.waitForTimeout(700);
  await bp.click('.tab-btn[data-tab="char"]'); await bp.waitForTimeout(400);

  const before = await bp.locator('.char-card').count();
  await bp.locator('#builder-slot button', { hasText: '새 캐릭터 직접 만들기' }).click();
  await bp.waitForTimeout(300);
  const nameInp = bp.locator('#builder-slot input').first();
  await nameInp.fill('영속이');
  await nameInp.dispatchEvent('change');
  await bp.waitForTimeout(400);
  await bp.locator('#builder-slot button', { hasText: '결정편' }).first().click().catch(() => {});
  await bp.waitForTimeout(300);
  const addBtn = bp.locator('#builder-slot button', { hasText: '방에 추가' });
  await addBtn.click();
  await bp.waitForTimeout(900);

  const after = await bp.locator('.char-card').count();
  check('빌더로 만든 캐릭터가 즉시 카드로 나타남', after === before + 1, `${before} → ${after}`);

  const storedDefs = await bp.evaluate((r) => localStorage.getItem(`hg:${r}:custom`), ROOM);
  check('캐릭터 정의가 Store(hg:{code}:custom)에 저장됨',
    !!storedDefs && storedDefs.includes('영속이'), storedDefs ? `${storedDefs.length}바이트` : '없음');

  // 폼 복원이 없는 새 탐색으로 재입장
  await bp.goto('about:blank');
  await bp.goto(URL);
  await bp.fill('#in-name', '영속검증2'); await bp.fill('#in-code', ROOM);
  await bp.click('#btn-join'); await bp.waitForTimeout(900);
  await bp.click('.tab-btn[data-tab="char"]'); await bp.waitForTimeout(500);

  const afterReload = await bp.locator('.char-card').count();
  check('새로고침(재입장) 후에도 캐릭터가 남아 있음', afterReload === before + 1, `${afterReload}장`);
  check('재입장 후 이름으로 카드를 찾을 수 있음',
    (await bp.locator('.char-card', { hasText: '영속이' }).count()) === 1);

  // 다른 방에는 안 붙는다 — 캐릭터는 세션에 속하지 브라우저에 속하지 않는다
  await bp.goto('about:blank');
  await bp.goto(URL);
  await bp.fill('#in-name', '다른방'); await bp.fill('#in-code', 'OTHR');
  await bp.click('#btn-join'); await bp.waitForTimeout(900);
  await bp.click('.tab-btn[data-tab="char"]'); await bp.waitForTimeout(500);
  check('다른 방에는 그 캐릭터가 붙지 않음(방 단위 저장)',
    (await bp.locator('.char-card', { hasText: '영속이' }).count()) === 0 &&
    (await bp.locator('.char-card').count()) === before,
    `${await bp.locator('.char-card').count()}장`);

  await bp.close();
}

await browser.close();

// ── 출력 ─────────────────────────────────────────────────────────────
console.log('\n즉석 조합 · 캐릭터 빌더 브라우저 검증\n' + '─'.repeat(62));
for (const r of results) {
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
const failed = results.filter((r) => !r.pass).length;
console.log('─'.repeat(62));
console.log(`  ${results.length - failed}/${results.length} 통과\n`);
process.exit(failed ? 1 : 0);
