# 게스트하우스 신청서 관리자 페이지 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서식 이미지·칸 좌표·요금표·계좌·입력 항목을 브라우저에서 편집해 GitHub에 저장하면 모든 주민에게 반영되는 관리자 페이지를 만든다.

**Architecture:** 하드코딩된 값을 `config.json` 한 곳으로 모은다. `config.js`가 내장 기본값·검증·좌표 변환을 순수 함수로 제공하고, `index.html`·`draw.html`·`admin.html`이 이를 읽는다. `admin.html`은 GitHub Contents API로 `config.json`과 서식 이미지를 직접 커밋한다. `config.json`이 없거나 깨지면 내장 기본값으로 자동 복귀하므로 사이트가 절대 죽지 않는다.

**Tech Stack:** 순수 ES 모듈 + 브라우저 내장 API만. 빌드 도구 없음, 외부 런타임 의존성 0. 테스트는 `node --test`. 배포는 GitHub Pages.

설계 문서: `docs/superpowers/specs/2026-07-28-guesthouse-admin-design.md`

## Global Constraints

- **의존성 0.** npm 패키지, CDN 스크립트, 빌드 단계를 추가하지 않는다. (Pretendard 웹폰트 CSS 링크는 기존 그대로 유지)
- **최상위 `await` 금지.** Safari 15 미만에서 모듈 전체가 파싱 실패해 리스너가 하나도 붙지 않는다. `.then()/.catch()`만 쓴다. (`index.html:762` 주석 참조)
- **`structuredClone` 금지.** Safari 15.4+ 전용이다. 깊은 복사는 `JSON.parse(JSON.stringify(x))`를 쓴다.
- **`new Date('YYYY-MM-DD')` 금지.** UTC로 해석되어 시간대에 따라 하루 밀린다. `new Date(y, m-1, d)`로 조립한다.
- **`toISOString()` 금지.** 같은 이유. 날짜 문자열은 `${y}-${pad2(m)}-${pad2(d)}`로 조립한다.
- **좌표계는 항상 원본 이미지 픽셀** (`config.form.width` × `config.form.height`). 화면 표시 배율은 별도 계산.
- **커밋 메시지는 한국어**, Conventional Commits. 본문에 Why/What. `Co-Authored-By` 줄 금지.
- **테스트 실행:** `node --test calc.test.mjs config.test.mjs github.test.mjs`
- **수동 확인:** `python -m http.server 8000`. `file://`로 열면 canvas가 오염되어 `toBlob`이 실패한다.
- **저장소:** `useApart/guesthouse-form` (branch `main`)

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `config.js` | 내장 기본값 · 검증/정규화 · 좌표 변환 · 배치 규칙. **순수 함수, DOM 의존 없음** | 신규 |
| `config.test.mjs` | 위 전부에 대한 테스트 | 신규 |
| `github.js` | UTF-8 base64 변환 · Contents API 읽기/커밋 · Commits API 이력 | 신규 |
| `github.test.mjs` | base64 변환과 커밋 메시지 조립 등 순수 부분 테스트 | 신규 |
| `admin.html` | 관리자 화면 (CSS/JS 인라인, 기존 페이지 관례 따름) | 신규 |
| `config.json` | 실제 설정값 (초기값 = 기본값) | 신규 |
| `calc.js` | `pricing` 인자를 받도록 수정 | 수정 |
| `calc.test.mjs` | 인자 변경 반영 | 수정 |
| `index.html` | config 기반 폼 생성·렌더링 | 수정 |
| `draw.html` | config 기반 필드 박스 생성 | 수정 |
| `README.md` | 관리자 페이지 사용법 추가 | 수정 |

`config.js`를 분리하는 이유는 이 프로젝트가 `calc.js`에 이미 적용한 원칙이다 — 틀릴 수 있는 로직은 DOM에서 떼어내 `node --test`로 검증한다.

---

### Task 1: `config.js` 기본값과 좌표 변환

이 프로젝트에서 가장 중요한 작업이다. `DEFAULT_CONFIG`가 현재 하드코딩된 값과 정확히 같아야 이후 리팩터가 안전하다.

**Files:**
- Create: `config.js`
- Test: `config.test.mjs`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `DEFAULT_CONFIG` — 설계 문서의 스키마를 그대로 담은 객체
  - `clone(value)` → 깊은 복사본
  - `rectToPoint({x, y, w, h})` → `{ x, y, maxWidth }` (canvas `fillText` 중심 좌표)

- [ ] **Step 1: 실패하는 테스트 작성**

`config.test.mjs`를 새로 만든다. `LEGACY_POS`는 현재 `index.html:216-226`에 하드코딩된 값을 그대로 옮긴 것이다.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, rectToPoint, clone } from './config.js';

// 리팩터 전 index.html이 하드코딩하고 있던 값. 설정 기반으로 바꾼 뒤에도
// 같은 자리에 찍혀야 한다. 이 테스트가 리팩터 전체의 안전망이다.
const LEGACY_POS = {
  applyDate: { x: 432, y: 211, maxWidth: 400 },
  name:      { x: 432, y: 241, maxWidth: 400 },
  unit:      { x: 432, y: 270, maxWidth: 400 },
  phone:     { x: 432, y: 300, maxWidth: 400 },
  period:    { x: 301, y: 337, maxWidth: 136 },
  nights:    { x: 560, y: 337, maxWidth: 145 },
  amount:    { x: 301, y: 370, maxWidth: 136 },
  people:    { x: 560, y: 370, maxWidth: 145 },
  deposit:   { x: 301, y: 471, maxWidth: 136 },
};

test('기본 설정의 칸 좌표가 기존 하드코딩 POS와 일치한다', () => {
  for (const [id, legacy] of Object.entries(LEGACY_POS)) {
    const field = DEFAULT_CONFIG.fields.find((f) => f.id === id);
    assert.ok(field, `${id} 항목이 기본 설정에 없다`);
    assert.ok(field.rect, `${id}에 rect가 없다`);

    const point = rectToPoint(field.rect);
    // 중심점 ±1px: 기존 값이 픽셀 스캔으로 손수 읽은 값이라 반올림 방향이
    // 일관되지 않다. 설계 문서 "반올림으로 생기는 1px 차이" 참조.
    assert.ok(Math.abs(point.x - legacy.x) <= 1, `${id} x: ${point.x} vs ${legacy.x}`);
    assert.ok(Math.abs(point.y - legacy.y) <= 1, `${id} y: ${point.y} vs ${legacy.y}`);
    assert.ok(
      Math.abs(point.maxWidth - legacy.maxWidth) <= 3,
      `${id} maxWidth: ${point.maxWidth} vs ${legacy.maxWidth}`
    );
  }
});

test('서식에 찍히는 칸은 정확히 9개다', () => {
  const printed = DEFAULT_CONFIG.fields.filter((f) => f.rect);
  assert.equal(printed.length, 9);
});

test('요금표 기본값이 기존 RATE와 같다', () => {
  const p = DEFAULT_CONFIG.pricing;
  assert.equal(p.weekday, 35000);
  assert.equal(p.weekend, 40000);
  assert.equal(p.extraPerPersonNight, 5000);
  assert.equal(p.basePeople, 2);
  assert.deepEqual(p.peopleOptions, [2, 3, 4]);
  assert.deepEqual(p.weekendDays, [0, 5, 6]); // 일·금·토
});

test('clone은 원본을 공유하지 않는 깊은 복사본을 만든다', () => {
  const copy = clone(DEFAULT_CONFIG);
  copy.fields[0].rect.x = 999;
  copy.pricing.weekday = 1;
  assert.notEqual(DEFAULT_CONFIG.fields[0].rect.x, 999);
  assert.equal(DEFAULT_CONFIG.pricing.weekday, 35000);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test config.test.mjs`
Expected: FAIL — `Cannot find module './config.js'`

- [ ] **Step 3: `config.js` 작성**

`rect` 값은 `draw.html:173-183`의 `CELLS`를 그대로 옮긴 것이다. 나머지 값의 출처는 각 주석에 적었다.

```js
// 설정의 단일 진실. config.json이 없거나 깨졌을 때 여기로 복귀하므로,
// 이 값은 항상 "지금 실제로 쓰이는 서식"과 일치해야 한다.
export const DEFAULT_CONFIG = {
  version: 1,

  site: { org: '원흥LH13단지주거복지지원센터', title: '게스트하우스 신청서' },

  form: { image: 'form.jpg', width: 707, height: 1000 },

  // 순서가 곧 화면 배치 순서다. packRows()가 이 순서대로 줄을 묶는다.
  fields: [
    { id: 'applyDate', label: '신청일', input: 'date', width: 'half',
      rect: { x: 231, y: 198, w: 403, h: 26 },
      required: true, visible: true, defaultToday: true, clearable: false },

    { id: 'deposit', label: '은행입금일', input: 'date', width: 'half',
      rect: { x: 232, y: 454, w: 138, h: 34 },
      required: false, visible: true, defaultToday: true, clearable: true },

    { id: 'name', label: '성명', input: 'text', width: 'full',
      rect: { x: 231, y: 228, w: 403, h: 25 },
      required: true, visible: true, remember: true,
      placeholder: '이름을 입력하세요', maxlength: 20 },

    { id: 'unit', label: '동·호수', input: 'text', width: 'half',
      rect: { x: 231, y: 257, w: 403, h: 26 },
      required: true, visible: true, remember: true,
      placeholder: '예: 101동 1201호', maxlength: 20 },

    { id: 'phone', label: '연락처', input: 'phone', width: 'half',
      rect: { x: 231, y: 287, w: 403, h: 25 },
      required: true, visible: true, remember: true,
      placeholder: '010-0000-0000', maxlength: 20 },

    // 입실일·퇴실일은 서식에 직접 찍히지 않는다. 둘을 합쳐 period로 출력된다.
    { id: 'checkIn', label: '입실일', input: 'date', width: 'half',
      rect: null, required: true, visible: true, system: true, clearable: true },

    { id: 'checkOut', label: '퇴실일', input: 'date', width: 'half',
      rect: null, required: true, visible: true, system: true, clearable: true },

    // input: null = 입력칸 없이 계산 결과로만 출력되는 항목.
    { id: 'period', label: '사용기간', input: null, width: 'full',
      rect: { x: 232, y: 323, w: 138, h: 28 }, visible: true, system: true },

    { id: 'nights', label: '숙박일수', input: null, width: 'half',
      rect: { x: 487, y: 323, w: 147, h: 28 }, visible: true, system: true },

    { id: 'people', label: '사용인원', input: 'choice', width: 'half',
      rect: { x: 487, y: 355, w: 147, h: 29 }, visible: true, system: true },

    { id: 'holiday', label: '공휴일 요금 적용', input: 'toggle', width: 'full',
      rect: null, visible: true, system: true },

    { id: 'amount', label: '사용금액', input: 'money', width: 'full',
      rect: { x: 232, y: 355, w: 138, h: 29 }, visible: true, system: true },
  ],

  pricing: {
    weekday: 35000,
    weekend: 40000,
    weekendDays: [0, 5, 6], // getDay() 기준: 0=일, 5=금, 6=토
    extraPerPersonNight: 5000,
    basePeople: 2,
    peopleOptions: [2, 3, 4],
    maxNights: 5,
    maxNightsText: '운영규정상 1세대가 한 달 기준 5박 이상 사용할 수 없습니다.',
  },

  account: {
    bank: '국민은행',
    number: '856901-00-129046',
    holder: '원흥LH13단지주거복지지원센터',
  },
};

// structuredClone은 Safari 15.4+ 전용이라 쓰지 않는다. 설정은 순수 JSON 값만
// 담으므로 이 방식으로 충분하다.
export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// 사각형을 canvas fillText용 중심 좌표로 바꾼다. draw.html은 사각형을 그대로 쓰고
// index.html은 이 변환 결과를 쓴다 — 좌표의 진실은 사각형 하나뿐이다.
export function rectToPoint(rect) {
  return {
    x: Math.round(rect.x + rect.w / 2),
    y: Math.round(rect.y + rect.h / 2),
    maxWidth: rect.w - 2, // 좌우 1px 안쪽 여백
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test config.test.mjs`
Expected: PASS (4개 테스트)

- [ ] **Step 5: 커밋**

```bash
git add config.js config.test.mjs
git commit -F - <<'EOF'
feat: 설정 기본값과 좌표 변환 함수 추가

Why:
- 서식 좌표·요금표·계좌가 index.html과 draw.html에 각각 하드코딩되어 있어
  값이 바뀔 때마다 두 파일을 따로 고쳐야 했다.
- 설정 기반으로 옮기기 전에, 기본값이 현재 동작과 정확히 같다는 것을
  먼저 테스트로 고정해야 리팩터가 안전하다.

What:
- DEFAULT_CONFIG에 현재 하드코딩된 값 전부를 옮김
- rectToPoint()로 draw.html의 사각형에서 index.html의 중심점을 유도
- 변환 결과가 기존 POS 9개와 일치하는지 검증하는 테스트 추가
EOF
```

---

### Task 2: `config.js` 검증과 정규화

관리자가 저장한 `config.json`은 신뢰할 수 없는 입력이다. 깨져도 사이트가 죽지 않아야 한다.

**Files:**
- Modify: `config.js`
- Test: `config.test.mjs`

**Interfaces:**
- Consumes: `DEFAULT_CONFIG`, `clone` (Task 1)
- Produces:
  - `normalizeConfig(raw)` → 항상 유효한 설정 객체
  - `parseConfig(text)` → JSON 문자열을 파싱해 정규화. 실패 시 기본값
  - `loadConfig(url?)` → `Promise<config>`. fetch 실패 시 기본값

- [ ] **Step 1: 실패하는 테스트 작성**

`config.test.mjs` 아래에 이어 붙인다. import 줄도 함께 수정한다.

```js
import { DEFAULT_CONFIG, rectToPoint, clone, normalizeConfig, parseConfig } from './config.js';
```

```js
test('입력이 없거나 객체가 아니면 기본값을 돌려준다', () => {
  for (const bad of [null, undefined, 'x', 42, []]) {
    assert.deepEqual(normalizeConfig(bad), DEFAULT_CONFIG);
  }
});

test('깨진 JSON 문자열은 기본값으로 복귀한다', () => {
  assert.deepEqual(parseConfig('{ 이건 JSON이 아니다'), DEFAULT_CONFIG);
  assert.deepEqual(parseConfig(''), DEFAULT_CONFIG);
});

test('일부 키만 있으면 나머지는 기본값으로 채운다', () => {
  const result = normalizeConfig({ account: { bank: '신한은행', number: '110-1', holder: '홍길동' } });
  assert.equal(result.account.bank, '신한은행');
  assert.equal(result.pricing.weekday, 35000);      // 손대지 않은 부분은 기본값
  assert.equal(result.fields.length, DEFAULT_CONFIG.fields.length);
});

test('rect가 이미지 범위를 벗어나면 범위 안으로 보정한다', () => {
  const result = normalizeConfig({
    form: { image: 'form.jpg', width: 707, height: 1000 },
    fields: [{ id: 'name', label: '성명', input: 'text', rect: { x: -50, y: 990, w: 5000, h: 5000 } }],
  });
  const rect = result.fields[0].rect;
  assert.ok(rect.x >= 0 && rect.y >= 0);
  assert.ok(rect.x + rect.w <= 707);
  assert.ok(rect.y + rect.h <= 1000);
});

test('입실일·퇴실일은 숨길 수 없다', () => {
  // 숨기면 숙박일수와 금액을 계산할 방법이 사라진다.
  const result = normalizeConfig({
    fields: [
      { id: 'checkIn', label: '입실일', input: 'date', rect: null, visible: false },
      { id: 'checkOut', label: '퇴실일', input: 'date', rect: null, visible: false },
    ],
  });
  assert.equal(result.fields.find((f) => f.id === 'checkIn').visible, true);
  assert.equal(result.fields.find((f) => f.id === 'checkOut').visible, true);
});

test('삭제된 system 항목은 되살린다', () => {
  const result = normalizeConfig({
    fields: [{ id: 'name', label: '성명', input: 'text', rect: null }],
  });
  for (const id of ['checkIn', 'checkOut', 'period', 'nights', 'people', 'holiday', 'amount']) {
    assert.ok(result.fields.some((f) => f.id === id), `${id}가 복구되지 않았다`);
  }
});

test('알 수 없는 input 유형은 text로 대체한다', () => {
  const result = normalizeConfig({
    fields: [{ id: 'memo', label: '메모', input: 'rocket', rect: null }],
  });
  assert.equal(result.fields.find((f) => f.id === 'memo').input, 'text');
});

test('printed가 없으면 true로 취급하고, false면 출력 대상에서 빠진다', () => {
  const result = normalizeConfig({
    fields: [
      { id: 'name', label: '성명', input: 'text', rect: { x: 10, y: 10, w: 100, h: 20 } },
      { id: 'unit', label: '동·호수', input: 'text', rect: { x: 10, y: 40, w: 100, h: 20 }, printed: false },
    ],
  });
  assert.equal(result.fields.find((f) => f.id === 'name').printed, true);
  const unit = result.fields.find((f) => f.id === 'unit');
  assert.equal(unit.printed, false);
  assert.ok(unit.rect, 'printed:false여도 좌표는 보관해야 한다');
});

test('peopleOptions가 비었거나 숫자가 아니면 기본값으로 복귀한다', () => {
  assert.deepEqual(normalizeConfig({ pricing: { peopleOptions: [] } }).pricing.peopleOptions, [2, 3, 4]);
  assert.deepEqual(normalizeConfig({ pricing: { peopleOptions: ['둘'] } }).pricing.peopleOptions, [2, 3, 4]);
});

test('요금이 음수거나 숫자가 아니면 기본값으로 복귀한다', () => {
  const result = normalizeConfig({ pricing: { weekday: -1, weekend: 'x', extraPerPersonNight: 7000 } });
  assert.equal(result.pricing.weekday, 35000);
  assert.equal(result.pricing.weekend, 40000);
  assert.equal(result.pricing.extraPerPersonNight, 7000); // 유효한 값은 살린다
});

test('정규화 결과는 원본 기본값을 오염시키지 않는다', () => {
  const result = normalizeConfig({ pricing: { weekday: 99000 } });
  result.fields[0].label = '바뀐 라벨';
  assert.equal(DEFAULT_CONFIG.pricing.weekday, 35000);
  assert.equal(DEFAULT_CONFIG.fields[0].label, '신청일');
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test config.test.mjs`
Expected: FAIL — `normalizeConfig is not a function`

- [ ] **Step 3: 정규화 구현**

`config.js` 끝에 추가한다.

```js
const INPUT_TYPES = new Set(['text', 'date', 'phone', 'choice', 'toggle', 'money']);

// 요금 계산에 물려 있어 삭제할 수 없는 항목.
const SYSTEM_IDS = ['checkIn', 'checkOut', 'period', 'nights', 'people', 'holiday', 'amount'];

// 숨기면 숙박일수·금액 계산이 불가능해지는 항목. 유일한 예외다.
const ALWAYS_VISIBLE_IDS = ['checkIn', 'checkOut'];

function positiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonEmptyString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function normalizeForm(raw) {
  const base = DEFAULT_CONFIG.form;
  if (!raw || typeof raw !== 'object') return clone(base);
  return {
    image: nonEmptyString(raw.image, base.image),
    width: Math.round(positiveNumber(raw.width, base.width)),
    height: Math.round(positiveNumber(raw.height, base.height)),
  };
}

// 좌표를 이미지 범위 안으로 밀어 넣는다. 관리자가 이미지를 작은 것으로
// 교체했을 때 옛 좌표가 그대로 남아 캔버스 밖에 찍히는 것을 막는다.
function normalizeRect(raw, form) {
  if (!raw || typeof raw !== 'object') return null;
  const nums = [raw.x, raw.y, raw.w, raw.h];
  if (!nums.every((n) => Number.isFinite(n))) return null;

  const x = Math.min(Math.max(0, raw.x), form.width - 1);
  const y = Math.min(Math.max(0, raw.y), form.height - 1);
  const w = Math.min(Math.max(1, raw.w), form.width - x);
  const h = Math.min(Math.max(1, raw.h), form.height - y);
  return { x, y, w, h };
}

function normalizeField(raw, form, fallback) {
  const base = fallback || {};
  const input = raw.input === null ? null
    : INPUT_TYPES.has(raw.input) ? raw.input
    : base.input !== undefined ? base.input
    : 'text';

  const field = {
    id: raw.id,
    label: nonEmptyString(raw.label, base.label || raw.id),
    input,
    width: raw.width === 'full' || raw.width === 'half' ? raw.width : (base.width || 'full'),
    rect: normalizeRect(raw.rect, form),
    printed: raw.printed !== false,
    visible: raw.visible !== false,
    required: raw.required === true,
  };

  if (SYSTEM_IDS.includes(field.id)) field.system = true;
  if (ALWAYS_VISIBLE_IDS.includes(field.id)) field.visible = true;

  // 입력 유형별 선택 속성. 해당 없는 유형에는 붙이지 않는다.
  if (field.input === 'text' || field.input === 'phone') {
    if (raw.placeholder !== undefined || base.placeholder !== undefined) {
      field.placeholder = nonEmptyString(raw.placeholder, base.placeholder || '');
    }
    field.maxlength = Math.round(positiveNumber(raw.maxlength, base.maxlength || 20));
  }
  if (field.input === 'date') {
    field.clearable = raw.clearable !== undefined ? raw.clearable === true : base.clearable === true;
    field.defaultToday = raw.defaultToday !== undefined
      ? raw.defaultToday === true
      : base.defaultToday === true;
  }
  if (raw.remember !== undefined ? raw.remember === true : base.remember === true) {
    field.remember = true;
  }

  return field;
}

function normalizeFields(raw, form) {
  const defaults = new Map(DEFAULT_CONFIG.fields.map((f) => [f.id, f]));
  const seen = new Set();
  const fields = [];

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      if (typeof item.id !== 'string' || !item.id.trim()) continue;
      if (seen.has(item.id)) continue; // 중복 id는 첫 번째만 살린다
      seen.add(item.id);
      fields.push(normalizeField(item, form, defaults.get(item.id)));
    }
  }

  // 삭제된 system 항목을 원래 자리 순서대로 되살린다.
  for (const id of SYSTEM_IDS) {
    if (seen.has(id)) continue;
    const index = DEFAULT_CONFIG.fields.findIndex((f) => f.id === id);
    fields.splice(Math.min(index, fields.length), 0, normalizeField(clone(defaults.get(id)), form, defaults.get(id)));
  }

  return fields.length ? fields : clone(DEFAULT_CONFIG.fields);
}

function normalizePricing(raw) {
  const base = DEFAULT_CONFIG.pricing;
  if (!raw || typeof raw !== 'object') return clone(base);

  const days = Array.isArray(raw.weekendDays)
    ? raw.weekendDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : [];
  const people = Array.isArray(raw.peopleOptions)
    ? raw.peopleOptions.filter((n) => Number.isInteger(n) && n > 0)
    : [];

  return {
    weekday: positiveNumber(raw.weekday, base.weekday),
    weekend: positiveNumber(raw.weekend, base.weekend),
    weekendDays: days.length ? [...new Set(days)].sort() : clone(base.weekendDays),
    // 추가 인원 요금만은 0이 유효한 값이다(추가 요금 없음).
    extraPerPersonNight: Number.isFinite(raw.extraPerPersonNight) && raw.extraPerPersonNight >= 0
      ? raw.extraPerPersonNight
      : base.extraPerPersonNight,
    basePeople: Math.round(positiveNumber(raw.basePeople, base.basePeople)),
    peopleOptions: people.length ? [...new Set(people)].sort((a, b) => a - b) : clone(base.peopleOptions),
    maxNights: Math.round(positiveNumber(raw.maxNights, base.maxNights)),
    maxNightsText: nonEmptyString(raw.maxNightsText, base.maxNightsText),
  };
}

function normalizeAccount(raw) {
  const base = DEFAULT_CONFIG.account;
  if (!raw || typeof raw !== 'object') return clone(base);
  return {
    bank: nonEmptyString(raw.bank, base.bank),
    number: nonEmptyString(raw.number, base.number),
    holder: nonEmptyString(raw.holder, base.holder),
  };
}

function normalizeSite(raw) {
  const base = DEFAULT_CONFIG.site;
  if (!raw || typeof raw !== 'object') return clone(base);
  return {
    org: nonEmptyString(raw.org, base.org),
    title: nonEmptyString(raw.title, base.title),
  };
}

// 어떤 입력이 들어와도 항상 쓸 수 있는 설정을 돌려준다. 이 함수가 사이트를
// 죽지 않게 하는 유일한 방어선이다.
export function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clone(DEFAULT_CONFIG);
  const form = normalizeForm(raw.form);
  return {
    version: 1,
    site: normalizeSite(raw.site),
    form,
    fields: normalizeFields(raw.fields, form),
    pricing: normalizePricing(raw.pricing),
    account: normalizeAccount(raw.account),
  };
}

export function parseConfig(text) {
  try {
    return normalizeConfig(JSON.parse(text));
  } catch {
    return clone(DEFAULT_CONFIG);
  }
}

// 브라우저 전용. no-cache는 ETag 재검증을 쓴다 — 안 바뀌었으면 304로 끝나고
// 바뀌었으면 즉시 새 값을 받는다. GitHub Pages의 기본 10분 캐시를 안 기다린다.
export function loadConfig(url = 'config.json') {
  return fetch(url, { cache: 'no-cache' })
    .then((res) => {
      if (!res.ok) throw new Error(`config.json ${res.status}`);
      return res.json();
    })
    .then(normalizeConfig)
    .catch(() => clone(DEFAULT_CONFIG));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test config.test.mjs`
Expected: PASS (15개 테스트)

`normalizeConfig(bad)`가 `DEFAULT_CONFIG`와 `deepEqual`이어야 하므로, `DEFAULT_CONFIG`의 각 항목이 `normalizeField`가 만드는 속성 집합과 정확히 일치해야 한다. 불일치하면 `DEFAULT_CONFIG` 쪽을 고친다 — 정규화 결과가 기준이다.

- [ ] **Step 5: 커밋**

```bash
git add config.js config.test.mjs
git commit -F - <<'EOF'
feat: 설정 검증·정규화 추가

Why:
- config.json은 관리자가 브라우저에서 쓰는 파일이라 신뢰할 수 없는 입력이다.
  깨진 값 하나로 주민들 신청서 화면이 죽으면 안 된다.

What:
- normalizeConfig()가 어떤 입력에도 항상 쓸 수 있는 설정을 반환
- 좌표를 이미지 범위 안으로 보정, 알 수 없는 입력 유형은 text로 대체
- 삭제된 system 항목(입실일·퇴실일·사용기간·숙박일수·인원·공휴일·금액) 자동 복구
- 입실일·퇴실일은 숨길 수 없도록 강제 (숨기면 요금 계산이 불가능)
- loadConfig()는 fetch 실패 시 내장 기본값으로 복귀
EOF
```

---

### Task 3: 배치 규칙과 대상 필터

`index.html`과 `draw.html`이 서로 다른 부분집합을 같은 규칙으로 배치한다. 순수 함수라 테스트로 현재 레이아웃을 고정할 수 있다.

**Files:**
- Modify: `config.js`
- Test: `config.test.mjs`

**Interfaces:**
- Consumes: `normalizeConfig` (Task 2)
- Produces:
  - `formFields(config)` → 화면 입력칸이 있는 항목 배열 (`visible`이고 `input !== null`)
  - `printedCells(config)` → 서식에 찍히는 항목 배열 (`rect`가 있고 `printed !== false`)
  - `packRows(fields)` → `Array<Array<field>>`. 각 배열이 한 줄

- [ ] **Step 1: 실패하는 테스트 작성**

import 줄에 `formFields, printedCells, packRows`를 추가하고 아래를 이어 붙인다.

```js
const ids = (rows) => rows.map((row) => row.map((f) => f.id));

test('index.html 배치가 현재와 같다', () => {
  const rows = ids(packRows(formFields(DEFAULT_CONFIG)));
  assert.deepEqual(rows, [
    ['applyDate', 'deposit'],
    ['name'],
    ['unit', 'phone'],
    ['checkIn', 'checkOut'],
    ['people'],   // half지만 다음이 full(holiday)이라 한 줄 전체로 늘어난다
    ['holiday'],
    ['amount'],
  ]);
});

test('draw.html 배치가 현재와 같다', () => {
  const rows = ids(packRows(printedCells(DEFAULT_CONFIG)));
  assert.deepEqual(rows, [
    ['applyDate', 'deposit'],
    ['name'],
    ['unit', 'phone'],
    ['period'],
    ['nights', 'people'],
    ['amount'],
  ]);
});

test('formFields는 계산 전용 항목을 뺀다', () => {
  const list = formFields(DEFAULT_CONFIG).map((f) => f.id);
  assert.ok(!list.includes('period'));
  assert.ok(!list.includes('nights'));
  assert.ok(list.includes('checkIn'));
});

test('printedCells는 rect 없는 항목과 printed:false를 뺀다', () => {
  const list = printedCells(DEFAULT_CONFIG).map((f) => f.id);
  assert.ok(!list.includes('checkIn'));
  assert.ok(!list.includes('holiday'));
  assert.equal(list.length, 9);

  const hidden = normalizeConfig({
    ...clone(DEFAULT_CONFIG),
    fields: clone(DEFAULT_CONFIG.fields).map((f) => (f.id === 'deposit' ? { ...f, printed: false } : f)),
  });
  assert.ok(!printedCells(hidden).map((f) => f.id).includes('deposit'));
});

test('숨긴 항목은 화면에서 빠지고 배치가 다시 계산된다', () => {
  const config = normalizeConfig({
    ...clone(DEFAULT_CONFIG),
    fields: clone(DEFAULT_CONFIG.fields).map((f) => (f.id === 'deposit' ? { ...f, visible: false } : f)),
  });
  const rows = ids(packRows(formFields(config)));
  // 신청일이 홀로 남으면 한 줄 전체를 쓰고, 그 다음부터 짝이 다시 맞는다.
  assert.deepEqual(rows[0], ['applyDate']);
  assert.deepEqual(rows[1], ['name']);
});

test('packRows는 빈 배열에 빈 배열을 돌려준다', () => {
  assert.deepEqual(packRows([]), []);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test config.test.mjs`
Expected: FAIL — `packRows is not a function`

- [ ] **Step 3: 구현**

`config.js`에 추가한다.

```js
// index.html이 그리는 대상: 사람이 값을 입력하는 항목.
export function formFields(config) {
  return config.fields.filter((f) => f.visible !== false && f.input !== null);
}

// draw.html이 그리는 대상: 서식 이미지에 찍히는 칸. 손글씨 페이지는 입실일·퇴실일
// 대신 사용기간을 직접 쓰므로 "입력 항목"이 아니라 "출력 칸" 기준이다.
export function printedCells(config) {
  return config.fields.filter((f) => f.rect && f.printed !== false);
}

// 연속한 half 둘은 한 줄에 나란히, 홀로 남은 half는 한 줄 전체로 늘린다.
// 줄 배열의 길이가 1이면 전체 폭, 2면 2열이라는 뜻이다.
export function packRows(fields) {
  const rows = [];
  for (let i = 0; i < fields.length; i++) {
    const current = fields[i];
    const next = fields[i + 1];
    if (current.width === 'half' && next && next.width === 'half') {
      rows.push([current, next]);
      i++;
    } else {
      rows.push([current]);
    }
  }
  return rows;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test config.test.mjs`
Expected: PASS (21개 테스트)

- [ ] **Step 5: 커밋**

```bash
git add config.js config.test.mjs
git commit -F - <<'EOF'
feat: 화면 배치 규칙과 대상 필터 추가

Why:
- index.html은 입력칸이 있는 항목을, draw.html은 서식에 찍히는 칸을 그린다.
  두 페이지가 그리는 집합이 다르므로 규칙을 코드로 못 박아야 한다.
- 설정 기반으로 바꾸면서 현재 2열 레이아웃이 깨지지 않는다는 보장이 필요하다.

What:
- formFields()/printedCells()로 두 페이지의 대상 집합을 분리
- packRows(): 연속한 half 둘은 한 줄, 홀로 남은 half는 한 줄 전체
- 이 규칙과 기본 설정으로 두 페이지의 현재 배치가 그대로 나오는지 테스트로 고정
EOF
```

---

### Task 4: `calc.js`를 요금표 인자로 받게 바꾸기

**Files:**
- Modify: `calc.js`
- Modify: `calc.test.mjs`

**Interfaces:**
- Consumes: `DEFAULT_CONFIG.pricing` (Task 1)
- Produces:
  - `calcAmount(values, pricing?)` — `pricing` 생략 시 기본 요금표 사용 (기존 호출부 하위 호환)
  - `countNights(checkIn, checkOut)` — 변경 없음

- [ ] **Step 1: 실패하는 테스트 작성**

`calc.test.mjs` 맨 위 import를 바꾸고 아래 테스트를 끝에 추가한다. **기존 테스트 8개는 그대로 둔다** — `pricing`을 생략해도 통과하는 것이 하위 호환의 증거다.

```js
import { countNights, calcAmount } from './calc.js';
import { DEFAULT_CONFIG } from './config.js';
```

```js
test('요금표를 바꾸면 결과가 따라 바뀐다', () => {
  const pricing = { ...DEFAULT_CONFIG.pricing, weekday: 50000 };
  // 2026-07-27(월) ~ 2026-07-29(수): 평일 2박
  assert.equal(
    calcAmount({ checkIn: '2026-07-27', checkOut: '2026-07-29', people: 2, holiday: false }, pricing),
    100000
  );
});

test('주말 요일을 바꾸면 주말 판정이 따라 바뀐다', () => {
  // 토·일만 주말로 두면 2026-07-24(금)은 평일이 된다.
  const pricing = { ...DEFAULT_CONFIG.pricing, weekendDays: [0, 6] };
  // 금(평일 35000) + 토(주말 40000) = 75000
  assert.equal(
    calcAmount({ checkIn: '2026-07-24', checkOut: '2026-07-26', people: 2, holiday: false }, pricing),
    75000
  );
});

test('기준 인원과 추가 요금을 바꾸면 결과가 따라 바뀐다', () => {
  const pricing = { ...DEFAULT_CONFIG.pricing, basePeople: 3, extraPerPersonNight: 10000 };
  // 2026-07-27(월)~07-29(수) 평일 2박, 4인 → (35000 + 10000) x 2
  assert.equal(
    calcAmount({ checkIn: '2026-07-27', checkOut: '2026-07-29', people: 4, holiday: false }, pricing),
    90000
  );
});

test('pricing을 생략하면 기본 요금표를 쓴다', () => {
  const withDefault = calcAmount({ checkIn: '2026-07-27', checkOut: '2026-07-29', people: 2, holiday: false });
  const explicit = calcAmount(
    { checkIn: '2026-07-27', checkOut: '2026-07-29', people: 2, holiday: false },
    DEFAULT_CONFIG.pricing
  );
  assert.equal(withDefault, explicit);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test calc.test.mjs`
Expected: FAIL — 요금표를 바꿔도 결과가 70000으로 나온다 (인자를 무시하므로)

- [ ] **Step 3: `calc.js` 수정**

`RATE` 상수를 지우고 `DEFAULT_CONFIG.pricing`을 기본 인자로 쓴다. `countNights`와 `parseDate`는 손대지 않는다.

```js
import { DEFAULT_CONFIG } from './config.js';
```

`calcAmount`를 아래로 교체한다.

```js
export function calcAmount({ checkIn, checkOut, people, holiday }, pricing = DEFAULT_CONFIG.pricing) {
  const nights = countNights(checkIn, checkOut);
  if (nights === 0) return 0;

  const start = parseDate(checkIn);
  const extra = Math.max(0, people - pricing.basePeople) * pricing.extraPerPersonNight;

  let total = 0;
  for (let i = 0; i < nights; i++) {
    const night = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const isWeekend = pricing.weekendDays.includes(night.getDay());
    total += (holiday || isWeekend) ? pricing.weekend : pricing.weekday;
    total += extra;
  }
  return total;
}
```

기존 `export const RATE = {...}` 블록을 삭제한다. `index.html`은 `RATE`를 import하지 않으므로 다른 곳을 고칠 필요가 없다 — 확인: `grep -n "RATE" *.html *.js`.

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test calc.test.mjs config.test.mjs`
Expected: PASS — 기존 8개 + 신규 4개 + config 21개

- [ ] **Step 5: 커밋**

```bash
git add calc.js calc.test.mjs
git commit -F - <<'EOF'
feat: 요금 계산이 요금표를 인자로 받도록 변경

Why:
- 요금이 인상되거나 주말 기준이 바뀌면 지금은 calc.js를 고쳐야 한다.
  관리자가 화면에서 바꿀 수 있으려면 요금표가 데이터여야 한다.

What:
- RATE 상수를 제거하고 calcAmount(values, pricing)로 변경
- pricing 생략 시 DEFAULT_CONFIG.pricing을 쓰므로 기존 호출부는 그대로 동작
- 주말 판정을 pricing.weekendDays로 일반화 (기존 금·토·일 하드코딩 제거)
EOF
```

---

### Task 5: `index.html`을 설정 기반으로 전환

가장 조심스러운 작업이다. 이 단계가 끝나면 **`config.json` 없이도 현재와 똑같이 동작**해야 한다.

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `loadConfig`, `formFields`, `printedCells`, `packRows`, `rectToPoint`, `DEFAULT_CONFIG` (Task 1-3), `calcAmount(values, pricing)` (Task 4)
- Produces: 없음 (최종 소비자)

- [ ] **Step 1: 폼 생성 함수 추가**

`<form id="form">` 안의 손으로 쓴 입력칸 HTML(현재 `index.html:119-186`)을 전부 지우고 빈 `<form id="form" autocomplete="on"></form>`만 남긴다. `<p id="summary">`와 `<p id="warning">`은 폼 밖 카드 안으로 옮겨 그대로 둔다.

`<script type="module">` 안에 아래를 추가한다. 각 입력 유형이 만드는 마크업은 현재 HTML과 클래스까지 동일해야 CSS를 건드리지 않는다.

```js
function el(tag, className, props) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  Object.assign(node, props || {});
  return node;
}

function buildInput(field) {
  const wrap = el('div', 'field');
  const label = el('label', null, { htmlFor: field.id, textContent: field.label });
  wrap.appendChild(label);

  if (field.input === 'date') {
    wrap.appendChild(el('input', 'date-in', {
      type: 'text', id: field.id, readOnly: true, placeholder: '날짜 선택',
    }));
  } else if (field.input === 'text' || field.input === 'phone') {
    wrap.appendChild(el('input', null, {
      type: field.input === 'phone' ? 'tel' : 'text',
      id: field.id,
      placeholder: field.placeholder || '',
      maxLength: field.maxlength || 20,
    }));
  } else if (field.input === 'choice') {
    const row = el('div', 'guest-row', { id: 'guestRow' });
    config.pricing.peopleOptions.forEach((n, i) => {
      const btn = el('button', `guest-btn${i === 0 ? ' active' : ''}`, {
        type: 'button', textContent: `${n}명`,
      });
      btn.dataset.n = String(n);
      row.appendChild(btn);
    });
    wrap.appendChild(row);
    wrap.appendChild(el('input', null, {
      type: 'hidden', id: field.id, value: String(config.pricing.peopleOptions[0]),
    }));
  } else if (field.input === 'money') {
    const money = el('div', 'amount-wrap');
    money.appendChild(el('input', null, {
      type: 'text', id: field.id, inputMode: 'numeric', placeholder: '자동 계산',
    }));
    money.appendChild(el('span', null, { textContent: '원' }));
    wrap.appendChild(money);
  }
  return wrap;
}

// 공휴일 토글은 label 자체가 행이라 .field로 감싸지 않는다(현재 마크업과 동일).
function buildToggle(field) {
  const row = el('label', 'toggle-row', { id: 'holidayRow', htmlFor: field.id });
  row.appendChild(el('input', 'visually-hidden', { type: 'checkbox', id: field.id }));
  const text = el('div');
  text.appendChild(el('div', 'toggle-title', { textContent: field.label }));
  // 문구를 저장하지 않고 요금에서 만든다. 주말 요금을 올리면 설명도 같이 바뀐다.
  text.appendChild(el('div', 'toggle-sub', {
    textContent: `전 기간 ${config.pricing.weekend.toLocaleString('ko-KR')}원`,
  }));
  row.appendChild(text);
  const sw = el('div', 'switch', { id: 'holidaySwitch' });
  sw.appendChild(el('div', 'thumb'));
  row.appendChild(sw);
  return row;
}

function buildForm() {
  const form = $('form');
  form.textContent = '';
  for (const row of packRows(formFields(config))) {
    const nodes = row.map((f) => (f.input === 'toggle' ? buildToggle(f) : buildInput(f)));
    if (row.length === 2) {
      const grid = el('div', 'row2');
      nodes.forEach((n) => grid.appendChild(n));
      form.appendChild(grid);
    } else {
      form.appendChild(nodes[0]);
    }
    // 금액 칸 바로 뒤에 "자동 계산으로 되돌리기" 버튼을 둔다.
    if (row.length === 1 && row[0].input === 'money') {
      form.appendChild(el('button', 'link-btn', {
        type: 'button', id: 'resetAmount', hidden: true, textContent: '자동 계산으로 되돌리기',
      }));
    }
  }
}
```

- [ ] **Step 2: 하드코딩 상수를 설정에서 유도하도록 교체**

`POS`, `REQUIRED`, `SAVED_FIELDS`, `CLEARABLE`, `ACCOUNT_NUMBER` 선언을 삭제하고 아래로 대체한다.

```js
// 모든 파생 값은 설정에서 만든다. 설정이 바뀌면 buildDerived()를 다시 부른다.
let POS = {};
let REQUIRED = {};
let SAVED_FIELDS = [];
let CLEARABLE = new Set();
let DATE_FIELDS = [];
let ACCOUNT_TEXT = '';

function buildDerived() {
  POS = {};
  for (const field of printedCells(config)) POS[field.id] = rectToPoint(field.rect);

  REQUIRED = {};
  for (const field of formFields(config)) if (field.required) REQUIRED[field.id] = field.label;

  SAVED_FIELDS = formFields(config).filter((f) => f.remember).map((f) => f.id);
  CLEARABLE = new Set(formFields(config).filter((f) => f.clearable).map((f) => f.id));
  DATE_FIELDS = formFields(config).filter((f) => f.input === 'date').map((f) => f.id);

  // 토스·카카오페이의 붙여넣기가 은행과 계좌번호를 함께 인식하도록 은행명을 붙인다.
  ACCOUNT_TEXT = `${config.account.bank} ${config.account.number}`;
}
```

`$('copyAccount')` 리스너의 `ACCOUNT_NUMBER`를 `ACCOUNT_TEXT`로 바꾼다. 달력 리스너를 붙이는 `for (const id of ['applyDate', 'deposit', 'checkIn', 'checkOut'])`를 `for (const id of DATE_FIELDS)`로 바꾼다.

- [ ] **Step 3: `readValues`·`formatValues`를 설정 기반으로 교체**

고정 키 목록 대신 `formFields`를 훑는다. 계산 항목(`period`·`nights`)은 지금처럼 코드가 만든다.

```js
function readValues() {
  const values = {};
  for (const field of formFields(config)) {
    const node = $(field.id);
    if (!node) continue;
    if (field.input === 'toggle') values[field.id] = node.checked;
    else if (field.input === 'choice') values[field.id] = Number(node.value);
    else if (field.input === 'money') {
      values[field.id] = Number(node.value.replace(/[^0-9]/g, ''));
      values.amountEntered = /[0-9]/.test(node.value);
    } else values[field.id] = node.value.trim();
  }
  return values;
}

function formatValues(v, nights) {
  const out = {};
  for (const field of printedCells(config)) {
    const id = field.id;
    if (id === 'period') {
      out.period = v.checkIn && v.checkOut ? shortDate(v.checkIn, v.checkOut) : '';
    } else if (id === 'nights') {
      out.nights = nights ? `${nights}일` : '';
    } else if (field.input === 'money') {
      out[id] = v.amountEntered ? `${v[id].toLocaleString('ko-KR')}원` : '';
    } else if (field.input === 'choice') {
      out[id] = v[id] ? `${v[id]}명` : '';
    } else if (field.input === 'date') {
      out[id] = v[id] ? compactDate(v[id]) : '';
    } else {
      out[id] = v[id] || '';
    }
  }
  return out;
}
```

`render()`에서 `calcAmount(v)` 호출을 `calcAmount(v, config.pricing)`으로, 5박 경고 조건 `nights >= 5`를 `nights >= config.pricing.maxNights`로, 경고 문구를 `config.pricing.maxNightsText`로 바꾼다. 금액 관련 코드가 참조하는 `$('amount')`는 `money` 유형 필드의 id로 찾는다.

```js
const moneyField = config.fields.find((f) => f.input === 'money');
const choiceField = config.fields.find((f) => f.input === 'choice');
const toggleField = config.fields.find((f) => f.input === 'toggle');
```

- [ ] **Step 4: 캔버스·머리말·계좌 표시를 설정에서 채우기**

`drawForm`의 폰트 크기 시작값 14는 그대로 두되 캔버스 크기와 이미지 경로를 설정에서 가져온다.

```js
canvas.width = config.form.width;
canvas.height = config.form.height;
formImage.src = config.form.image;

document.querySelector('.eyebrow').textContent = config.site.org;
document.querySelector('h1').textContent = config.site.title;
document.title = config.site.title;
document.querySelector('.account .num').textContent = `${config.account.bank} ${config.account.number}`;
document.querySelector('.account .name').textContent = config.account.holder;
```

- [ ] **Step 5: 부팅 순서 정리 (최상위 `await` 금지)**

스크립트 최하단의 초기화를 아래로 교체한다. `config`는 모듈 스코프의 `let`이다.

```js
let config = clone(DEFAULT_CONFIG);

// 미리보기 모드: admin.html이 sessionStorage에 넣어둔 편집 중인 설정을 우선 쓴다.
function previewConfig() {
  if (!new URLSearchParams(location.search).has('preview')) return null;
  try {
    const raw = sessionStorage.getItem('guesthouse-config-preview');
    return raw ? normalizeConfig(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function boot(loaded) {
  config = loaded;
  buildDerived();
  buildForm();
  applySiteTexts();   // Step 4의 머리말·계좌 표시
  attachFieldListeners(); // 달력·전화 하이픈·인원 버튼·공휴일·금액 리스너를 붙인다
  restoreSaved();
  setTodayDefaults();     // defaultToday인 날짜 칸에 오늘을 넣는다
  render();
  imageReady.then(render).catch(() => { syncButtons(); });
}

const preview = previewConfig();
if (preview) {
  boot(preview);
} else {
  loadConfig().then(boot);
}
```

**중요:** 폼이 동적으로 생성되므로 `$('form')`·`$('amount')` 등에 리스너를 붙이는 코드는 전부 `buildForm()` 이후에 실행되어야 한다. 현재 스크립트 상단에 흩어져 있는 리스너 등록을 `attachFieldListeners()` 하나로 모은다. `imageReady` Promise와 `formImage.src` 지정만 `boot()` 안으로 옮긴다.

- [ ] **Step 6: 수동 확인**

```bash
python -m http.server 8000
```

`http://localhost:8000/index.html`을 열고 확인한다 (`config.json`은 아직 없다 — 기본값 경로를 검증하는 것이 목적이다).

- 입력칸 배치가 리팩터 전과 같은가: [신청일·은행입금일] [성명] [동호수·연락처] [입실일·퇴실일] [사용인원] [공휴일] [사용금액]
- 날짜 칸을 누르면 달력 팝오버가 열리는가. 신청일에는 "지우기"가 없고 나머지 셋에는 있는가
- 연락처에 `01012345678`을 넣으면 `010-1234-5678`이 되는가
- 입실일·퇴실일·인원을 고르면 금액이 자동 계산되는가. 금액을 직접 고치면 "자동 계산으로 되돌리기"가 나오는가
- 캔버스 미리보기의 글자 위치가 리팩터 전과 같은가 (git stash로 이전 버전과 나란히 비교)
- 계좌번호 복사가 `국민은행 856901-00-129046`을 복사하는가
- 새로고침해도 성명·동호수·연락처가 남아 있는가. "저장정보 초기화"로 지워지는가

- [ ] **Step 7: 커밋**

```bash
git add index.html
git commit -F - <<'EOF'
feat: 신청서 화면을 설정 기반으로 전환

Why:
- 입력 항목·좌표·계좌·요금 경고가 HTML과 스크립트에 하드코딩되어 있어
  관리자가 바꿀 수 없었다.

What:
- 폼 입력칸을 config.fields에서 생성 (packRows로 기존 2열 배치 재현)
- POS/REQUIRED/SAVED_FIELDS/CLEARABLE/ACCOUNT_NUMBER 상수를 설정에서 유도
- 캔버스 크기·서식 이미지 경로·머리말·계좌 표시를 설정에서 채움
- ?preview=1이면 sessionStorage의 편집 중인 설정을 우선 사용 (관리자 미리보기용)
- config.json이 없으면 내장 기본값으로 동작하므로 현재와 동일하게 작동
EOF
```

---

### Task 6: `draw.html`을 설정 기반으로 전환

**Files:**
- Modify: `draw.html`

**Interfaces:**
- Consumes: `loadConfig`, `printedCells`, `packRows`, `clone`, `DEFAULT_CONFIG` (Task 1-3)
- Produces: 없음

`draw.html`의 스크립트는 IIFE + `var` 스타일이다. 설정을 쓰려면 모듈이 필요하므로 `<script>`를 `<script type="module">`로 바꾸고 IIFE 래퍼를 유지한 채 상단에서 import한다. **기존 `var` 스타일과 코드 구조는 그대로 둔다** — 불필요한 재작성은 손글씨 입력의 iOS 대응 코드를 위험에 빠뜨린다.

- [ ] **Step 1: 필드 박스 생성 함수 추가**

손으로 쓴 `.field-box` 9개(`draw.html:90-136`)를 지우고 `<div id="fieldBoxes"></div>`만 남긴다. 도구 모음(`.toolbar`)과 버튼 행(`.btn-row`)은 그대로 둔다.

```js
function buildFieldBoxes() {
  var host = $('fieldBoxes');
  host.textContent = '';
  packRows(printedCells(config)).forEach(function (row) {
    var container = host;
    if (row.length === 2) {
      container = document.createElement('div');
      container.className = 'row2';
      host.appendChild(container);
    }
    row.forEach(function (field) {
      container.appendChild(buildFieldBox(field, row.length === 2));
    });
  });
}

function buildFieldBox(field, isHalf) {
  var box = document.createElement('div');
  // period는 기존에 전용 클래스를 쓰고 있었다. 전체 폭 칸은 wide로 통일한다.
  box.className = 'field-box ' + (isHalf ? 'small' : 'wide');

  var head = document.createElement('div');
  head.className = 'field-head';
  var label = document.createElement('span');
  label.className = 'field-label';
  label.textContent = field.label;
  var clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'field-clear';
  clear.dataset.target = 'c-' + field.id;
  clear.textContent = '지우기';
  head.appendChild(label);
  head.appendChild(clear);

  var wrap = document.createElement('div');
  wrap.className = 'canvas-wrap';
  var canvas = document.createElement('canvas');
  canvas.className = 'board';
  canvas.id = 'c-' + field.id;
  var guide = document.createElement('div');
  guide.className = 'guideline';
  wrap.appendChild(canvas);
  wrap.appendChild(guide);

  box.appendChild(head);
  box.appendChild(wrap);
  return box;
}
```

CSS의 `.field-box.period` 규칙은 `.field-box.wide`와 통합하거나 그대로 두고 쓰지 않는다. 사용기간 칸의 높이가 달라 보이면 `.wide`의 캔버스 높이를 확인한다.

- [ ] **Step 2: `CELLS`를 설정에서 유도**

`var CELLS = {...}` 블록을 삭제하고 대체한다.

```js
var CELLS = {};
function buildCells() {
  CELLS = {};
  printedCells(config).forEach(function (field) { CELLS[field.id] = field.rect; });
}
```

`renderComposite()`의 `b.canvas.id.replace(/^c-/, '')` → `CELLS[key]` 조회는 그대로 동작한다.

- [ ] **Step 3: 707×1000 리터럴 제거**

`compositeCanvas`, `largeCanvas`, 미니 미리보기를 설정 크기로 바꾼다.

```js
var FW = config.form.width;
var FH = config.form.height;

compositeCanvas.width = FW;
compositeCanvas.height = FH;
largeCanvas.width = FW;
largeCanvas.height = FH;

// 미니 미리보기는 서식 비율을 따라간다. 가로로 긴 서식으로 바뀌어도 찌그러지지 않는다.
miniCanvas.width = 84;
miniCanvas.height = Math.round(84 * FH / FW);
```

`renderComposite()` 안의 `clearRect(0, 0, 707, 1000)`과 `drawImage(formImage, 0, 0, 707, 1000)`, `previewLoop()`의 `drawImage(compositeCanvas, 0, 0, 707, 1000, ...)`도 `FW`/`FH`로 바꾼다. `formImage.src = 'form.jpg'`는 `config.form.image`로 바꾼다.

- [ ] **Step 4: 부팅 순서 정리**

`.board` 캔버스가 동적으로 생기므로 `document.querySelectorAll('.board')` 순회와 `.field-clear` 리스너 등록은 `buildFieldBoxes()` 이후여야 한다.

```js
var config = clone(DEFAULT_CONFIG);

function previewConfig() { /* index.html과 동일 */ }

function boot(loaded) {
  config = loaded;
  buildCells();
  buildFieldBoxes();
  setupSizes();          // Step 3의 FW/FH 반영
  document.querySelector('.eyebrow').textContent = config.site.org;
  document.querySelector('h1').textContent = config.site.title;
  initBoards();          // 기존 querySelectorAll('.board') 순회 + attachEvents
  attachClearButtons();  // 기존 .field-clear 위임 리스너
  formImage.src = config.form.image;
  requestAnimationFrame(previewLoop);
}

var preview = previewConfig();
if (preview) { boot(preview); } else { loadConfig().then(boot); }
```

- [ ] **Step 5: 수동 확인**

```bash
python -m http.server 8000
```

`http://localhost:8000/draw.html`에서 확인한다.

- 필드 박스 배치가 리팩터 전과 같은가: [신청일·은행입금일] [성명] [동호수·연락처] [사용기간] [숙박일수·사용인원] [사용금액]
- 각 칸에 손글씨(마우스 드래그)가 그려지는가. "지우기"가 해당 칸만 지우는가
- 미니 미리보기에 글씨가 실시간으로 나타나는가. 탭하면 크게 보이는가
- 합성된 결과에서 글씨가 서식의 올바른 칸에 들어가는가 (리팩터 전과 비교)
- 색·굵기·지우개·전체 지우기가 동작하는가

- [ ] **Step 6: 커밋**

```bash
git add draw.html
git commit -F - <<'EOF'
feat: 손글씨 화면을 설정 기반으로 전환

Why:
- 서식 칸 좌표(CELLS)와 필드 박스 HTML이 draw.html에 따로 하드코딩되어 있어
  index.html과 이중 관리되고 있었다.

What:
- 손글씨 캔버스를 서식에 찍히는 칸(printedCells)에서 생성
- CELLS를 config.fields[].rect에서 유도해 index.html과 좌표를 공유
- 707x1000 리터럴을 config.form.width/height로 교체
- 미니 미리보기 높이를 서식 비율로 계산 (가로로 긴 서식에서 찌그러지던 문제)
- 손글씨 입력·iOS 대응 코드는 손대지 않음
EOF
```

---

### Task 7: `github.js` — GitHub API 래퍼

**Files:**
- Create: `github.js`
- Test: `github.test.mjs`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `toBase64(text)` / `fromBase64(b64)` — UTF-8 안전 변환
  - `commitMessage(now)` → `'chore: 관리자 설정 변경 (2026-07-28 15:30)'`
  - `imageFileName(now)` → `'form-20260728-1530.jpg'`
  - `createClient({ repo, token })` → `{ getFile, putFile, listCommits, getCommitContent }`

- [ ] **Step 1: 실패하는 테스트 작성**

`github.test.mjs`를 만든다. 네트워크가 필요한 부분은 테스트하지 않는다 — 순수 함수만 검증한다.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBase64, fromBase64, commitMessage, imageFileName } from './github.js';

test('한글이 든 문자열을 base64로 왕복해도 깨지지 않는다', () => {
  // btoa()는 비ASCII에서 InvalidCharacterError를 던진다. 계좌 예금주와
  // 경고 문구가 전부 한글이므로 이 변환이 틀리면 저장 자체가 실패한다.
  const text = JSON.stringify({ holder: '원흥LH13단지주거복지지원센터', note: '5박 이상 ×' });
  assert.equal(fromBase64(toBase64(text)), text);
});

test('GitHub이 돌려주는 줄바꿈 섞인 base64도 디코딩한다', () => {
  const text = '가나다라마바사아자차카타파하';
  const encoded = toBase64(text);
  const wrapped = encoded.match(/.{1,10}/g).join('\n');
  assert.equal(fromBase64(wrapped), text);
});

test('빈 문자열을 왕복해도 안전하다', () => {
  assert.equal(fromBase64(toBase64('')), '');
});

test('커밋 메시지에 저장 시각이 들어간다', () => {
  const now = new Date(2026, 6, 28, 15, 30); // 2026-07-28 15:30 (로컬)
  assert.equal(commitMessage(now), 'chore: 관리자 설정 변경 (2026-07-28 15:30)');
});

test('이미지 파일명은 시각을 붙여 매번 달라진다', () => {
  assert.equal(imageFileName(new Date(2026, 6, 28, 15, 30)), 'form-20260728-1530.jpg');
  assert.equal(imageFileName(new Date(2026, 0, 5, 9, 7)), 'form-20260105-0907.jpg');
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test github.test.mjs`
Expected: FAIL — `Cannot find module './github.js'`

- [ ] **Step 3: `github.js` 작성**

```js
// btoa/atob는 바이트 단위로만 동작한다. 한글이 들어간 설정을 그대로 넣으면
// InvalidCharacterError가 나므로 UTF-8 바이트로 바꾼 뒤 인코딩한다.
export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// GitHub API는 base64를 76자마다 줄바꿈해 돌려준다. 공백을 모두 제거해야 한다.
export function fromBase64(b64) {
  const binary = atob(String(b64).replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function pad2(n) { return String(n).padStart(2, '0'); }

// toISOString()은 UTC로 바꿔버려 시각이 어긋난다. 로컬 값을 그대로 조립한다.
function parts(date) {
  return {
    y: date.getFullYear(),
    m: pad2(date.getMonth() + 1),
    d: pad2(date.getDate()),
    hh: pad2(date.getHours()),
    mm: pad2(date.getMinutes()),
  };
}

export function commitMessage(now = new Date()) {
  const t = parts(now);
  return `chore: 관리자 설정 변경 (${t.y}-${t.m}-${t.d} ${t.hh}:${t.mm})`;
}

// 같은 이름으로 덮어쓰면 브라우저·CDN 캐시가 옛 이미지를 계속 보여주고,
// 되돌리기를 해도 이미지는 돌아오지 않는다. 매번 새 이름을 쓴다.
export function imageFileName(now = new Date(), ext = 'jpg') {
  const t = parts(now);
  return `form-${t.y}${t.m}${t.d}-${t.hh}${t.mm}.${ext}`;
}

const API = 'https://api.github.com';

export function createClient({ repo, token, branch = 'main' }) {
  function request(path, options = {}) {
    return fetch(`${API}${path}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    }).then((res) => {
      if (res.status === 404) return null;
      if (!res.ok) {
        return res.json().catch(() => ({})).then((body) => {
          const error = new Error(body.message || `GitHub ${res.status}`);
          error.status = res.status;
          throw error;
        });
      }
      return res.json();
    });
  }

  return {
    // 없으면 null. 최초 저장 시 config.json이 아직 없는 경우를 구분하기 위함이다.
    getFile(path) {
      return request(`/repos/${repo}/contents/${path}?ref=${branch}`).then((data) =>
        data ? { text: fromBase64(data.content), sha: data.sha } : null
      );
    },

    // sha를 함께 보내면 GitHub이 충돌을 409로 막아준다. 조용히 덮어쓰지 않는다.
    putFile({ path, content, sha, message }) {
      return request(`/repos/${repo}/contents/${path}`, {
        method: 'PUT',
        body: JSON.stringify({ message, content, branch, ...(sha ? { sha } : {}) }),
      });
    },

    listCommits(path, perPage = 10) {
      return request(`/repos/${repo}/commits?path=${path}&sha=${branch}&per_page=${perPage}`)
        .then((list) => (list || []).map((c) => ({
          sha: c.sha,
          date: c.commit.author.date,
          message: c.commit.message.split('\n')[0],
        })));
    },

    getCommitContent(path, sha) {
      return request(`/repos/${repo}/contents/${path}?ref=${sha}`).then((data) =>
        data ? fromBase64(data.content) : null
      );
    },
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test github.test.mjs`
Expected: PASS (5개 테스트)

- [ ] **Step 5: 커밋**

```bash
git add github.js github.test.mjs
git commit -F - <<'EOF'
feat: GitHub Contents API 래퍼 추가

Why:
- 관리자 페이지가 config.json과 서식 이미지를 저장소에 직접 커밋해야 한다.
  서버가 없으므로 브라우저에서 GitHub API를 직접 호출한다.

What:
- toBase64/fromBase64: btoa는 한글에서 예외를 던지므로 UTF-8 바이트로 변환.
  GitHub이 돌려주는 줄바꿈 섞인 base64도 처리
- getFile/putFile/listCommits/getCommitContent 제공
- putFile은 sha를 함께 보내 동시 편집을 409로 막는다
- imageFileName은 시각을 붙여 캐시가 옛 이미지를 물고 있는 문제를 피한다
EOF
```

---

### Task 8: `admin.html` 골격 · 토큰 등록 · 항목/요금/계좌 편집

좌표 피커 없이도 쓸 수 있는 관리 화면을 먼저 완성한다.

**Files:**
- Create: `admin.html`

**Interfaces:**
- Consumes: `loadConfig`, `normalizeConfig`, `clone`, `DEFAULT_CONFIG`, `formFields`, `printedCells` (Task 1-3), `createClient` (Task 7)
- Produces: 모듈 스코프의 `state = { config, token, sha, imageFile }` — Task 9·10이 같은 파일에서 이어 쓴다

- [ ] **Step 1: 페이지 골격과 스타일**

`index.html`의 `<style>` 블록에서 색·폰트·버튼·입력 스타일을 가져와 같은 디자인 언어를 유지한다. 상수는 그대로 복사한다: 배경 `#F5F4F0`, 카드 `#fff` + `#E8E6DE` 테두리 + `border-radius: 20px`, 강조색 `#1F6D57`, 본문 `#1E251E`, 보조 텍스트 `#7A8177`.

```html
<div class="wrap">
  <div class="inner">
    <div class="eyebrow">관리자</div>
    <h1>신청서 설정</h1>

    <div class="tabs">
      <button class="tab active" data-tab="layout" type="button">서식 &amp; 칸</button>
      <button class="tab" data-tab="fields" type="button">항목</button>
      <button class="tab" data-tab="values" type="button">요금 · 계좌</button>
      <button class="tab" data-tab="save" type="button">미리보기 &amp; 저장</button>
    </div>

    <section class="card" id="panel-layout" hidden></section>
    <section class="card" id="panel-fields"></section>
    <section class="card" id="panel-values" hidden></section>
    <section class="card" id="panel-save" hidden></section>
  </div>
</div>
<div class="toast" id="toast"></div>
```

- [ ] **Step 2: 토큰 등록 화면**

토큰이 없으면 다른 탭을 잠그고 안내를 띄운다.

```js
const REPO = 'useApart/guesthouse-form';
const TOKEN_KEY = 'guesthouse-admin-token';

const state = {
  config: clone(DEFAULT_CONFIG),
  token: localStorage.getItem(TOKEN_KEY) || '',
  sha: null,       // config.json의 현재 sha. 충돌 감지에 쓴다.
  imageFile: null, // 교체할 이미지 File. 저장 시에만 커밋한다.
  dirty: false,
};
```

토큰 입력 폼은 "요금 · 계좌" 탭 하단에 둔다. 안내 문구:

> GitHub 파인그레인드 토큰이 필요합니다. Settings → Developer settings → Personal access tokens → Fine-grained tokens에서 `useApart/guesthouse-form` 저장소 하나에 **Contents: Read and write** 권한만 준 토큰을 만들어 붙여넣으세요. 토큰은 이 브라우저에만 저장되며 GitHub 외 어디로도 전송되지 않습니다.

```js
function saveToken(value) {
  state.token = value.trim();
  if (state.token) localStorage.setItem(TOKEN_KEY, state.token);
  else localStorage.removeItem(TOKEN_KEY);
  renderAll();
}
```

"토큰 삭제" 버튼은 `saveToken('')`을 부른다.

- [ ] **Step 3: 항목 탭**

`state.config.fields`를 목록으로 렌더링한다. 각 행:

```
[↑][↓]  신청일          [날짜 ▾]  [반 칸 ▾]  ☑화면표시  ☑필수  ☐기억  [삭제]
```

- `system: true`인 항목은 삭제 버튼을 렌더링하지 않고, 입력 유형 `<select>`를 `disabled`로 둔다
- `checkIn`·`checkOut`은 "화면표시" 체크박스도 `disabled`
- 입력 유형 선택지는 `text` / `date` / `phone` 세 가지만 노출한다 (`choice`·`toggle`·`money`는 system 전용이므로 현재 값을 그대로 표시만 한다)
- "+ 항목 추가"는 라벨을 물어 `id`를 슬러그로 만든다

```js
function slugify(label, existingIds) {
  const base = label.trim().toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-|-$/g, '') || 'field';
  // 한글 라벨은 슬러그가 그대로 한글이 된다. id는 DOM의 getElementById에만
  // 쓰이므로 한글이어도 동작하지만, 충돌만 피하면 된다.
  let id = base;
  let n = 2;
  while (existingIds.includes(id)) id = `${base}-${n++}`;
  return id;
}
```

새 항목의 기본값: `{ input: 'text', width: 'full', rect: null, visible: true, required: false, maxlength: 20, placeholder: '' }`. 좌표는 탭 ①에서 잡는다.

편집할 때마다 `state.config = normalizeConfig(state.config)`를 돌려 항상 유효한 상태를 유지하고 `state.dirty = true`로 표시한다.

- [ ] **Step 4: 요금 · 계좌 탭**

숫자 입력과 텍스트 입력을 나열한다.

| 라벨 | 바인딩 |
|---|---|
| 평일 1박 요금 | `pricing.weekday` |
| 주말 1박 요금 | `pricing.weekend` |
| 주말로 취급할 요일 | `pricing.weekendDays` (일~토 체크박스 7개) |
| 추가 인원 1박 요금 | `pricing.extraPerPersonNight` |
| 기준 인원 | `pricing.basePeople` |
| 인원 선택 버튼 | `pricing.peopleOptions` (쉼표로 구분된 숫자) |
| 최대 숙박일수 | `pricing.maxNights` |
| 초과 시 경고 문구 | `pricing.maxNightsText` |
| 은행 / 계좌번호 / 예금주 | `account.bank` / `.number` / `.holder` |
| 기관명 / 제목 | `site.org` / `site.title` |

- [ ] **Step 5: 설정 불러오기**

```js
function loadFromRepo() {
  if (!state.token) return loadConfig().then((config) => { state.config = config; renderAll(); });
  const client = createClient({ repo: REPO, token: state.token });
  return client.getFile('config.json')
    .then((file) => {
      if (file) {
        state.config = normalizeConfig(JSON.parse(file.text));
        state.sha = file.sha;
      } else {
        // 저장소에 아직 config.json이 없다. 기본값에서 시작하고 sha는 비워 둔다.
        state.config = clone(DEFAULT_CONFIG);
        state.sha = null;
      }
      state.dirty = false;
      renderAll();
    })
    .catch((err) => {
      showToast(`설정을 불러오지 못했습니다: ${err.message}`);
      state.config = clone(DEFAULT_CONFIG);
      renderAll();
    });
}
```

- [ ] **Step 6: 수동 확인**

`http://localhost:8000/admin.html`에서 토큰 없이 열어 항목·요금 탭이 기본값으로 채워지는지, 편집이 반영되는지 확인한다. 저장은 아직 없다.

- [ ] **Step 7: 커밋**

```bash
git add admin.html
git commit -F - <<'EOF'
feat: 관리자 페이지 골격과 항목·요금·계좌 편집 추가

Why:
- 요금 인상, 계좌 변경, 입력 항목 추가처럼 자주 생기는 변경을 코드 수정 없이
  처리할 수 있어야 한다. 좌표 편집보다 이쪽이 훨씬 자주 쓰인다.

What:
- 탭 4개 골격과 index.html과 같은 디자인 언어 적용
- GitHub 파인그레인드 토큰 등록/삭제 (localStorage 보관, GitHub 외 전송 없음)
- 항목 탭: 순서 이동·라벨·입력유형·폭·표시·필수·기억·추가·삭제
  system 항목은 삭제 불가, 입실일·퇴실일은 숨김 불가
- 요금·계좌·문구 편집
- 저장소에서 config.json을 불러오고 sha를 보관 (충돌 감지용)
EOF
```

---

### Task 9: `admin.html` 좌표 피커

**Files:**
- Modify: `admin.html`

**Interfaces:**
- Consumes: `state` (Task 8), `printedCells`, `rectToPoint` (Task 1·3)
- Produces: `state.imageFile`, `state.config.form`, `state.config.fields[].rect`

- [ ] **Step 1: 이미지와 오버레이 렌더링**

서식 이미지를 `<img>`로 띄우고 그 위에 `position: absolute` 박스를 겹친다. 캔버스가 아니라 DOM 요소를 쓰는 이유는 드래그·핸들·키보드 조작을 브라우저에 맡길 수 있어서다.

```js
// 화면 표시 배율. 좌표는 항상 원본 픽셀로 저장하고 여기서만 변환한다.
function scale() {
  const img = $('formPreview');
  return img.clientWidth / state.config.form.width;
}
function toScreen(v) { return v * scale(); }
function toImage(v) { return v / scale(); }
```

각 박스는 `printedCells(state.config)`로 만들고, 안에 실제 출력 문자열을 실제 폰트 크기로 그린다.

```js
const SAMPLE = {
  applyDate: '2026.7.28', deposit: '2026.7.28', name: '홍길동',
  unit: '101동 1201호', phone: '010-1234-5678',
  period: '2026.7.28 ~ 7.30', nights: '2일', amount: '70,000원', people: '3명',
};

function sampleText(field) {
  return SAMPLE[field.id] || field.label;
}

// index.html의 drawForm()과 같은 방식으로 폰트 크기를 정한다. 여기서 넘치면
// 실제 출력에서도 폰트가 줄어든다는 뜻이므로 경고를 띄운다.
function fitFontSize(text, maxWidth) {
  const ctx = document.createElement('canvas').getContext('2d');
  let size = 14;
  ctx.font = `${size}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
  while (ctx.measureText(text).width > maxWidth && size > 8) {
    size -= 1;
    ctx.font = `${size}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
  }
  return { size, overflow: size < 14 };
}
```

박스 라벨과 경고 표시:
```js
const { size, overflow } = fitFontSize(sampleText(field), rectToPoint(field.rect).maxWidth);
box.classList.toggle('overflow', overflow);
```

- [ ] **Step 2: 드래그 이동과 크기 조절**

`pointerdown`/`pointermove`/`pointerup`에 `setPointerCapture`를 쓴다. 모서리 4개 + 변 4개, 총 8개 핸들.

```js
let drag = null; // { id, mode: 'move'|'n'|'s'|'e'|'w'|'ne'|..., startX, startY, origin }

function onPointerDown(e, field, mode) {
  e.preventDefault();
  e.currentTarget.setPointerCapture(e.pointerId);
  drag = { id: field.id, mode, startX: e.clientX, startY: e.clientY, origin: { ...field.rect } };
}

function onPointerMove(e) {
  if (!drag) return;
  const dx = toImage(e.clientX - drag.startX);
  const dy = toImage(e.clientY - drag.startY);
  const field = state.config.fields.find((f) => f.id === drag.id);
  const o = drag.origin;

  if (drag.mode === 'move') {
    field.rect = { ...o, x: o.x + dx, y: o.y + dy };
  } else {
    let { x, y, w, h } = o;
    if (drag.mode.includes('w')) { x = o.x + dx; w = o.w - dx; }
    if (drag.mode.includes('e')) { w = o.w + dx; }
    if (drag.mode.includes('n')) { y = o.y + dy; h = o.h - dy; }
    if (drag.mode.includes('s')) { h = o.h + dy; }
    field.rect = { x, y, w, h };
  }
  // 반올림과 범위 보정은 normalizeConfig에 맡긴다 — 검증 규칙이 한 곳에만 있다.
  state.config = normalizeConfig(state.config);
  state.dirty = true;
  renderPicker();
}
```

방향키는 선택된 칸을 1px씩 옮긴다 (`Shift`와 함께면 10px).

- [ ] **Step 3: 빈 곳 드래그로 새 칸 그리기**

좌표가 없는 항목(`rect: null`)을 목록에서 고른 뒤 이미지 빈 곳을 드래그하면 그 사각형을 그 항목에 할당한다. 드래그가 끝났을 때 폭이나 높이가 5px 미만이면 무시한다 (실수 클릭 방지).

- [ ] **Step 4: 이미지 교체와 좌표 자동 조정**

```js
function replaceImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const old = state.config.form;
    const changed = img.naturalWidth !== old.width || img.naturalHeight !== old.height;
    // 같은 서식을 고화질로 다시 스캔한 경우가 흔하다. 좌표 9개를 다시 잡는 것은 낭비다.
    if (changed && confirm(
      `이미지 크기가 ${old.width}×${old.height}에서 ${img.naturalWidth}×${img.naturalHeight}로 바뀌었습니다.\n` +
      '기존 칸 위치를 비율에 맞춰 자동 조정할까요?'
    )) {
      const rx = img.naturalWidth / old.width;
      const ry = img.naturalHeight / old.height;
      for (const field of state.config.fields) {
        if (!field.rect) continue;
        field.rect = {
          x: Math.round(field.rect.x * rx), y: Math.round(field.rect.y * ry),
          w: Math.round(field.rect.w * rx), h: Math.round(field.rect.h * ry),
        };
      }
    }
    state.config.form = { image: old.image, width: img.naturalWidth, height: img.naturalHeight };
    state.imageFile = file;              // 실제 커밋은 저장할 때 한다
    state.config = normalizeConfig(state.config);
    state.dirty = true;
    $('formPreview').src = url;          // 저장 전에도 새 이미지로 작업할 수 있다
    renderPicker();
  };
  img.src = url;
}
```

`state.config.form.image`는 저장 시점에 `imageFileName(new Date())`로 바꾼다 (Task 10).

- [ ] **Step 5: 칸 목록 체크박스**

체크를 해제하면 `field.printed = false`로 두고 `rect`는 남긴다. 다시 켜면 좌표가 복원된다. `rect`가 없는 항목은 "위치 미지정"으로 표시하고 체크를 `disabled`로 둔다.

- [ ] **Step 6: 수동 확인**

- 박스를 드래그하면 따라 움직이고, 놓으면 좌표 숫자가 바뀌는가
- 모서리를 끌면 크기가 바뀌는가. 이미지 밖으로 나가지 않는가
- 성명 칸을 좁히면 "글자가 칸을 넘침" 경고가 뜨는가
- 다른 크기의 이미지를 올리면 비율 조정 확인창이 뜨고, 승인하면 박스가 같은 자리에 있는가
- 체크를 껐다 켜면 좌표가 그대로인가

- [ ] **Step 7: 커밋**

```bash
git add admin.html
git commit -F - <<'EOF'
feat: 서식 칸 위치를 이미지 위에서 직접 잡는 좌표 피커 추가

Why:
- 신청서 서식이 개정되면 칸 좌표 9개가 전부 달라진다. 지금은 픽셀을 손으로
  읽어 코드에 적어야 했다.

What:
- 서식 이미지 위에 칸을 겹쳐 그리고 드래그 이동·핸들 크기조절·방향키 미세조정
- 각 칸에 실제 출력 문자열을 실제 폰트 크기로 그려 넘침을 즉시 경고
- 빈 곳 드래그로 새 칸 지정
- 이미지 교체 시 크기가 달라지면 기존 좌표를 비율로 자동 조정
- 칸을 꺼도 좌표는 보관(printed:false)해 다시 켜면 복원
EOF
```

---

### Task 10: 미리보기 · 저장 · 되돌리기

**Files:**
- Modify: `admin.html`

**Interfaces:**
- Consumes: `state` (Task 8·9), `createClient`, `commitMessage`, `imageFileName`, `toBase64` (Task 7)
- Produces: 없음

- [ ] **Step 1: 미리보기**

편집 중인 설정을 `sessionStorage`에 넣고 iframe을 새로 고친다. 관리자 페이지 안에 신청서 화면을 다시 만들지 않는다 — 그러면 화면이 두 벌이 되어 한쪽만 고치는 사고가 난다.

```js
function refreshPreview(page = 'index.html') {
  sessionStorage.setItem('guesthouse-config-preview', JSON.stringify(state.config));
  const frame = $('previewFrame');
  // 캐시된 프레임을 그대로 두면 새 설정을 읽지 않는다. src를 다시 넣어 리로드한다.
  frame.src = `${page}?preview=1&t=${Date.now()}`;
}
```

패널에는 "타이핑 화면" / "손글씨 화면" 전환 버튼과 iframe 하나를 둔다.

**주의:** 새 이미지를 아직 커밋하지 않은 상태에서는 `config.form.image`가 저장소에 없는 파일을 가리킨다. 미리보기용 설정에는 `URL.createObjectURL(state.imageFile)` 주소를 대신 넣는다.

```js
function previewPayload() {
  const config = clone(state.config);
  if (state.imageFile) config.form.image = $('formPreview').src; // blob: URL
  return config;
}
```

- [ ] **Step 2: 저장**

이미지를 먼저 커밋한다. 이미지만 올라가고 설정이 실패해도 옛 설정이 옛 이미지를 계속 가리키므로 주민 화면은 정상이다. 순서를 반대로 하면 설정이 없는 파일을 가리켜 화면이 깨진다.

```js
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]); // data: 접두어 제거
    reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
}

function save() {
  if (!state.token) { showToast('먼저 GitHub 토큰을 등록해 주세요.'); return; }
  const client = createClient({ repo: REPO, token: state.token });
  const now = new Date();
  const message = commitMessage(now);
  setSaving(true);

  const uploadImage = state.imageFile
    ? readFileAsBase64(state.imageFile).then((content) => {
        const ext = state.imageFile.name.split('.').pop().toLowerCase() || 'jpg';
        const path = imageFileName(now, ext);
        return client.putFile({ path, content, message: `chore: 서식 이미지 교체 (${path})` })
          .then(() => path);
      })
    : Promise.resolve(null);

  return uploadImage
    .then((imagePath) => {
      const config = clone(state.config);
      if (imagePath) config.form.image = imagePath;
      const text = JSON.stringify(config, null, 2) + '\n';
      return client.putFile({
        path: 'config.json',
        content: toBase64(text),
        sha: state.sha,   // null이면 새로 만든다
        message,
      }).then((result) => {
        state.config = config;
        state.sha = result.content.sha;
        state.imageFile = null;
        state.dirty = false;
        showToast('저장했습니다. 1분 안에 반영됩니다.');
        renderAll();
      });
    })
    .catch((err) => {
      if (err.status === 409 || err.status === 422) {
        showToast('다른 곳에서 설정이 변경되었습니다. 새로고침 후 다시 시도해 주세요.');
      } else if (err.status === 401 || err.status === 403) {
        showToast('토큰이 유효하지 않거나 권한이 없습니다. 토큰을 다시 등록해 주세요.');
      } else {
        showToast(`저장하지 못했습니다: ${err.message}`);
      }
    })
    .finally(() => setSaving(false));
}
```

저장 버튼은 `state.dirty`가 `false`면 비활성화한다. 저장 중에는 중복 클릭을 막는다.

- [ ] **Step 3: 되돌리기**

```js
function loadHistory() {
  const client = createClient({ repo: REPO, token: state.token });
  return client.listCommits('config.json', 10).then((commits) => {
    renderHistory(commits); // 날짜와 "이 시점으로 되돌리기" 버튼
  });
}

function restore(sha) {
  const client = createClient({ repo: REPO, token: state.token });
  return client.getCommitContent('config.json', sha).then((text) => {
    if (!text) { showToast('그 시점의 설정을 불러오지 못했습니다.'); return; }
    // 이력을 되감지 않고 옛 값을 편집기로 불러온다. 확인 후 새 커밋으로 저장하므로
    // 되돌리기를 되돌리는 것도 똑같이 동작한다.
    state.config = normalizeConfig(JSON.parse(text));
    state.imageFile = null;
    state.dirty = true;
    renderAll();
    refreshPreview();
    showToast('불러왔습니다. 미리보기로 확인한 뒤 저장하세요.');
  });
}
```

날짜 표시는 `new Date(commit.date).toLocaleString('ko-KR')`을 쓴다.

- [ ] **Step 4: 이탈 경고**

```js
window.addEventListener('beforeunload', (e) => {
  if (!state.dirty) return;
  e.preventDefault();
  e.returnValue = '';
});
```

- [ ] **Step 5: 수동 확인**

**실제 저장소에 커밋되므로 확인 후 되돌릴 준비를 하고 진행한다.**

- 미리보기 iframe에 편집 내용이 반영되는가. 손글씨 화면도 전환되는가
- 계좌번호를 바꾸고 저장 → GitHub에서 `config.json` 커밋 확인 → 배포 후 `index.html`에 반영 확인
- 새 이미지를 올리고 저장 → 이미지 커밋과 설정 커밋 2개가 생기는가. `config.form.image`가 새 파일명인가
- 토큰을 일부러 틀리게 넣고 저장 → 401/403 안내가 뜨는가
- 다른 탭에서 먼저 저장한 뒤 이 탭에서 저장 → 409 안내가 뜨는가
- 되돌리기로 이전 설정을 불러와 저장 → 원래대로 돌아오는가
- 편집 중 탭을 닫으려 하면 경고가 뜨는가

- [ ] **Step 6: 커밋**

```bash
git add admin.html
git commit -F - <<'EOF'
feat: 관리자 페이지 미리보기·저장·되돌리기 추가

Why:
- 설정을 잘못 저장하면 주민들 신청서 화면이 통째로 망가진다.
  저장 전에 실제 화면을 보고, 잘못됐으면 되돌릴 수 있어야 한다.

What:
- 미리보기는 index.html/draw.html을 iframe으로 띄운다(?preview=1 + sessionStorage).
  관리자 페이지에 화면을 다시 만들지 않아 두 벌이 어긋날 여지를 없앰
- 저장은 이미지 먼저, config.json 나중. 중간에 실패해도 옛 설정이 옛 이미지를
  가리키므로 주민 화면이 깨지지 않는다
- sha 충돌(409), 토큰 오류(401/403)를 각각 구분해 안내
- config.json 최근 커밋 10건에서 되돌리기 (이력을 되감지 않고 새 커밋으로 저장)
- 저장하지 않은 편집이 있으면 이탈 경고
EOF
```

---

### Task 11: `config.json` 초기 커밋과 문서 갱신

**Files:**
- Create: `config.json`
- Modify: `README.md`

- [ ] **Step 1: `config.json` 생성**

`DEFAULT_CONFIG`를 그대로 직렬화한다. 손으로 쓰지 않는다 — 기본값과 어긋나면 안 된다.

```bash
node -e "import('./config.js').then(m => { const fs = require('fs'); fs.writeFileSync('config.json', JSON.stringify(m.DEFAULT_CONFIG, null, 2) + '\n'); })"
```

- [ ] **Step 2: 기본값과 일치하는지 검증하는 테스트 추가**

`config.test.mjs`에 추가한다. 이 테스트는 `config.json`이 정규화를 통과하고, 통과 후에도 기본값과 같은 구조인지 확인한다.

```js
import { readFileSync } from 'node:fs';

test('저장소의 config.json이 정규화를 통과한다', () => {
  const text = readFileSync(new URL('./config.json', import.meta.url), 'utf8');
  const parsed = parseConfig(text);
  // 초기 config.json은 기본값 그대로여야 한다. 관리자가 저장한 뒤에는
  // 달라지는 것이 정상이므로, 이 테스트는 구조만 확인한다.
  assert.equal(parsed.version, 1);
  assert.ok(parsed.fields.length >= 12);
  assert.ok(printedCells(parsed).length >= 1);
  assert.ok(parsed.account.number);
});
```

- [ ] **Step 3: 테스트 통과 확인**

Run: `node --test calc.test.mjs config.test.mjs github.test.mjs`
Expected: PASS (전체)

- [ ] **Step 4: `README.md` 갱신**

"금액 계산 기준" 절 아래에 관리자 절을 추가하고, 요금이 이제 설정값임을 반영한다.

```markdown
## 관리자

`admin.html`에서 서식 이미지·칸 위치·입력 항목·요금·계좌를 바꿀 수 있습니다.
저장하면 `config.json`이 저장소에 커밋되고 약 1분 뒤 모두에게 반영됩니다.

1. GitHub 파인그레인드 토큰을 만듭니다.
   Settings → Developer settings → Personal access tokens → Fine-grained tokens
   → 이 저장소만 선택 → **Contents: Read and write**
2. `admin.html`을 열고 토큰을 한 번 등록합니다. 토큰은 브라우저에만 저장됩니다.
3. 편집한 뒤 "미리보기 & 저장" 탭에서 실제 화면을 확인하고 저장합니다.
4. 잘못 저장했다면 같은 탭의 "되돌리기"에서 이전 설정을 불러옵니다.

`config.json`이 없거나 깨져도 신청서는 `config.js`의 내장 기본값으로 동작합니다.

## 개발

```bash
node --test calc.test.mjs config.test.mjs github.test.mjs
python -m http.server 8000
```
```

기존 "금액 계산 기준" 절의 마지막에 한 줄 추가:

> 위 금액은 초기값이며 관리자 페이지에서 변경할 수 있습니다.

- [ ] **Step 5: 커밋**

```bash
git add config.json config.test.mjs README.md
git commit -F - <<'EOF'
feat: 초기 config.json 추가와 문서 갱신

Why:
- 관리자가 처음 저장하기 전에도 저장소에 설정 파일이 있어야
  index.html이 내장 기본값 대신 실제 파일을 읽는 경로를 탄다.

What:
- DEFAULT_CONFIG를 직렬화해 config.json 생성
- 저장소의 config.json이 정규화를 통과하는지 검증하는 테스트 추가
- README에 관리자 페이지 사용법과 토큰 발급 절차 추가
EOF
```

---

## Self-Review

**1. Spec coverage**

| 설계 문서 요구사항 | 담당 Task |
|---|---|
| `config.json` 중심 아키텍처 | 1, 2, 11 |
| 내장 기본값 폴백 | 2 (`normalizeConfig`, `loadConfig`) |
| `fields` 단일 배열 모델 | 1 |
| `rect: null` / `input: null` / `printed` | 1, 2, 3 |
| `system` 보호 규칙, 입실·퇴실 숨김 불가 | 2 |
| 파생 문구를 저장하지 않음 | 5 (공휴일 문구), 5 (계좌 복사 문자열) |
| 사각형 → 중심점 변환 | 1 |
| 배치 규칙 (`packRows`) | 3 |
| 출력 문자열 서식 | 5 (`formatValues`) |
| 요금표 인자화 | 4 |
| 좌표 피커 | 9 |
| 이미지 교체·비율 자동 조정 | 9 |
| 항목/요금/계좌 편집 | 8 |
| 토큰 인증 | 8 |
| 미리보기 (iframe + `?preview=1`) | 5, 6, 10 |
| 저장 순서 (이미지 먼저) | 10 |
| `sha` 충돌 감지 | 7, 10 |
| 되돌리기 | 10 |
| `index.html` 리팩터 | 5 |
| `draw.html` 리팩터 | 6 |
| 회귀 방지 테스트 | 1 |
| 검증/정규화 테스트 | 2 |

빠진 항목 없음.

**2. Placeholder scan**

"TBD", "적절히 처리", "위와 유사하게" 없음. 코드가 필요한 단계에는 실제 코드를 넣었다. Task 8의 항목 탭 행 마크업과 Task 9의 핸들 8개 배치는 코드 대신 명세로 기술했다 — 이 둘은 CSS 레이아웃 취향의 문제라 정답이 하나가 아니며, 동작 규칙(어떤 항목이 `disabled`인지, 어떤 값에 바인딩되는지)은 전부 명시했다.

**3. Type consistency**

- `rectToPoint(rect)` → `{x, y, maxWidth}`: Task 1 정의, Task 5·9에서 동일하게 사용
- `formFields`/`printedCells`/`packRows`: Task 3 정의, Task 5·6·8·9에서 동일한 이름과 시그니처
- `createClient({repo, token, branch})` → `{getFile, putFile, listCommits, getCommitContent}`: Task 7 정의, Task 8·10에서 동일
- `putFile({path, content, sha, message})`: Task 7 정의, Task 10에서 동일한 키로 호출
- `state` 객체 키(`config`, `token`, `sha`, `imageFile`, `dirty`): Task 8 정의, Task 9·10에서 동일
- `sessionStorage` 키 `guesthouse-config-preview`: Task 5·6·10에서 동일
- `localStorage` 키 — 신청서는 `guesthouse-form`(기존), 관리자 토큰은 `guesthouse-admin-token`. 충돌 없음

**4. 검증 순서**

Task 1→2→3이 순수 함수 계층을 테스트로 굳히고, Task 4가 계산을, Task 5·6이 소비자를 옮긴다. Task 5가 끝나는 시점에 `config.json` 없이 현재와 동일하게 동작하는 것이 확인되므로, 그 뒤 관리자 페이지가 잘못돼도 신청서는 안전하다. Task 8까지만 해도 요금·계좌 변경이라는 가장 흔한 작업은 이미 가능하다.
