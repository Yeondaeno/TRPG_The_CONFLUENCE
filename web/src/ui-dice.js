// web/src/ui-dice.js — 주사위 굴림 애니메이션 (명세 10 §3)
//
//   Dice.roll(mountEl, { sides: 20, value: 15, label: '노아의 설득' })
//
// 반드시 지킬 것 두 가지가 있다(docs/specs/10-combat-and-dice.md §3).
//
// 1) **Math.random을 쓰지 않는다.** tools/verify-*.mjs가 Math.random을
//    "미리 채운 큐에서 꺼내 쓰는" 함수로 바꿔치기해 굴림을 결정적으로
//    재현한다. 애니메이션이 그 큐를 한 개라도 먹으면 게임의 판정이 엉뚱한
//    값을 받는다. 그래서 눈을 프레임 카운터로 돌린다(아래 faceAt).
//
// 2) **결과 텍스트를 지연시키지 않는다.** 애니메이션은 곁들이는 시각
//    요소일 뿐이고, 판정 결과 문자열은 호출부가 지금처럼 즉시 DOM에 넣는다.
//    이 모듈은 주사위 그림만 담당한다. 그래서 기존 검증 40여 건(클릭 후
//    400ms에 innerText를 읽는다)이 하나도 깨지지 않는다.

const Dice = (() => {
  const DURATION = 620;  // ms — 구르는 시간
  const TICK = 55;       // ms — 눈이 바뀌는 간격

  function reduced() {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // 결정적인 "무작위처럼 보이는" 눈. 프레임 번호와 주사위 종류만으로
  // 정해지므로 Math.random이 필요 없다. 두 수(7, 3)는 sides와 서로소가 되기
  // 쉬운 값이라 같은 눈이 연달아 나오는 일이 드물다.
  function faceAt(tick, sides, seed) {
    return ((tick * 7 + seed * 3) % sides) + 1;
  }

  // d20/d6/d4… 마다 색을 달리해 어느 주사위가 구르는지 한눈에 보이게 한다.
  function toneFor(sides) {
    if (sides === 20) return 'var(--amber)';
    if (sides === 100 || sides === 10) return 'var(--olive)';
    return 'var(--paper)';
  }

  // 자연 20 / 자연 1은 눈에 띄어야 한다 — 판정 결과의 두 특이점이다
  // (rules.json outcomeTiers의 자연 20 자동 대성공 / 자연 1 자동 실패).
  function extremeClass(sides, value) {
    if (sides !== 20) return '';
    if (value === 20) return ' die-crit';
    if (value === 1) return ' die-botch';
    return '';
  }

  function makeDie(sides, value, label) {
    const d = document.createElement('span');
    d.className = 'die die-rolling' + extremeClass(sides, value);
    d.style.setProperty('--die-tone', toneFor(sides));
    d.setAttribute('role', 'img');
    d.setAttribute('aria-label', `${label ? label + ' — ' : ''}d${sides} ${value}`);
    const face = document.createElement('span');
    face.className = 'die-face';
    face.textContent = String(value);
    const tag = document.createElement('span');
    tag.className = 'die-tag';
    tag.textContent = 'd' + sides;
    d.appendChild(face);
    d.appendChild(tag);
    return { el: d, face };
  }

  // 주사위 하나를 굴린다. 반환값은 만들어진 엘리먼트 — 호출부가 원하는 곳에
  // 이미 붙어 있다(mount에 append했다).
  function one(mount, sides, value, label, seed) {
    if (!mount || !document) return null;
    const { el, face } = makeDie(sides, value, label);
    mount.appendChild(el);
    if (reduced()) { el.classList.remove('die-rolling'); return el; }

    let tick = 0;
    const timer = setInterval(() => {
      tick += 1;
      face.textContent = String(faceAt(tick, sides, seed || 0));
    }, TICK);
    setTimeout(() => {
      clearInterval(timer);
      face.textContent = String(value);
      el.classList.remove('die-rolling');
      el.classList.add('die-settled');
      // 착지 반동이 끝나면 클래스를 떼서, 다시 그려질 때 애니메이션이
      // 어긋나지 않게 한다.
      setTimeout(() => el.classList.remove('die-settled'), 260);
    }, DURATION);
    return el;
  }

  return {
    // { sides, value, label } 하나 또는 배열을 받는다.
    roll(mount, spec) {
      const list = Array.isArray(spec) ? spec : [spec];
      return list.map((s, i) => one(mount, s.sides, s.value, s.label, i)).filter(Boolean);
    },
    // 굴림 여러 개를 담을 줄 하나를 만들어 붙이고 그 줄을 돌려준다.
    // 호출부는 대개 이걸 쓴다: Dice.tray(panel, [{sides:20,value:15}])
    tray(parent, spec) {
      const row = document.createElement('div');
      row.className = 'dice-tray';
      if (parent) parent.appendChild(row);
      this.roll(row, spec);
      return row;
    },
    DURATION,
    faceAt, // 테스트용 — 결정적임을 확인한다
  };
})();

if (typeof module !== 'undefined') module.exports = Dice;
