# 구현 명세

Sonnet 5가 실행할 작업 명세입니다. 각 명세는 **독립적으로 완료 가능하고,
끝난 시점에 세션에서 실제로 쓸 수 있는 상태**여야 합니다.

## 순서와 의존성

```
01-foundation ✅   02-check-engine ✅   03-p2p-sync ✅
04-secret-split ✅  05-scenario-data ✅  06-crafting-and-builder ✅
        │
        ▼  ADR-002 — 방향 전환: GM 보조 도구 → 플레이 가능한 게임
        │
07-play-engine ✅      씬 스키마 · 진행 엔진 · 플레이 화면
        │             (씬 하나로 스키마를 먼저 증명한다)
        ▼
08-content-and-parser ✅  나머지 10개 씬 + 8인 파티 선택 + 자유 행동 파서(2층)
        │             (씬 0~에필로그 14개, 도입 씬 0에서 시작)
        ▼
09-byok-ai            AI GM 연동 — 사용자 계정(BYOK) 다중 공급자 (3층)  ← 다음
10 전투               적이 실제로 행동하는 턴제
```

**AI는 3층입니다** — [ADR-003](../adr/003-byok-ai-gm.md). 작은 모델을 내장하는
안(+400MB~2GB)을 버리고 사용자가 자기 API 키로 자기 모델을 쓰게 합니다(+15KB).
**키가 없어도 게임은 100% 동작합니다.**

```
1층  규칙·상태·분기      코드          항상. 오프라인. 318KB
2층  자유 행동 해석      키워드 파서    +~60KB. 키 없이도
3층  서술·즉흥 판단      BYOK API      선택
```

**명세 07부터는 성격이 다릅니다.** 01~06은 사람 GM이 진행하는 전제 위에서
도구를 다듬는 일이었습니다. 07부터는 **게임 자체**를 만듭니다 —
[ADR-002](../adr/002-playable-game.md)를 먼저 읽으세요.

01~06의 결과물은 버리지 않습니다. 판정 엔진·캐릭터·NPC·잔향·조합·P2P·
비밀 분리가 전부 CRPG의 하부 구조로 그대로 쓰입니다.

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
| 07 | `web/src/game.js`, `ui-play.js`, `data/scenarios/*.scenes.json`, `tools/verify-play.mjs` + **공용 파일 허용** (새 진입점이라 슬롯으로 우회 불가) |

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
