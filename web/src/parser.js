// web/src/parser.js — 자유 행동 파서 (2층, 명세 08 B-2, docs/specs/08-content-and-parser.md)
//
// ADR-003의 3층 구조(docs/adr/003-byok-ai-gm.md):
//   1층 규칙·상태·분기      코드          항상 동작
//   2층 자유 행동 해석      키워드 파서    이 파일. +키 없이도 동작
//   3층 서술·즉흥 판단      BYOK API      명세 09, 선택 기능
//
// 형태소 분석기를 넣지 않는다(용량, docs/specs/08 B-2 "한국어 처리"). 조사
// 제거 + 어간 매칭(startsWith)만 쓴다. 정확도보다 "실패해도 판정은 해준다"는
// 원칙(룰북 1.4)이 우선이다 — 이 파일이 반환하는 confidence가 0이어도
// 게임이 막히지 않는다(ui-play.js가 수동 선택 UI로 넘긴다).
//
// interpret()는 부수효과가 없다 — Math.random도, Store도 건드리지 않는다.
// Node(tools/test.mjs)와 브라우저 양쪽에서 그대로 로드된다(다른 web/src/*.js와
// 같은 패턴 — 파일 끝의 module.exports 참고).
const Parser = (() => {
  // 씬 작가(A)가 affordance.tags에 쓸 수 있는 태그 전부 (docs/specs/08-content-and-parser.md
  // B-1 "허용 태그"). 새 태그를 여기 추가하지 않으면 파서가 절대 못 맞춘다 —
  // tools/verify-parser.mjs가 씬 데이터의 모든 태그가 이 목록 안에 있는지 검사한다.
  const ALLOWED_TAGS = [
    '전기', '가연성', '물', '무거움', '날카로움', '금속', '유리',
    '결계', '이형', '기계', '높은곳', '좁은곳', '어둠', '소음원', '생명',
  ];

  // 조사 — 길게 매칭되는 것부터 시도해야 한다("에서"를 "에"로 잘못 자르지
  // 않도록). docs/specs/08 B-2 목록 그대로, 길이 내림차순으로 정렬해 둔다.
  const JOSA = ['에서', '으로', '을', '를', '이', '가', '은', '는', '에', '로', '와', '과', '의', '도', '만']
    .sort((a, b) => b.length - a.length);

  function stripJosa(token) {
    for (const j of JOSA) {
      if (token.length > j.length && token.endsWith(j)) return token.slice(0, -j.length);
    }
    return token;
  }

  function tokenize(text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean);
  }

  function noSpace(text) {
    return String(text || '').replace(/\s+/g, '');
  }

  // 동사(대표형) × 태그 → 판정 규칙표 (docs/specs/08 B-2). data/rules.json에
  // 넣지 않는다 — 게임 규칙이 아니라 파서의 사전이라서다(같은 문서 지시).
  // tags: ['*']는 "어떤 태그든 상관없다"(살피다·조사하다 — 정보 수집은
  // 대상의 성질과 무관하다).
  const VERB_RULES = [
    { label: '끊다', stems: ['끊', '자르', '부수'], tags: ['전기'], skill: 'tinker', dc: 15, effect: '인접 대상 감전' },
    { label: '부수다', stems: ['끊', '부수'], tags: ['결계'], skill: 'tinker', dc: 15, effect: '결계 해제, 소음' },
    { label: '태우다', stems: ['태우', '불붙이', '불붙'], tags: ['가연성'], skill: 'tinker', dc: 12, effect: '화재, 시야 차단' },
    { label: '정화하다', stems: ['정화하', '정화', '쫓'], tags: ['이형'], skill: 'exorcise', dc: 12, effect: '잔향 감소' },
    { label: '밀다', stems: ['밀', '던지'], tags: ['무거움'], skill: 'melee', dc: 12, effect: '피해 + 넘어뜨림' },
    { label: '숨다', stems: ['숨', '가리'], tags: ['어둠', '좁은곳'], skill: 'stealth', dc: 12, effect: '은신' },
    { label: '오르다', stems: ['오르'], tags: ['높은곳'], skill: 'stealth', dc: 12, effect: '위치 확보' },
    { label: '살피다', stems: ['살피', '조사하', '조사'], tags: ['*'], skill: 'survival', dc: 12, effect: '정보' },
  ];

  // 텍스트 안에서 어떤 VERB_RULES 항목의 어간이라도 나타나는지. 조사는
  // 명사에만 붙으므로 동사는 원문 토큰(조사 제거 전)으로 검사한다 —
  // "끊어서/끊고/끊을래/끊는다/끊자" 전부 stems:['끊']에 startsWith로 걸린다.
  function matchingVerbRules(tokens, flat) {
    return VERB_RULES.filter((rule) => rule.stems.some(
      (stem) => tokens.some((t) => t.startsWith(stem)) || flat.includes(stem)
    ));
  }

  // affordance.noun 중 하나라도 입력에 나타나는지. 명사는 조사가 붙어
  // 들어오므로(가로등을/가로등이) 조사를 뗀 토큰과 비교하고, 띄어쓰기가
  // 없거나 다르게 들어온 경우를 대비해 공백 제거 전체 문자열도 한 번 더
  // 본다(B-2 "띄어쓰기 무시하고도 한 번 더 시도").
  function findAffordance(affordances, tokens, flat) {
    const stripped = tokens.map(stripJosa);
    for (const aff of affordances) {
      const nouns = Array.isArray(aff.noun) ? aff.noun : [];
      for (const noun of nouns) {
        if (!noun) continue;
        if (flat.includes(noun)) return aff;
        if (stripped.some((t) => t === noun || (noun.length >= 2 && (t.includes(noun) || noun.includes(t) && t.length >= 2)))) {
          return aff;
        }
      }
    }
    return null;
  }

  return {
    ALLOWED_TAGS,

    // 파서 사전 원본 — ui-play.js가 기술 후보를 보여줄 때, 또는 검증 도구가
    // "이 표가 참조하는 태그가 전부 허용 목록 안에 있는지" 확인할 때 쓴다.
    verbs() { return VERB_RULES.map((r) => ({ ...r, stems: [...r.stems], tags: [...r.tags] })); },

    // "가로등 배선을 끊어서 감전시킬래" → { affordance, verb, skill, dc,
    // confidence, reason, effect } 또는 매칭 실패 시 { confidence: 0, reason }.
    //
    // scene.affordances가 없거나 빈 배열이어도(씬 작가가 아직 안 채웠을 때)
    // 죽지 않는다 — 그냥 confidence:0으로 떨어진다. 이게 정상 경로다
    // (docs/specs/08-content-and-parser.md B-2 "매칭 실패는 정상 경로").
    interpret(text, scene, party) { // eslint-disable-line no-unused-vars
      const raw = String(text || '').trim();
      if (!raw) return { confidence: 0, reason: '무엇을 할지 입력해 주세요.' };

      const tokens = tokenize(raw);
      const flat = noSpace(raw);
      const affordances = (scene && Array.isArray(scene.affordances)) ? scene.affordances : [];

      const affordance = findAffordance(affordances, tokens, flat);
      const verbRules = matchingVerbRules(tokens, flat);

      if (!affordance) {
        return {
          confidence: 0,
          reason: '이 장면의 요소로는 해석할 수 없습니다. 룰북 1.4대로 직접 정해 주세요.',
        };
      }

      const affTags = new Set(affordance.tags || []);
      const rule = verbRules.find((r) => r.tags.includes('*') || r.tags.some((t) => affTags.has(t)));
      if (!rule) {
        return {
          confidence: 0,
          affordance: affordance.id,
          affordanceLabel: affordance.hint || affordance.id,
          reason: verbRules.length
            ? `${affordance.hint || affordance.id} — 그 조합으로는 특별한 효과가 없습니다. 판정은 해드립니다.`
            : '이 장면의 요소로는 해석할 수 없습니다. 룰북 1.4대로 직접 정해 주세요.',
        };
      }

      const matchedTag = rule.tags.includes('*') ? ((affordance.tags && affordance.tags[0]) || '') : rule.tags.find((t) => affTags.has(t));
      return {
        confidence: 1,
        affordance: affordance.id,
        affordanceLabel: affordance.hint || affordance.id,
        verb: rule.label,
        tag: matchedTag,
        skill: rule.skill,
        dc: rule.dc,
        effect: rule.effect,
        reason: `대상: ${affordance.hint || affordance.id} (${(affordance.tags || []).join('·')}) — ${rule.label} → ${matchedTag} · DC ${rule.dc}`,
      };
    },
  };
})();

if (typeof module !== 'undefined') module.exports = Parser;
