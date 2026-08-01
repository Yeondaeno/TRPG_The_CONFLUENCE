#!/usr/bin/env node
// tools/verify-ai.mjs — AI GM(BYOK) 브라우저 검증 (명세 09)
//
//   npm install && node tools/build.mjs && node tools/verify-ai.mjs
//
// **실제 API를 한 번도 호출하지 않습니다.** window.fetch를 가로채는 스텁으로
// 검사합니다 — 명세 03이 PeerJS를 인메모리 스텁으로 대체한 것과 같은
// 방식입니다. 그래서 여기서 확인하는 것은 "프로토콜이 옳은가"이지
// "실제로 붙는가"가 아닙니다. 실제 연결은 사용자가 자기 키로 확인해야
// 합니다(명세 09 "보고에서 지킬 것").
//
// 어느 공급자가 CORS를 허용하는지도 확인하지 않았습니다 — 전부 미확인
// (corsOk: null)입니다. file:// 페이지는 출처가 null이라 애초에 거부될
// 가능성이 높다는 점을 화면이 그대로 말하는지까지가 이 검증의 몫입니다.

import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const URL = 'file://' + join(process.cwd(), 'web/index.html');
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

// ══════════════════════════════════════════════════════════════════════
// 소스 검사
// ══════════════════════════════════════════════════════════════════════
{
  const ai = readFileSync('web/src/ai.js', 'utf8');
  const codeOnly = ai.replace(/^\s*\/\/.*$/gm, '');
  // corsOk를 확인 없이 true로 단정하지 않았는지 (명세 09 §1 마지막 문단)
  check('[소스] 확인하지 않은 공급자를 corsOk: true로 단정하지 않음', !/corsOk:\s*true/.test(codeOnly));
  check('[소스] 키 저장 위치가 방과 무관한 hg:ai', /STORE_KEY\s*=\s*'hg:ai'/.test(codeOnly));
  check('[소스] Anthropic 어댑터에 브라우저 직접 호출 헤더가 있음',
    codeOnly.includes('anthropic-dangerous-direct-browser-access'));
}

const browser = await chromium.launch({ executablePath: chromePath() });

// fetch 스텁 — 요청을 잡아두고 미리 정한 응답을 돌려준다. 실제 네트워크로
// 나가지 않는다.
async function installFetchStub(page) {
  await page.addInitScript(() => {
    window.__aiCalls = [];
    window.__aiReply = { ok: true, status: 200, json: {} };
    window.fetch = async (url, opts) => {
      window.__aiCalls.push({
        url: String(url),
        headers: (opts && opts.headers) || {},
        body: (() => { try { return JSON.parse((opts && opts.body) || '{}'); } catch (e) { return null; } })(),
      });
      const r = window.__aiReply;
      if (r.throw) throw new TypeError('Failed to fetch');
      return {
        ok: r.ok, status: r.status, statusText: r.statusText || '',
        json: async () => r.json,
        text: async () => JSON.stringify(r.json),
      };
    };
  });
}

async function newPage() {
  const page = await browser.newPage();
  await installFetchStub(page);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  return { page, errs };
}

async function joinRoom(page, name, code) {
  await page.goto(URL);
  await page.fill('#in-name', name);
  await page.fill('#in-code', code);
  await page.click('#btn-join');
  await page.waitForTimeout(600);
}

const slot = (page) => page.locator('#tab-content');

// ══════════════════════════════════════════════════════════════════════
// 방 1 — 키가 없을 때: 게임이 완전히 동작하고 AI는 조용히 꺼져 있다
// ══════════════════════════════════════════════════════════════════════
const { page: p1, errs: errs1 } = await newPage();
await joinRoom(p1, '검사A', 'AI001');

check('AI 설정 없이도 첫 화면(플레이 탭)이 정상 표시됨',
  (await slot(p1).innerText()).includes('플레이 시작'));
const availOff = await p1.evaluate(() => ({ i: AI.available('interpret'), n: AI.available('narrate') }));
check('키가 없으면 AI 기능이 전부 꺼져 있음', availOff.i === false && availOff.n === false, JSON.stringify(availOff));

// 게임을 실제로 한 판 진행 — AI 없이 끝까지 돈다
await p1.click('button:has-text("플레이 시작")');
await p1.waitForTimeout(400);
await slot(p1).locator('.kv', { hasText: '실종 현장으로 향한다' }).first().locator('button:has-text("선택")').click();
await p1.waitForTimeout(400);
await slot(p1).locator('.kv', { hasText: '주변을 살핀다' }).first().locator('button:has-text("선택")').click();
await p1.waitForTimeout(400);
check('키가 없어도 판정·결과가 정상 동작(게임 100% 동작)',
  (await slot(p1).innerText()).includes('선환그룹 조사 단말'));
check('AI 없이 진행하는 동안 fetch가 한 번도 불리지 않음',
  (await p1.evaluate(() => window.__aiCalls.length)) === 0);

// 자유 행동도 2층으로 그대로 동작
await slot(p1).locator('input[type=text]').last().fill('벽의 그을음을 살펴본다');
await slot(p1).locator('button:has-text("해석")').click();
await p1.waitForTimeout(300);
check('AI가 꺼져 있으면 "해석" 버튼에 (AI) 표시가 없음',
  !(await slot(p1).innerText()).includes('해석 (AI)'));
check('키가 없어도 자유 행동은 2층(키워드 파서)으로 동작', (await slot(p1).innerText()).includes('이대로 판정'));

check('방 1: 페이지 에러 없음', errs1.length === 0, errs1.join('; '));

// ══════════════════════════════════════════════════════════════════════
// 방 2 — 공급자별 요청 조립 (스텁이 캡처해서 검사)
// ══════════════════════════════════════════════════════════════════════
const { page: p2, errs: errs2 } = await newPage();
await joinRoom(p2, '검사B', 'AI002');

const built = await p2.evaluate(async () => {
  const out = {};
  for (const id of ['anthropic', 'openai', 'gemini', 'deepseek', 'ollama']) {
    await AI.setConfig({ provider: id, model: '', baseUrl: '', apiKey: id === 'ollama' ? '' : 'TEST-KEY-XYZ' });
    out[id] = AI.buildRequest({ system: 'sys', messages: [{ role: 'user', content: 'hi' }], maxTokens: 50 });
  }
  return out;
});

check('Anthropic: /v1/messages URL', built.anthropic.url.endsWith('/v1/messages'), built.anthropic.url);
check('Anthropic: x-api-key 헤더에 키가 들어감', built.anthropic.headers['x-api-key'] === 'TEST-KEY-XYZ');
check('Anthropic: anthropic-dangerous-direct-browser-access 헤더 포함',
  built.anthropic.headers['anthropic-dangerous-direct-browser-access'] === 'true');
check('Anthropic: system이 바디의 최상위 필드(메시지가 아님)', built.anthropic.body.system === 'sys');

check('OpenAI 호환: /chat/completions URL', built.openai.url.endsWith('/chat/completions'), built.openai.url);
check('OpenAI 호환: Bearer 인증 헤더', built.openai.headers.authorization === 'Bearer TEST-KEY-XYZ');
check('OpenAI 호환: system이 messages[0]으로 들어감',
  built.openai.body.messages[0].role === 'system' && built.openai.body.messages[0].content === 'sys');

check('Gemini: generateContent URL + 쿼리 키', /:generateContent\?key=TEST-KEY-XYZ$/.test(built.gemini.url), built.gemini.url);
check('Gemini: systemInstruction으로 분리됨',
  built.gemini.body.systemInstruction.parts[0].text === 'sys');

check('DeepSeek도 OpenAI 호환 어댑터를 그대로 씀', built.deepseek.url === 'https://api.deepseek.com/v1/chat/completions', built.deepseek.url);
check('로컬(Ollama)은 localhost로 가고 키가 없으면 Authorization을 안 붙임',
  built.ollama.url.startsWith('http://localhost:11434') && !built.ollama.headers.authorization, built.ollama.url);

// ── 키가 프롬프트 본문에 섞이지 않는다
const bodyText = JSON.stringify([built.anthropic.body, built.openai.body, built.gemini.body]);
check('API 키가 프롬프트 본문에 들어가지 않음', !bodyText.includes('TEST-KEY-XYZ'));

check('방 2: 페이지 에러 없음', errs2.length === 0, errs2.join('; '));

// ══════════════════════════════════════════════════════════════════════
// 방 3 — 실제 호출 흐름: 성공 / 파싱 실패 / 네트워크 오류
// ══════════════════════════════════════════════════════════════════════
const { page: p3, errs: errs3 } = await newPage();
await joinRoom(p3, '검사C', 'AI003');
await p3.evaluate(() => AI.setConfig({
  provider: 'openai', model: 'test-model', apiKey: 'K', useInterpret: true, useNarrate: true,
}));

const availOn = await p3.evaluate(() => ({ i: AI.available('interpret'), n: AI.available('narrate') }));
check('키와 토글이 켜지면 AI 기능이 켜짐', availOn.i === true && availOn.n === true);

// 게임 시작 → 씬 1-1
await p3.click('button:has-text("플레이 시작")');
await p3.waitForTimeout(400);
await slot(p3).locator('.kv', { hasText: '실종 현장으로 향한다' }).first().locator('button:has-text("선택")').click();
await p3.waitForTimeout(400);
check('AI가 켜지면 "해석 (AI)"로 표시됨', (await slot(p3).innerText()).includes('해석 (AI)'));

// ── (1) 정상 응답 — AI가 기술·DC를 제안하고, 사람이 확인해야 굴러간다
// 씬 0 → 1-1 이동도 확정된 결과라 서술 호출이 이미 한 번 나갔다. 해석
// 요청만 따로 보려고 여기서 기록을 비운다(그 서술 호출도 아래 비밀 검사에
// 포함되도록, 지우기 전에 따로 챙겨 둔다).
const priorCalls = await p3.evaluate(() => {
  const c = window.__aiCalls.slice();
  window.__aiCalls = [];
  window.__aiReply = { ok: true, status: 200, json: {
    choices: [{ message: { content: '```json\n{"skill":"exorcise","dc":18,"reason":"결계에 스민 잔향이라"}\n```' } }],
  } };
  return c;
});
check('결과 서술도 AI가 켜져 있으면 자동으로 나감(판정 없는 선택지 포함)', priorCalls.length >= 1, `${priorCalls.length}회`);
await slot(p3).locator('input[type=text]').last().fill('벽의 그을음에 남은 잔향을 읽어본다');
await slot(p3).locator('button:has-text("해석")').click();
await p3.waitForTimeout(700);
let t3 = await slot(p3).innerText();
check('AI 제안(기술·DC·이유)이 화면에 표시됨',
  t3.includes('AI 제안') && t3.includes('퇴마술') && t3.includes('DC 18'), t3.slice(0, 300));
check('코드펜스에 싸인 JSON도 파싱함', t3.includes('결계에 스민 잔향'));
check('AI가 제안해도 사람이 확인해야 판정이 굴러감(자동 실행 안 함)',
  t3.includes('이대로 판정') && !t3.includes('대성공') && !t3.includes('부분 성공'));

const calls3 = await p3.evaluate(() => window.__aiCalls.map((c) => c.body));
check('해석 요청이 실제로 나갔고 모델이 설정값 그대로', calls3.length === 1 && calls3[0].model === 'test-model', JSON.stringify(calls3.length));

// ── 프롬프트에 캐릭터 비밀이 하나도 없다 (16개 전부 검사)
{
  const prompt = JSON.stringify(calls3) + JSON.stringify(priorCalls);
  const leaked = chars.filter((c) => c.secret && prompt.includes(c.secret)).map((c) => c.name);
  check('프롬프트에 캐릭터 비밀이 하나도 없음(16명 전부 검사)', leaked.length === 0, leaked.join(', '));
}

// ── (2) 결과 서술 — 판정이 끝난 뒤 원문 아래에 덧붙는다
await p3.evaluate(() => {
  window.__aiCalls = [];
  window.__aiReply = { ok: true, status: 200, json: {
    choices: [{ message: { content: '그을음이 손끝에서 식은 재처럼 바스러진다.' } }],
  } };
});
await slot(p3).locator('button:has-text("이대로 판정")').click();
await p3.waitForTimeout(900);
t3 = await slot(p3).innerText();
check('판정 결과(원문)가 그대로 남아 있음', /대성공|성공|부분 성공|실패/.test(t3));
check('AI 서술이 원문을 대체하지 않고 아래에 덧붙음', t3.includes('식은 재처럼 바스러진다'), t3.slice(0, 300));
const narrateBody = await p3.evaluate(() => (window.__aiCalls[0] || {}).body);
check('서술 프롬프트에 "확정된 결과"가 들어감',
  JSON.stringify(narrateBody).includes('확정된 결과'), JSON.stringify(narrateBody).slice(0, 200));

check('방 3: 페이지 에러 없음', errs3.length === 0, errs3.join('; '));

// ══════════════════════════════════════════════════════════════════════
// 방 4 — 실패 경로가 전부 정상 경로인가
// ══════════════════════════════════════════════════════════════════════
const { page: p4, errs: errs4 } = await newPage();
await joinRoom(p4, '검사D', 'AI004');
await p4.evaluate(() => AI.setConfig({ provider: 'openai', model: 'm', apiKey: 'K', useInterpret: true, useNarrate: true }));
await p4.click('button:has-text("플레이 시작")');
await p4.waitForTimeout(400);
await slot(p4).locator('.kv', { hasText: '실종 현장으로 향한다' }).first().locator('button:has-text("선택")').click();
await p4.waitForTimeout(400);

// ── 파싱 실패 → 2층 폴백
await p4.evaluate(() => {
  window.__aiReply = { ok: true, status: 200, json: { choices: [{ message: { content: '음... 그건 좀 애매한데요.' } }] } };
});
await slot(p4).locator('input[type=text]').last().fill('벽의 그을음을 살펴본다');
await slot(p4).locator('button:has-text("해석")').click();
await p4.waitForTimeout(700);
let t4 = await slot(p4).innerText();
check('응답 파싱 실패 → 2층 폴백을 알리고 게임은 계속됨',
  t4.includes('키워드 파서(2층) 제안을 그대로 씁니다') && t4.includes('이대로 판정'), t4.slice(0, 300));

// ── 네트워크 오류 → 조용히 폴백, 팝업 없음
let dialogSeen = false;
p4.on('dialog', async (d) => { dialogSeen = true; await d.dismiss(); });
await p4.evaluate(() => { window.__aiReply = { throw: true }; });
await slot(p4).locator('input[type=text]').last().fill('구석의 어둠에 몸을 숨긴다');
await slot(p4).locator('button:has-text("해석")').click();
await p4.waitForTimeout(700);
t4 = await slot(p4).innerText();
check('네트워크 오류 → 조용히 폴백하고 판정은 계속 가능',
  t4.includes('AI에 연결하지 못했습니다') && t4.includes('이대로 판정'), t4.slice(0, 300));
check('오류로 팝업(alert/confirm)을 띄우지 않음', dialogSeen === false);

// ── 서술 실패 → 씬 원본 텍스트로 결과가 나온다
await slot(p4).locator('button:has-text("이대로 판정")').click();
await p4.waitForTimeout(900);
t4 = await slot(p4).innerText();
check('AI 서술이 실패해도 판정 결과는 원문 그대로 나옴', /대성공|성공|부분 성공|실패/.test(t4), t4.slice(0, 200));

// ── 연결 확인 실패 메시지가 원인 후보를 정직하게 보여준다
await p4.click('.tab-btn[data-tab="ai"]');
await p4.waitForTimeout(400);
const aiTab = await slot(p4).innerText();
check('AI 탭에 "키 없어도 게임 100% 동작" 안내가 있음', aiTab.includes('키를 넣지 않아도 게임은 100% 동작합니다'));
check('CORS 여부를 단정하지 않고 "미확인"으로 표시', aiTab.includes('미확인'), aiTab.slice(0, 200));
check('비용·전송·비밀에 대한 경고가 있음',
  aiTab.includes('비용은') && aiTab.includes('전송') && aiTab.includes('전송하지 않습니다'));

await p4.click('#ai-test');
await p4.waitForTimeout(600);
const testText = await slot(p4).innerText();
check('연결 실패 시 원인 후보를 그대로 보여줌(file:// 출처 포함)',
  testText.includes('연결 실패') && testText.includes('file://'), testText.slice(0, 400));
check('연결 실패해도 "게임은 그대로 진행됩니다"를 알림', testText.includes('게임은 그대로 진행됩니다'));

check('방 4: 페이지 에러 없음', errs4.length === 0, errs4.join('; '));

// ══════════════════════════════════════════════════════════════════════
// 방 5 — 키가 방 데이터에 새지 않는가 (P2P 내보내기 포함)
// ══════════════════════════════════════════════════════════════════════
const { page: p5, errs: errs5 } = await newPage();
await joinRoom(p5, '검사E', 'AI005');
await p5.evaluate(() => AI.setConfig({ provider: 'openai', apiKey: 'SECRET-KEY-12345', useNarrate: true }));
await p5.waitForTimeout(300);

const leakScan = await p5.evaluate(async () => {
  const out = { roomKeys: [], found: [] };
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    const v = localStorage.getItem(k) || '';
    if (k.startsWith('hg:AI005:')) out.roomKeys.push(k);
    if (v.includes('SECRET-KEY-12345')) out.found.push(k);
  }
  return out;
});
check('키가 방 데이터(hg:{code}:*)에 저장되지 않음',
  !leakScan.found.some((k) => k.startsWith('hg:AI005:')), leakScan.found.join(', '));
check('키는 방과 무관한 hg:ai 에만 있음',
  leakScan.found.length === 1 && leakScan.found[0] === 'hg:ai', leakScan.found.join(', '));
check('방에는 실제로 데이터가 있었다(위 검사가 공허하지 않음)', leakScan.roomKeys.length > 0, `${leakScan.roomKeys.length}개`);

// 키 지우기
await p5.click('.tab-btn[data-tab="ai"]');
await p5.waitForTimeout(400);
await p5.click('#ai-clear');
await p5.waitForTimeout(400);
const afterClear = await p5.evaluate(() => (localStorage.getItem('hg:ai') || '').includes('SECRET-KEY-12345'));
check('"키 지우기"를 누르면 저장소에서 실제로 사라짐', afterClear === false);
check('저장된 키를 화면 입력칸에 되돌려 놓지 않음',
  (await p5.locator('#ai-key').inputValue()) === '');

check('방 5: 페이지 에러 없음', errs5.length === 0, errs5.join('; '));

await p1.close(); await p2.close(); await p3.close(); await p4.close(); await p5.close();
await browser.close();

console.log('\nAI GM(BYOK) 브라우저 검증 (명세 09)\n' + '─'.repeat(62));
for (const r of results) {
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
const failed = results.filter((r) => !r.pass).length;
console.log('─'.repeat(62));
console.log(`  ${results.length - failed}/${results.length} 통과`);
console.log('  ⚠ 실제 API는 한 번도 호출하지 않았습니다 — fetch 스텁으로 프로토콜만 확인했습니다.');
console.log('    실제로 붙는지는 사용자가 자기 키로 확인해야 합니다(명세 09).\n');
process.exit(failed ? 1 : 0);
