# 구현 명세

Sonnet 5가 실행할 작업 명세입니다. 각 명세는 **독립적으로 완료 가능하고,
끝난 시점에 세션에서 실제로 쓸 수 있는 상태**여야 합니다.

## 순서와 의존성

```
01-foundation   모듈 분리 · 빌드 · 스토리지 · 이스케이프 · 비밀 차단   ✅
      │         ← 여기서 rules.js / net.js의 인터페이스를 확정한다
      ├──────────────┬──────────────
      ▼              ▼
02-check-engine   03-p2p-sync                                        ✅
판정 엔진·그룹판정   P2P 동기화
      │               │
      │               ▼
      │           04-secret-split      비밀 분리 빌드          ← 진행 중
      │               │
      │               ▼
      │           05-scenario-data     시나리오 데이터화        ← 남음
      │               │
      │               ▼
      │           07-gm-assistant      사람 GM 권위형 보조 엔진  ← 설계 완료
      ▼
  06-crafting-and-builder   즉석 조합 · 캐릭터 빌더            ← 남음
```

04는 03을 구현하고 나서야 필요성이 드러났습니다. P2P가 비밀 노출을 자동으로
풀어줄 거라 봤는데, 실제로는 빌드 산출물에 비밀이 박히는 게 원인이라
배포 방식을 고쳐야 합니다. [ADR-001의 단서](../adr/001-p2p-sync.md#단서--비밀-차단은-아직-절반만-이뤄졌다) 참고.

05는 04 뒤에 해야 합니다 — 둘 다 `tools/build.mjs`를 만지고, 05가 시나리오를
인라인할 때 04의 secret 필터를 우회하면 안 되기 때문입니다.
06은 02에만 의존하므로 04·05와 **병렬로 진행해도 됩니다**(소유 파일이 겹치지 않습니다).

07은 [사람 GM 권위형 보조 엔진](07-gm-assistant.md)입니다. 자유 행동 판정 보조는
02만으로 구현할 수 있고, 시간·잔향 곡선·단서·NPC 기반 진행 제안은 05 완료 후
활성화합니다. 엔진은 제안만 만들며 게임 상태는 사람 GM 승인 뒤에만 변경합니다.

**01이 반드시 먼저입니다.** 01은 `rules.js`와 `net.js`를 *빈 껍데기로 생성하고
`app.js`에서 호출까지 연결*합니다. 그래야 02와 03이 서로 다른 파일만 만지면서
동시에 진행될 수 있습니다.

## 파일 소유권 (동시 작업 시 충돌 방지)

| 명세 | 이 파일들만 수정한다 |
|---|---|
| 01 | `web/**` 전부, `tools/build.mjs`, `tools/test.mjs` |
| 02 | `web/src/rules.js`, `web/src/ui-check.js`, `tools/test.mjs` |
| 03 | `web/src/net.js`, `web/src/ui-net.js`, `web/vendor/**` |
| 04 | `tools/build.mjs`, `web/template.html`, `web/src/data.js`, `web/src/net.js`, `web/src/ui-net.js` |
| 05 | `data/scenarios/**`, `web/src/ui-scenario.js`, `tools/build.mjs`, `tools/audit.mjs` |
| 06 | `web/src/ui-craft.js`, `web/src/ui-builder.js`, `web/src/rules.js`(추가만), `tools/verify-craft.mjs` |
| 07 | `data/gm-assistant.json`, `web/src/gm-assistant.js`, `web/src/ui-gm-assistant.js`, 별도 검증 파일 |

02와 03은 **`app.js`·`ui.js`·`store.js`를 수정하지 않습니다.** 01이 미리
호출 지점을 만들어 두기 때문입니다. 만약 수정이 꼭 필요하다고 판단되면
작업을 멈추고 그 이유를 보고하세요 — 명세가 틀린 것이니 명세를 고칩니다.

## 공통 규칙

1. **게임 수치를 임의로 바꾸지 마세요.** `docs/errata.md`에 37건의 불일치가
   있지만 전부 의도적으로 미해결 상태입니다. 어떤 값이 정본인지는 디자이너가 정합니다.
   코드는 `data/*.json`을 그대로 읽기만 합니다.
2. **`assets/original/`은 읽기 전용입니다.** 원본 보존이 목적입니다.
3. **`data/*.json`이 정본입니다.** 규칙 수치를 코드에 하드코딩하지 마세요.
   DC표·무기·잔향 임계치·여파화 표는 전부 `rules.json`에 있습니다.
4. 한국어 UI, 기존 디자인 토큰(`--rust`, `--amber`, `--paper` 등) 유지.
5. **런타임 의존성을 추가하지 마세요.** 빌드·테스트는 Node 표준 라이브러리
   (`node:test`, `node:fs`)만 씁니다. 허용된 예외는 둘뿐입니다.
   - 03의 **PeerJS** — `web/vendor/`에 벤더링해 빌드 시 인라인 (배포물은 외부 요청 0개)
   - **playwright** — 브라우저 검증용 devDependency. 배포물에 들어가지 않습니다.
6. 작업 후 `npm run verify`와 `npm run verify:ui`가 전부 통과해야 합니다.

## 검수 기준

명세마다 "완료 조건"이 있습니다. 체크박스를 스스로 만족했다고 선언하지 말고,
**실제로 실행해서 확인한 결과**를 보고하세요.

```bash
npm install          # playwright (devDependency). 브라우저는 이미 있으므로 재다운로드 안 함
npm run verify       # build + test + audit
npm run verify:ui    # build + 브라우저 검증 (tools/verify-ui.mjs)
```

브라우저 바이너리는 `/opt/pw-browsers`에 이미 있고 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`이
설정되어 있습니다 — **`npx playwright install`을 실행하지 마세요.** 다만 `playwright`
**패키지 자체는** `npm install`로 받아야 합니다(브라우저만 선설치되어 있습니다).

`tools/verify-ui.mjs`에 검사를 덧붙이세요. "구현했다"가 아니라 "실행해서 확인했다"를
남기는 것이 목적입니다.
