# 합경 (合境 · CONFLUENCE)

> 차원 융합 어반판타지 TRPG — 8인 이상 파티 · 사람 GM 진행 · 원샷 3~4시간

어느 날 원인 불명의 '융합 현상'이 일어나 지구의 차원이 이계들과 뒤섞였고,
구역마다 다른 세계의 법칙이 흐르는 거대도시 **합경**이 태어났다.
요괴가 거니는 골목, 네온의 사이버펑크 지구, 숲이 삼킨 건물, 금지된 의식의 회랑,
뱀파이어와 헌터가 대치하는 안개 속 — 그 도시에서 살아가는 이들의 이야기.

d20 기반 판정에, **규칙서에 없는 행동도 5초 안에 판정하는 범용 프레임워크**를
얹은 것이 이 시스템의 핵심입니다.

## 시작하기

| 나는 | 여기로 |
|---|---|
| 처음 왔다 | [룰북](docs/rulebook.md) — 30분이면 다 읽힙니다 |
| 오늘 플레이한다 | [사전 제작 캐릭터 16종](docs/pregens.md)에서 하나 고르세요 |
| **오늘 GM을 한다** | [시나리오 「역참-0」](docs/scenario-station-0.md) — 원샷 3~4시간, 이거 하나면 됩니다.<br>플레이어에겐 `web/index.html`만 주고, `web/secrets.json`은 **혼자 갖고 계세요** |
| 세계관을 더 알고 싶다 | [설정 보충](docs/setting-supplement.md) — 교환장, 위상잔향 운용 |
| 이 저장소에 기여한다 | [개선점과 구현 방향](docs/roadmap.md) → [구현 명세](docs/specs/) |

## 저장소 구조

```
docs/
  rulebook.md            룰북 (원본 docx의 마크다운판)
  pregens.md             사전 제작 캐릭터 16종 — data/characters.json 에서 생성
  scenario-station-0.md  원샷 시나리오 「역참-0」 (3~4시간)
  setting-supplement.md  설정 보충 — 교환장 구역, 위상잔향 운용 곡선
  errata.md              원본 자료 교차검증에서 나온 정합성 이슈 37건
  roadmap.md             개선점 분석과 구현 순서
  adr/                   구조 결정 기록
  specs/                 구현 명세
data/              ← 정본(single source of truth)
  rules.json       DC표, 4단계 결과, 무기, 위상잔향, 여파화 표, 조합, 구역
  characters.json  사전 제작 캐릭터 16종 (성별 포함 — docs/pregens.md의 단서 참고)
  monsters.json    몬스터/NPC 스탯
  scenarios/
    station-0.json 시나리오 「역참-0」 — Act·씬·NPC·잔향 곡선
web/
  index.html       세션 웹도구 — 전원에게 배포. 비밀 없음
  secrets.json     16명의 비밀만 — GM에게만. 빌드가 자동 생성 (명세 04)
  src/             웹도구 소스. 빌드가 index.html로 인라인한다
  vendor/          PeerJS (P2P 동기화용)
tools/
  build.mjs        src + data → index.html + secrets.json
  audit.mjs        데이터 정합성 검사기
  test.mjs         판정 엔진 단위 테스트
  verify-ui.mjs    브라우저 검증
  verify-craft.mjs 조합·빌더 브라우저 검증
  verify-play.mjs  플레이 엔진 브라우저 검증
  verify-parser.mjs 파티 편성·자유 행동 파서 브라우저 검증
  verify-combat.mjs 전투·주사위 애니메이션 브라우저 검증
  demo-session.mjs 시연 영상 녹화 (npm run demo)
assets/original/   원본 docx / html — 변경하지 않고 보존
```

`data/*.json`이 정본이고 `docs/`의 문서는 그것을 사람이 읽기 좋게 옮긴 뷰입니다.
수치를 고칠 일이 있으면 JSON을 먼저 고치세요.

## 정합성 검사

```bash
node tools/audit.mjs
```

`data/*.json`을 룰북 규칙과 대조해 어긋난 부분을 보고합니다.
현재 R-* 37건(원본 자료) + S-* 2건(시나리오)이 나오며,
R-*는 전부 [`docs/errata.md`](docs/errata.md)에 배경과 선택지를 정리해 두었습니다.
**원본 수치는 하나도 고치지 않았습니다** — 어떤 값이 맞는지는 디자이너가 정할 문제라서,
도구는 "어긋나 있다"까지만 말합니다.

## 웹도구

`web/index.html` 하나로 동작하는 세션 도구입니다. 파일을 받아서 열기만 하면 됩니다 —
설치도, 계정도, 서버도 필요 없고 **외부 요청을 하나도 하지 않습니다.**

- **캐릭터시트** — 16종 점유, HP·위상잔향·결정편·메모
- **판정** — 기술과 DC를 고르면 능력치·숙련·부상·잔향 보정을 자동 합산하고
  룰북 1.4의 4단계 결과를 판정합니다. 8인 그룹 판정도 여기서 집계합니다
- **전투** — 씬이 부르면 실제로 턴제 전투가 열립니다. 선제권(d20+AGI) 순으로
  차례가 돌고, 적이 실제로 공격하며, 중상 −2·빈사 사망 판정·치유술 안정화가
  규칙서대로 굴러갑니다. **적 스탯은 전부 `monsters.json`/시나리오 `npcs`에서
  그대로 옵니다 — 지어낸 수치가 하나도 없습니다** ([명세 10](docs/specs/10-combat-and-dice.md)).
  GM용 선제권 트래커도 그대로 있습니다
- **주사위 애니메이션** — 모든 굴림에서 눈이 굴러가다 멈춥니다.
  자연 20/자연 1은 색으로 구분되고, `prefers-reduced-motion`을 존중합니다
- **시나리오 진행** (GM 전용) — Act·씬 목록과 목표 시간, 지연 경고,
  **씬의 NPC를 트래커에 한 번에 투입**, 잔향 곡선 대비 파티 평균
- **즉석 조합** — 룰북 4.2 레시피 5종. 결정편 자동 차감, 위상 필터 사용까지
- **캐릭터 빌더** — 부록 A로 17번째 캐릭터 생성
- **AI GM (선택)** — 자기 API 키를 넣으면 자유 행동 해석과 결과 서술을 AI가
  돕습니다. Claude·ChatGPT·Gemini·Grok·DeepSeek·Kimi와 **로컬 모델**
  (Ollama·LM Studio)을 고를 수 있습니다. **키가 없어도 게임은 100% 동작하고,
  규칙 판정은 언제나 코드가 합니다** — AI는 확정된 결과를 묘사할 뿐입니다.
  키는 이 브라우저에만(`hg:ai`) 저장되고 방 데이터·P2P로 나가지 않으며,
  캐릭터 비밀은 프롬프트에 넣지 않습니다 ([명세 09](docs/specs/09-byok-ai.md))
- **P2P 동기화** — GM이 방을 열고 나머지가 방 코드로 붙습니다
  ([ADR-001](docs/adr/001-p2p-sync.md))
- **비밀 분리 빌드** — 사전 제작 캐릭터의 secret은 `web/index.html`(전원 배포)에는
  아예 들어가지 않습니다. `web/secrets.json`(GM 전용)에 따로 있고, GM이 GM
  대시보드에서 그 파일을 불러오면 P2P로 각 점유자에게 자기 캐릭터의 비밀만
  전송됩니다. GM이 안 불러와도 세션은 정상 진행되며 비밀 칸만 비어 있습니다
  ([명세 04](docs/specs/04-secret-split.md))

**네트워크가 하나도 안 붙어도 도구는 전부 동작합니다.** P2P는 동기화 계층이지
저장 계층이 아닙니다. 연결이 안 되면 조용히 로컬 모드로 남습니다.

### 개발

```bash
npm install
npm run build       # web/src/* + data/*.json → web/index.html + web/secrets.json
npm run verify        # build + 단위 테스트 + 데이터 정합성 검사
npm run verify:ui     # 브라우저 검증
npm run verify:craft  # 조합·빌더 브라우저 검증
npm run verify:play   # 플레이 엔진(씬 진행·판정·저장) 브라우저 검증
npm run verify:parser # 8인 파티 편성 + 자유 행동 파서 브라우저 검증
npm run verify:combat # 턴제 전투 + 주사위 애니메이션 브라우저 검증
npm run verify:ai     # AI GM(BYOK) 브라우저 검증 (fetch 스텁 — 실제 API 호출 없음)
npm run demo          # 시나리오 오프닝을 실제로 굴려 영상으로 녹화 (약 2분)
```

`npm run demo`는 검증이 아니라 **시연**입니다 — 도구가 세션에서 실제로 어떻게
쓰이는지 자막과 함께 보여줍니다. 새 GM에게 설명하거나, 화면 배치를 바꾼 뒤
흐름이 여전히 자연스러운지 눈으로 확인할 때 쓰세요.

`npm run build`는 `web/index.html`(전원 배포, 비밀 없음)과 `web/secrets.json`
(GM 전용, 배포 산출물이 아님)을 함께 만들고, 산출물에 비밀 문자열이 하나라도
남아 있으면 종료 코드 1로 실패합니다.

## 아직 없는 것

룰북의 규칙은 전부 도구에 들어갔습니다. 남은 것은 다듬는 일입니다.

- 자유 굴림기와 판정기가 결과 박스를 공유해 헷갈립니다
- 실제 NAT 통과 검증 — 서로 다른 네트워크의 사람 둘이 필요합니다
  ([ADR-001의 대가](docs/adr/001-p2p-sync.md#감수하는-대가))
- **AI 공급자가 브라우저에서 실제로 붙는지** — `file://`로 연 페이지는 출처가
  `null`이라 대부분의 API가 거부할 수 있습니다. 검증은 `fetch` 스텁으로
  프로토콜만 확인했고 **실제 API를 한 번도 호출하지 않았습니다.** 공급자별
  CORS 허용 여부는 전부 "미확인"으로 두었습니다 — 추측해서 "된다"고 적는 것보다
  낫습니다. 확실한 경로는 자기 컴퓨터에서 CORS를 여는 로컬 모델입니다

`docs/errata.md`의 37건(R-*)은 **의도적으로 미해결**입니다. 어떤 값이 정본인지는
디자이너가 정할 문제라, 검사기는 어긋난 지점만 보고합니다.
시나리오 검사(S-*) 2건도 같은 성격입니다.

## 라이선스

미정. 원본 저작자가 정하기 전까지는 사적 이용 범위로 두는 것을 권합니다.
