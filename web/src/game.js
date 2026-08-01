// web/src/game.js — 진행 상태 머신 (명세 07, docs/specs/07-play-engine.md §2)
//
// rules.js처럼 부수효과 없는 순수 함수만 담는다. 주사위는 여기서 굴리지
// 않는다 — 호출자(ui-play.js, 브라우저에서 Math.random을 쓸 수 있는 쪽)가
// 미리 굴려서 rolls 배열로 넘긴다. 그래서 Node(tools/test.mjs)에서 결정적으로
// 테스트할 수 있다.
//
// 데이터: data/scenarios/*.scenes.json (명세 07). GM용 진행 데이터
// (data/scenarios/*.json, 명세 05)와는 다른 파일이다 — 이 파일은 그쪽을
// 전혀 읽지 않는다. scenesData 인자는 항상 "{ scenarioId, startScene,
// scenes: { <sceneId>: {...} } }" 모양이다.
//
// party 인자는 [{ name, stats, skills, hp, maxHp, radiation, parts }, ...]
// 모양 — ui-check.js의 snapshot()과 같은 필드를 쓴다. Rules.modifiers()가
// 기대하는 캐릭터 모양(stats/skills/hp/maxHp/radiation) 그대로다.
const Game = (() => {
  const RulesImpl = (typeof Rules !== 'undefined') ? Rules : require('./rules.js');

  // -------------------------------------------------------------------
  // amount 파싱 — "1d6" / "-1d10" / "+2" / 3 을 { fixed } 또는
  // { dice:{count,sides}, sign } 로 분해한다. Rules.parseDiceNotation()은
  // 부호를 모르므로(명세 06이 만든 그대로 손대지 않는다 — 다른 명세 소유
  // 파일이다) 부호는 여기서 떼어내고 순수 다이스 표기만 그 함수로 넘긴다.
  function parseAmount(amount) {
    if (typeof amount === 'number') return { fixed: amount };
    const str = String(amount == null ? '' : amount).trim();
    const neg = str.startsWith('-');
    const clean = neg ? str.slice(1).trim() : (str.startsWith('+') ? str.slice(1).trim() : str);
    const dice = RulesImpl.parseDiceNotation(clean);
    if (dice) return { dice, sign: neg ? -1 : 1 };
    const n = parseInt(str, 10);
    return { fixed: Number.isFinite(n) ? n : 0 };
  }

  // 이 effect가 주사위 하나를 소비하는지 (rolls 배열에서 하나 꺼내 써야
  // 하는지). ui-play.js가 "판정 전에 몇 개를 굴려야 하는지" 미리 알아야
  // 하므로 diceNeededFor*() 헬퍼에서도 이 판정을 그대로 재사용한다.
  function needsRoll(effect) {
    if (!effect || !['resonance', 'hp', 'shards'].includes(effect.type)) return false;
    return !!parseAmount(effect.amount).dice;
  }

  function resolveAmount(effect, rollValue) {
    const parsed = parseAmount(effect.amount);
    if (parsed.fixed !== undefined) return parsed.fixed;
    const val = typeof rollValue === 'number' ? rollValue : 0;
    return parsed.sign * val;
  }

  function resolveTargets(target, actorName, party) {
    if (target === 'party') return party.map((c) => c.name);
    if (target === 'actor') return actorName ? [actorName] : [];
    // 그 외엔 캐릭터 이름 자체로 본다.
    return [target];
  }

  const FIELD_BY_TYPE = { resonance: 'radiation', hp: 'hp', shards: 'parts' };

  // 선택지의 판정 기술에 캐릭터가 실제 숙련인지. Rules.modifiers()가 내부적
  // 으로 계산하는 숙련 판단을 그대로 재사용한다(rules.js의 isProficient는
  // export되지 않으므로, "숙련" 보정 항목이 결과에 있는지로 역으로 판별한다
  // — rules.js를 한 글자도 고치지 않기 위한 선택이다).
  function isSkillProficient(charSnapshot, skillId) {
    return RulesImpl.modifiers(charSnapshot, skillId).some((m) => m.source === 'proficiency');
  }

  function partyHasSkill(party, skillId) {
    return (party || []).some((c) => isSkillProficient(c, skillId));
  }

  // 대성공(crit) 칸이 없으면 성공(success)으로 떨어진다.
  // 원본 시나리오 문서의 표는 "성공 / 부분 성공 / 실패" 3열뿐인데
  // Rules.resolve()는 항상 4단계를 돌려준다. 씬 작가가 매번 success 텍스트를
  // crit에 복사하게 만들면 10개 씬에서 그대로 실수가 난다 — 엔진이 대신
  // 떨어뜨린다. 대성공만의 서술을 쓰고 싶으면 crit을 명시하면 된다.
  function outcomeFor(choice, tier) {
    if (!choice || !choice.outcomes) return null;
    if (!choice.check) return choice.outcomes.always || null;
    const o = choice.outcomes;
    if (tier === 'crit') return o.crit || o.success || null;
    return o[tier] || o.fail || null;
  }

  // 조건 검사는 flags 와 revealed 의 **합집합**을 본다.
  //
  // 둘은 뜻이 다르다 — flag는 "이 일이 일어났다", reveal은 "플레이어가 이걸
  // 알게 됐다". 그 구분은 화면 표시("알아낸 것" 목록)에서 의미가 있다.
  // 하지만 문을 여는 조건으로 물을 때는 둘 다 그냥 "지금 참인 것"이라,
  // 나누면 씬 작가가 매번 어느 쪽인지 기억해야 한다. 그래서 게이팅에서는
  // 한 네임스페이스로 합친다 — 대신 **id는 flags와 reveals를 통틀어 유일해야
  // 한다**(같은 id를 양쪽에 쓰면 어느 쪽인지 구분할 수 없다).
  //
  // 명세 07 초판은 이 필드를 `anyFlag`라 부르면서 예시에는 reveal id를 넣어
  // 자기모순이었다. `any`로 이름을 바꿨다.
  function knownSet(state) {
    return new Set([...(state.flags || []), ...(state.revealed || [])]);
  }

  function requiresOk(choice, state, party) {
    const req = choice.requires;
    if (!req) return true;
    if (req.partyHasSkill && !partyHasSkill(party, req.partyHasSkill)) return false;
    const known = knownSet(state);
    // any: 하나라도 참이면 통과 / all: 전부 참이어야 / none: 하나라도 참이면 막힘
    if (req.any && !req.any.some((f) => known.has(f))) return false;
    if (req.all && !req.all.every((f) => known.has(f))) return false;
    if (req.none && req.none.some((f) => known.has(f))) return false;
    // 옛 이름 — 이미 쓰인 데이터를 깨지 않기 위해 남긴다. 새 씬은 any를 쓸 것.
    if (req.anyFlag && !req.anyFlag.some((f) => known.has(f))) return false;
    return true;
  }

  return {
    // ------------------------------------------------------------------
    // 새 게임 상태. party는 지금은 쓰이지 않지만(초기 상태가 파티 구성에
    // 의존하지 않는다) 시그니처를 명세대로 유지한다 — 나중 씬이 파티 구성에
    // 따라 시작 플래그를 다르게 줄 수도 있다.
    newGame(scenesData, party) { // eslint-disable-line no-unused-vars
      return {
        sceneId: scenesData.startScene,
        flags: [],
        revealed: [],
        visitedScenes: [],
        usedChoices: {},
        usedAffordances: {},
        history: [],
      };
    },

    // ------------------------------------------------------------------
    // 자유 행동 파서(명세 08 B-2)가 쓰는 최소 상태 — "이 씬에서 이 장면
    // 요소(affordance)를 이미 써먹었는가". 미리 쓰인 선택지(usedChoices)와는
    // 별개 네임스페이스다 — 자유 행동은 usedChoices에 걸리지 않는다
    // (docs/specs/08-content-and-parser.md B-2 "반드시 지킬 것"). 대신
    // affordance당 1회로 여기서 따로 막는다.
    affordanceUsed(state, sceneId, affordanceId) {
      if (!affordanceId) return false;
      const used = (state.usedAffordances && state.usedAffordances[sceneId]) || [];
      return used.includes(affordanceId);
    },

    // 자유 행동 판정 결과를 상태에 남긴다. 미리 쓰인 선택지(applyChoice)와
    // 달리 씬 데이터에 outcomes가 없으므로(즉흥 판정이라 애초에 정의될 수
    // 없다) 기계적 효과는 만들어내지 않는다 — 판정 결과(tier)와 서술만
    // 기록한다. 캐릭터 시트에 직접 영향을 주고 싶으면(예: 실패 시 잔향
    // 획득) 호출부가 effect를 넘기면 그때 적용한다. affordanceId가 없으면
    // (파서가 아무것도 못 짚어서 완전 수동으로 판정한 경우) 재사용 방지
    // 목록에는 아무것도 남기지 않는다 — 애초에 대상이 없었으므로.
    applyFreeAction(state, party, action) {
      const { sceneId, affordanceId, actorName, skillId, dc, tier, narrative, effect } = action || {};
      const used = { ...(state.usedAffordances || {}) };
      if (affordanceId) {
        const list = used[sceneId] || [];
        if (!list.includes(affordanceId)) used[sceneId] = [...list, affordanceId];
        else used[sceneId] = list;
      }
      let nextParty = party;
      if (effect) {
        const applied = this.applyEffect(state, party, effect, actorName, action.rollValue);
        nextParty = applied.party;
      }
      const history = [...(state.history || []), {
        sceneId, choiceId: null, freeAction: true, affordanceId: affordanceId || null,
        actorName: actorName || null, skillId: skillId || null, dc: dc || null,
        tier: tier || null, text: narrative || '',
      }];
      return { state: { ...state, usedAffordances: used, history }, party: nextParty };
    },

    // 지금 씬에서 고를 수 있는 선택지 — requires 평가 + 이미 쓴 선택지 제외.
    availableChoices(state, scenesData, party) {
      const scene = scenesData.scenes[state.sceneId];
      if (!scene) return [];
      const used = (state.usedChoices && state.usedChoices[state.sceneId]) || [];
      return (scene.choices || []).filter((c) => !used.includes(c.id) && requiresOk(c, state, party));
    },

    // 선택지의 판정에 가장 적합한 캐릭터 — 보정 합이 가장 큰 사람.
    // check가 없는 선택지(판정 없이 즉시 결과)는 null.
    bestActor(choice, party) {
      if (!choice || !choice.check) return null;
      const candidates = Array.isArray(choice.actor) ? party.filter((c) => choice.actor.includes(c.name)) : party;
      let best = null;
      let bestSum = -Infinity;
      (candidates || []).forEach((c) => {
        const sum = RulesImpl.modifiers(c, choice.check.skill).reduce((a, m) => a + m.value, 0);
        if (sum > bestSum) { bestSum = sum; best = c.name; }
      });
      return best;
    },

    // 이 선택지(현재 tier)를 실제로 골랐을 때 필요한 주사위 목록
    // [{ sides }, ...] — effects 배열 순서대로. ui-play.js가 판정 전에
    // 몇 개의 주사위를 몇 면으로 굴려야 할지 알아내는 용도(rolls 배열을
    // applyChoice에 순서대로 넘기기 전에 미리 굴린다).
    diceNeededForChoice(scenesData, sceneId, choiceId, tier) {
      const scene = scenesData.scenes[sceneId];
      const choice = scene && (scene.choices || []).find((c) => c.id === choiceId);
      const outcome = choice && outcomeFor(choice, tier);
      if (!outcome) return [];
      return (outcome.effects || []).filter(needsRoll).map((e) => parseAmount(e.amount).dice);
    },

    // 씬 onEnter가 필요로 하는 주사위 목록. enterScene() 호출 전에
    // ui-play.js가 미리 굴려 rolls로 넘긴다.
    diceNeededForEnter(scenesData, sceneId) {
      const scene = scenesData.scenes[sceneId];
      if (!scene) return [];
      return (scene.onEnter || []).filter(needsRoll).map((e) => parseAmount(e.amount).dice);
    },

    // 씬 진입 시 onEnter 효과 적용 — 같은 씬에 이미 들어와 있었다면
    // (state.visitedScenes에 있으면) 아무 일도 하지 않는다(중복 적용 방지 —
    // 예: 새로고침 후 재렌더).
    enterScene(state, scenesData, party, rolls) {
      const scene = scenesData.scenes[state.sceneId];
      const already = (state.visitedScenes || []).includes(state.sceneId);
      if (!scene || already) {
        return { state, party, log: [] };
      }
      let nextState = { ...state, visitedScenes: [...(state.visitedScenes || []), state.sceneId] };
      let nextParty = party;
      let rollIdx = 0;
      const log = [];
      (scene.onEnter || []).forEach((effect) => {
        const rollValue = needsRoll(effect) ? rolls[rollIdx++] : null;
        const applied = this.applyEffect(nextState, nextParty, effect, 'party', rollValue);
        nextState = applied.state;
        nextParty = applied.party;
        const amount = resolveAmount(effect, rollValue);
        log.push(`${effect.text || effect.type}${amount ? ` (${amount >= 0 ? '+' : ''}${amount})` : ''}`);
      });
      return { state: nextState, party: nextParty, log };
    },

    // 선택 실행 — 판정 결과(tier)를 받아 다음 상태를 만든다. check가 없는
    // 선택지는 tier를 무시하고 outcomes.always를 쓴다(호출자는 이때
    // tier로 아무 값이나 넘겨도 된다 — 보통 null).
    applyChoice(state, scenesData, party, choiceId, actorName, tier, rolls) {
      const scene = scenesData.scenes[state.sceneId];
      if (!scene) throw new Error(`applyChoice: 알 수 없는 씬 '${state.sceneId}'`);
      const choice = (scene.choices || []).find((c) => c.id === choiceId);
      if (!choice) throw new Error(`applyChoice: 씬 '${state.sceneId}'에 선택지 '${choiceId}' 없음`);
      const outcome = outcomeFor(choice, tier);
      if (!outcome) throw new Error(`applyChoice: 선택지 '${choiceId}'의 결과가 없음 (tier=${tier})`);

      const usedChoices = { ...(state.usedChoices || {}) };
      usedChoices[state.sceneId] = [...(usedChoices[state.sceneId] || []), choiceId];
      let nextState = {
        ...state,
        flags: [...(state.flags || [])],
        revealed: [...(state.revealed || [])],
        visitedScenes: [...(state.visitedScenes || [])],
        usedChoices,
        history: [...(state.history || [])],
      };
      let nextParty = party;

      const log = [];
      let rollIdx = 0;
      (outcome.effects || []).forEach((effect) => {
        const rollValue = needsRoll(effect) ? (rolls || [])[rollIdx++] : null;
        const applied = this.applyEffect(nextState, nextParty, effect, actorName, rollValue);
        nextState = applied.state;
        nextParty = applied.party;
        const amount = resolveAmount(effect, rollValue);
        log.push(`${effect.type}${amount ? ` (${amount >= 0 ? '+' : ''}${amount})` : ''}`);
      });

      (outcome.reveals || []).forEach((r) => {
        if (!nextState.revealed.includes(r)) nextState.revealed = [...nextState.revealed, r];
      });

      nextState.history = [...nextState.history, {
        sceneId: state.sceneId, choiceId, actorName: actorName || null, tier: tier || null, text: outcome.text || '',
      }];

      let moved = false;
      let nextSceneMissing = false;
      if (outcome.goto) {
        if (scenesData.scenes[outcome.goto]) {
          nextState.sceneId = outcome.goto;
          moved = true;
        } else {
          nextSceneMissing = true;
        }
      }

      return { state: nextState, party: nextParty, log, narrative: outcome.text || '', moved, nextSceneMissing };
    },

    // 효과 하나를 적용 — 테스트하기 쉽게 applyChoice/enterScene에서 분리.
    // rollValue는 amount가 주사위 표기일 때만 쓰인다(고정 정수면 무시).
    applyEffect(state, party, effect, actorName, rollValue) {
      if (!effect) return { state, party };

      if (effect.type === 'resonance' || effect.type === 'hp' || effect.type === 'shards') {
        const field = FIELD_BY_TYPE[effect.type];
        const amount = resolveAmount(effect, rollValue);
        const targets = new Set(resolveTargets(effect.target, actorName, party));
        const nextParty = party.map((c) => {
          if (!targets.has(c.name)) return c;
          let v = (typeof c[field] === 'number' ? c[field] : 0) + amount;
          if (field === 'radiation') v = Math.max(0, Math.min(100, v));
          else if (field === 'hp') v = Math.max(0, typeof c.maxHp === 'number' ? Math.min(c.maxHp, v) : v);
          else if (field === 'parts') v = Math.max(0, v);
          return { ...c, [field]: v };
        });
        return { state, party: nextParty };
      }

      if (effect.type === 'flag') {
        let flags = state.flags || [];
        if (effect.set && !flags.includes(effect.set)) flags = [...flags, effect.set];
        if (effect.clear) flags = flags.filter((f) => f !== effect.clear);
        return { state: { ...state, flags }, party };
      }

      if (effect.type === 'combat') {
        // 자리만 잡는다(docs/specs/07-play-engine.md §1) — 실제 턴제 전투는
        // 명세 09. 여기서는 "전투가 시작되어야 한다"는 사실만 상태에 남긴다.
        return { state: { ...state, pendingCombat: effect.npcs || [] }, party };
      }

      // goto는 outcome 레벨 필드라 applyChoice가 직접 처리한다(위 표
      // "goto (결과 객체의 goto 필드)" 참고) — 여기로 들어오면 아무 일도
      // 하지 않는다. 알 수 없는 타입도 마찬가지로 조용히 무시한다(호출부가
      // 잘못된 데이터를 넣어도 게임이 멈추지 않게).
      return { state, party };
    },
  };
})();

if (typeof module !== 'undefined') module.exports = Game;
