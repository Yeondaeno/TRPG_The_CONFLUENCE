#!/usr/bin/env node
// 시나리오 「역참-0」 오프닝 한 판을 실제로 굴려 영상으로 남긴다.
//
//   npm run demo
//
// 검증 스크립트(verify-ui / verify-craft)와 목적이 다르다 — 저건 "깨지지
// 않았는가"를 보고, 이건 **도구가 세션에서 실제로 어떻게 쓰이는지**를 보여준다.
// 새 GM에게 도구를 설명할 때, 또는 화면 배치를 바꾼 뒤 흐름이 여전히
// 자연스러운지 눈으로 확인할 때 쓴다.
//
// 산출물: scratchpad/video/hapgyeong-session.webm (1280x800, 약 2분)
// 사람이 따라갈 수 있도록 일부러 느리게 진행하고 자막을 얹는다.
import { chromium } from 'playwright';
import { existsSync, renameSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const URL = 'file://' + join(process.cwd(), 'web/index.html');
// 출력 위치: DEMO_OUT 환경변수로 바꿀 수 있다. 기본은 저장소 밖(임시 디렉터리)
// — 7MB짜리 영상을 저장소에 커밋할 이유가 없다.
const OUT = process.env.DEMO_OUT || join(tmpdir(), 'hapgyeong-demo');
const chrome = ['chromium-1194', 'chromium']
  .map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(existsSync);

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: chrome });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
});
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());

const beat = (ms = 1200) => page.waitForTimeout(ms);
const say = (s) => console.log(s);

// 화면 위에 자막을 띄운다 — 영상만 봐도 뭘 하는지 알 수 있게.
async function caption(text, ms = 2600) {
  await page.evaluate((t) => {
    let c = document.getElementById('__cap');
    if (!c) {
      c = document.createElement('div');
      c.id = '__cap';
      c.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;'
        + 'background:rgba(10,8,6,.94);color:#E8A33D;font:600 20px/1.5 "Noto Sans KR",sans-serif;'
        + 'padding:14px 22px;border-top:2px solid #8B2E6B;text-align:center';
      document.body.appendChild(c);
    }
    c.textContent = t;
  }, text);
  await beat(ms);
}

await page.goto(URL);
await caption('합경 — 시나리오 「역참-0」 오프닝', 2400);

// ── 입장 ─────────────────────────────────────────────────────────────
await caption('GM이 방을 엽니다', 1800);
await page.fill('#in-name', '지운(GM)'); await beat(500);
await page.fill('#in-code', 'STN0'); await beat(600);
await page.click('#btn-join'); await beat(1400);

await caption('GM 자처 → 비밀 파일(secrets.json)을 불러옵니다', 2600);
await page.click('.tab-btn[data-tab="gm"]'); await beat(900);
await page.click('button:has-text("내가 이 세션의 GM입니다")'); await beat(1200);
await page.setInputFiles('#gm-net-slot input[type=file]', join(process.cwd(), 'web/secrets.json'));
await beat(1600);
await caption('"비밀 로드됨 — 점유자 본인에게만 전송됩니다"', 2600);

// ── 시나리오 패널 ────────────────────────────────────────────────────
await caption('GM 화면의 시나리오 진행 — Act·씬·목표 시간이 전부 보입니다', 2800);
await page.locator('#scenario-slot').scrollIntoViewIfNeeded(); await beat(2200);
await page.mouse.wheel(0, 400); await beat(2000);

// ── 씬 0 ─────────────────────────────────────────────────────────────
await caption('씬 0 — 표가 도착한 밤. 플레이어들이 캐릭터를 고릅니다', 2600);
await page.click('.tab-btn[data-tab="char"]'); await beat(1000);
for (const n of ['라비', '노아', '소민']) {
  await page.locator('.char-card', { hasText: n }).first().click();
  await beat(1100);
}
await caption('점유한 캐릭터의 비밀은 본인에게만 보입니다', 2600);
await page.locator('.sheet').scrollIntoViewIfNeeded(); await beat(1800);

// ── 판정 ─────────────────────────────────────────────────────────────
await caption('라비: "표를 자세히 봅니다" → 관찰 WIS · DC 12', 2600);
await page.click('.tab-btn[data-tab="dice"]'); await beat(1000);
const slot = page.locator('#check-slot');
const sel = () => slot.locator('select');
await sel().nth(0).selectOption({ label: '라비' }); await beat(900);
await sel().nth(1).selectOption('skill:survival'); await beat(1400);
await caption('능력치·숙련이 자동 합산됩니다 — GM이 암산할 게 없습니다', 2800);
await slot.locator('button.primary', { hasText: '판정 (d20)' }).first().click();
await beat(2600);
await caption('4단계 결과가 바로 나옵니다 (대성공 / 성공 / 부분 성공 / 실패)', 2800);

// ── 그룹 판정 ────────────────────────────────────────────────────────
await caption('씬 1-1 — "전원 창고를 수색한다" → 8인 그룹 판정', 2600);
await slot.locator('button', { hasText: '전원 선택' }).scrollIntoViewIfNeeded(); await beat(700);
const party = ['이든', '세라', '라비', '준', '소민', '노아', '겨울', '레오'];
const labels = slot.locator('.char-grid label');
const all = await labels.allInnerTexts();
for (let i = 0; i < all.length; i++) {
  const nm = all[i].trim();
  const box = labels.nth(i).locator('input[type=checkbox]');
  if (party.includes(nm) !== (await box.isChecked())) await box.click();
}
await beat(1200);
const n = await sel().count();
await sel().nth(n - 2).selectOption('survival'); await beat(700);
await sel().nth(n - 1).selectOption('12'); await beat(900);
await slot.locator('button.primary', { hasText: '그룹 판정 개시' }).click();
await beat(1400);

await caption('8명이 각자 굴립니다', 1800);
let btns = slot.locator('.init-list .init-item button', { hasText: '이 캐릭터로 굴리기' });
for (let g = await btns.count(); g > 0; g--) {
  await btns.first().click();
  await beat(600);
  btns = slot.locator('.init-list .init-item button', { hasText: '이 캐릭터로 굴리기' });
}
await beat(1200);
await caption('과반 집계 — 룰북 1.5대로 "절반 이상이면 전체 성공"', 2600);
await slot.locator('button', { hasText: '집계 결과 보기' }).click();
await beat(2800);

// ── NPC 투입 ─────────────────────────────────────────────────────────
await caption('전투 — 씬의 NPC를 버튼 하나로 트래커에 투입합니다', 2800);
await page.click('.tab-btn[data-tab="gm"]'); await beat(1000);
const sc = page.locator('#scenario-slot');
await sc.scrollIntoViewIfNeeded(); await beat(900);
const inject = sc.locator('button', { hasText: 'NPC 투입' });
const cnt = await inject.count();
say(`NPC 투입 버튼 ${cnt}개`);
// 씬 2-2 (4종 8마리) 를 노린다 — 가장 큰 전투
let target = inject.first();
for (let i = 0; i < cnt; i++) {
  if ((await inject.nth(i).innerText()).includes('8마리')) { target = inject.nth(i); break; }
}
await target.scrollIntoViewIfNeeded(); await beat(800);
await caption('씬 2-2 승강장 — 4종 8마리를 한 번에', 2400);
await target.click(); await beat(2000);
await page.locator('.init-list').first().scrollIntoViewIfNeeded(); await beat(3000);
await caption('선제권까지 굴려서 트래커에 들어갔습니다', 2600);

// ── 조합 ─────────────────────────────────────────────────────────────
await caption('즉석 조합 — 파블로가 위상 필터를 만듭니다 (잔향 -1d10)', 2800);
await page.click('.tab-btn[data-tab="char"]'); await beat(900);
await page.locator('.char-card', { hasText: '파블로' }).first().click(); await beat(1400);
const craft = page.locator('#craft-slot');
await craft.scrollIntoViewIfNeeded(); await beat(1200);
await craft.locator('select').first().selectOption({ label: /위상 필터/ }).catch(async () => {
  const opts = await craft.locator('select option').allInnerTexts();
  const idx = opts.findIndex((o) => o.includes('위상 필터'));
  if (idx >= 0) await craft.locator('select').first().selectOption({ index: idx });
});
await beat(1600);
await caption('"실패해도 결정편은 소모됩니다" — 누르기 전에 경고합니다', 2800);
await craft.locator('button', { hasText: '제작' }).first().click();
await beat(2600);

// ── 로그 ─────────────────────────────────────────────────────────────
await caption('세션 로그 — 모든 굴림과 판정이 남습니다', 2600);
await page.click('.tab-btn[data-tab="log"]'); await beat(1200);
await beat(3200);
await caption('한 판 끝. 파일 하나로 전부 동작합니다.', 3000);

await page.evaluate(() => { const c = document.getElementById('__cap'); if (c) c.remove(); });
await ctx.close();
await browser.close();

const files = readdirSync(OUT).filter((f) => f.endsWith('.webm'));
if (files.length) {
  renameSync(join(OUT, files[0]), join(OUT, 'hapgyeong-session.webm'));
  say('video: ' + join(OUT, 'hapgyeong-session.webm'));
}
