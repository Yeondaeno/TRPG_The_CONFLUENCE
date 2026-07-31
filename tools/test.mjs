#!/usr/bin/env node
// tools/test.mjs — node:test 단위 테스트
//
//   node tools/test.mjs
//
// 이 파일은 명세 01이 만들고, 명세 02가 rules.js 경계 케이스 테스트를
// 이어붙인다(docs/specs/02-check-engine.md §3). 01의 몫은 store.js의
// 3단 폴백 로직 — 브라우저 없이, 실제 왕복 여부로 모드를 검증한다.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(import.meta.url);

const { createStore, Store } = require(join(root, 'web/src/store.js'));
const Rules = require(join(root, 'web/src/rules.js'));
const Net = require(join(root, 'web/src/net.js'));

// ---- 테스트용 가짜 백엔드 ----
function makeFakeLocalStorage({ throwOnKey } = {}) {
  const map = new Map();
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) {
      if (throwOnKey && k === throwOnKey) {
        const e = new Error('QuotaExceededError');
        e.name = 'QuotaExceededError';
        throw e;
      }
      map.set(k, String(v));
    },
    removeItem(k) { map.delete(k); },
    _map: map,
  };
}
function makeBrokenLocalStorage() {
  return {
    getItem() { throw new Error('SecurityError: private mode'); },
    setItem() { throw new Error('SecurityError: private mode'); },
    removeItem() { throw new Error('SecurityError: private mode'); },
  };
}
function makeFakeWindowStorage({ broken } = {}) {
  const map = new Map();
  return {
    async set(k, v) { if (broken) throw new Error('artifact runtime unavailable'); map.set(k, String(v)); },
    async get(k) { if (broken) throw new Error('artifact runtime unavailable'); return map.has(k) ? { value: map.get(k) } : null; },
  };
}

describe('Store — 3단 폴백 (docs/specs/01-foundation.md §2)', () => {
  test('window.storage도 localStorage도 없으면 memory 모드로 떨어진다', async () => {
    const s = createStore({ windowStorage: null, localStorage: null });
    await s._ready();
    assert.equal(s.mode, 'memory');
  });

  test('memory 모드에서 get/set/remove 왕복이 정확하다', async () => {
    const s = createStore({ windowStorage: null, localStorage: null });
    assert.equal(await s.get('hg:X:meta'), null);
    await s.set('hg:X:meta', { gm: '지운', round: 2 });
    assert.deepEqual(await s.get('hg:X:meta'), { gm: '지운', round: 2 });
    await s.remove('hg:X:meta');
    assert.equal(await s.get('hg:X:meta'), null);
  });

  test('localStorage가 실제로 왕복되면 local 모드를 쓴다', async () => {
    const ls = makeFakeLocalStorage();
    const s = createStore({ windowStorage: null, localStorage: ls });
    await s.set('hg:X:char:이든', { hp: 22 });
    assert.equal(s.mode, 'local');
    assert.deepEqual(await s.get('hg:X:char:이든'), { hp: 22 });
  });

  test('localStorage 객체는 있지만 쓰면 던지면(사파리 프라이빗) memory로 떨어진다', async () => {
    // "객체 존재 여부"가 아니라 실제 왕복으로 판정해야 하는 이유.
    const s = createStore({ windowStorage: null, localStorage: makeBrokenLocalStorage() });
    await s._ready();
    assert.equal(s.mode, 'memory');
    await s.set('hg:X:log', [1, 2, 3]);
    assert.deepEqual(await s.get('hg:X:log'), [1, 2, 3]);
  });

  test('window.storage가 실제로 왕복되면 artifact 모드를 최우선으로 쓴다', async () => {
    const s = createStore({ windowStorage: makeFakeWindowStorage(), localStorage: makeFakeLocalStorage() });
    await s.set('hg:X:claims', { 이든: '지운' });
    assert.equal(s.mode, 'artifact');
    assert.deepEqual(await s.get('hg:X:claims'), { 이든: '지운' });
  });

  test('window.storage가 있지만 깨져 있으면 localStorage로, 그것도 없으면 memory로 폴백한다', async () => {
    const s1 = createStore({ windowStorage: makeFakeWindowStorage({ broken: true }), localStorage: makeFakeLocalStorage() });
    await s1._ready();
    assert.equal(s1.mode, 'local');

    const s2 = createStore({ windowStorage: makeFakeWindowStorage({ broken: true }), localStorage: null });
    await s2._ready();
    assert.equal(s2.mode, 'memory');
  });

  test('쓰기 중 QuotaExceededError가 나면 local에서 memory로 강등되고 onModeChange가 발화한다', async () => {
    const ls = makeFakeLocalStorage({ throwOnKey: 'hg:X:log' });
    const s = createStore({ windowStorage: null, localStorage: ls });
    await s.set('hg:X:meta', { round: 1 }); // local 모드 확정
    assert.equal(s.mode, 'local');

    let notified = null;
    s.onModeChange((m) => { notified = m; });

    await s.set('hg:X:log', new Array(50).fill('x')); // 이 키에서만 quota 에러
    assert.equal(s.mode, 'memory');
    assert.equal(notified, 'memory');
    assert.deepEqual(await s.get('hg:X:log'), new Array(50).fill('x'));
  });

  test('keys(prefix)로 방별 키를 나열할 수 있다 (키 분리 준비)', async () => {
    const s = createStore({ windowStorage: null, localStorage: null });
    await s.set('hg:ABCD:char:이든', { hp: 22 });
    await s.set('hg:ABCD:char:세라', { hp: 19 });
    await s.set('hg:WXYZ:char:이든', { hp: 22 });
    const ks = await s.keys('hg:ABCD:');
    assert.deepEqual(new Set(ks), new Set(['hg:ABCD:char:이든', 'hg:ABCD:char:세라']));
  });

  test('싱글턴 Store는 Node 환경(window/localStorage 없음)에서 memory로 떨어진다', async () => {
    await Store._ready();
    assert.equal(Store.mode, 'memory');
    await Store.set('hg:SMOKE:meta', { ok: true });
    assert.deepEqual(await Store.get('hg:SMOKE:meta'), { ok: true });
  });
});

describe('Rules / Net — 껍데기 인터페이스 배선 확인 (명세 01)', () => {
  // 여기서는 "값이 옳은가"가 아니라 "명세 01이 약속한 모양대로 존재하는가"만
  // 확인한다. 경계 케이스(자연 20/1, DC 경계, 그룹 판정 등)는 명세 02가
  // 채운다(docs/specs/02-check-engine.md §3).
  test('Rules가 다섯 개 함수를 전부 노출한다', () => {
    for (const fn of ['resolve', 'modifiers', 'groupResult', 'woundTier', 'resonanceEffect']) {
      assert.equal(typeof Rules[fn], 'function', `Rules.${fn}이 함수가 아님`);
    }
  });
  test('Rules.resolve는 지금 항상 무해한 기본값을 돌려준다', () => {
    assert.equal(Rules.resolve({ natural: 1, total: 3, dc: 20 }), 'success');
  });

  test('Net이 명세 01의 인터페이스 모양을 전부 노출한다', () => {
    assert.equal(Net.status, 'offline');
    for (const fn of ['host', 'join', 'send', 'onMessage', 'onStatusChange', 'peers', 'disconnect']) {
      assert.equal(typeof Net[fn], 'function', `Net.${fn}이 함수가 아님`);
    }
    assert.deepEqual(Net.peers(), []);
  });
});
