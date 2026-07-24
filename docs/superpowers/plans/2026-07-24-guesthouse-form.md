# 게스트하우스 신청서 자동 작성 웹앱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 웹에서 값을 입력하면 게스트하우스 신청서 JPG를 생성해 문자로 첨부·전송할 수 있는 정적 웹앱을 만들고 GitHub Pages에 배포한다.

**Architecture:** 서버 없는 정적 파일 3개. 원본 서식 JPG를 `<canvas>` 배경으로 그리고 실측 좌표에 텍스트를 `fillText`로 얹어 `toBlob`으로 JPG를 뽑는다. 요금 계산만 순수 함수 모듈(`calc.js`)로 분리해 `node --test`로 검증하고, 나머지 UI는 수동 확인한다.

**Tech Stack:** 바닐라 HTML/CSS/JS (ES modules), Canvas 2D API, Web Share API, `node --test` (Node v24 내장). 외부 의존성·빌드 단계 없음.

## Global Constraints

- 외부 라이브러리·빌드 도구·패키지 매니저를 도입하지 않는다. `package.json`도 만들지 않는다.
- 서버로 데이터를 보내지 않는다. 고정 입력값은 `localStorage`에만 저장한다.
- 출력 이미지는 원본과 동일한 **707×1000**, `image/jpeg` 품질 **0.92**.
- 사용자 대면 문구는 모두 한국어.
- 커밋 메시지는 한국어 Conventional Commits, 본문에 Why/What 포함, `Co-Authored-By` 금지.
- 요금 상수: 평일(월~목) `35000`, 주말(금·토·일) `40000`, 추가 인원 1인당 1박 `5000`, 기준 인원 `2`, 최대 인원 `4`.
- 계좌 상수: 표시용 `국민 856901-00-129046`, 복사용 `85690100129046`, 예금주 `원흥LH13단지주거복지지원센터`.
- 렌더링 좌표(707×1000 기준, 각 칸 중심):
  신청일 `(432,211)`, 성명 `(432,241)`, 동·호수 `(432,270)`, 연락처 `(432,300)`,
  사용기간 `(301,337)`, 숙박일수 `(560,337)`, 사용금액 `(301,370)`, 사용인원 `(560,370)`
- 칸 최대 너비: 신청자 블록 4칸 `400`, 사용기간·사용금액 `136`, 숙박일수·사용인원 `145`
- 로컬 확인은 반드시 HTTP로. `file://`로 열면 canvas가 오염되어 `toBlob`이 실패한다.

## File Structure

| 파일 | 책임 | 생성 태스크 |
|---|---|---|
| `calc.js` | 숙박일수·요금 계산 순수 함수. DOM 의존 없음 | Task 1 |
| `calc.test.mjs` | `calc.js` 테스트 | Task 1 |
| `form.jpg` | 원본 서식 이미지 (기존 JPG를 복사·리네임) | Task 2 |
| `index.html` | 화면·폼·canvas 렌더링·공유·복사. CSS/JS 인라인 | Task 2~5 |
| `.nojekyll` | GitHub Pages가 Jekyll 처리를 건너뛰게 함 | Task 6 |
| `README.md` | 사용법·배포 방법 | Task 6 |

`index.html`은 Task 2에서 뼈대를 만들고 이후 태스크에서 기능을 덧붙인다.
파일이 하나뿐이라 태스크마다 새로 만들지 않고 누적 수정한다.

---

### Task 1: 요금 계산 모듈

계산은 이 앱에서 유일하게 조용히 틀릴 수 있는 로직이다. UI보다 먼저, 테스트와 함께 확정한다.

**Files:**
- Create: `C:\workspace\new\calc.js`
- Test: `C:\workspace\new\calc.test.mjs`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  - `RATE` — `{ WEEKDAY: 35000, WEEKEND: 40000, EXTRA_PER_PERSON_NIGHT: 5000, BASE_PEOPLE: 2, MAX_PEOPLE: 4 }`
  - `countNights(checkIn: string, checkOut: string): number`
    — `'YYYY-MM-DD'` 두 개를 받아 숙박일수 반환. 역전이거나 같으면 `0`.
  - `calcAmount({ checkIn: string, checkOut: string, people: number, holiday: boolean }): number`
    — 총 요금(원). 숙박일수가 0이면 `0`.

- [ ] **Step 1: 실패하는 테스트 작성**

`calc.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countNights, calcAmount, RATE } from './calc.js';

// 2026-07-27(월) ~ 2026-07-29(수): 월·화 두 밤 모두 평일
test('평일 2박 2인은 70,000원', () => {
  assert.equal(countNights('2026-07-27', '2026-07-29'), 2);
  assert.equal(
    calcAmount({ checkIn: '2026-07-27', checkOut: '2026-07-29', people: 2, holiday: false }),
    70000
  );
});

// 2026-07-24(금) ~ 2026-07-26(일): 금·토 두 밤 모두 주말
test('금·토 2박 2인은 80,000원', () => {
  assert.equal(
    calcAmount({ checkIn: '2026-07-24', checkOut: '2026-07-26', people: 2, holiday: false }),
    80000
  );
});

// 2026-07-23(목) ~ 2026-07-25(토): 목(평일) + 금(주말), 추가 2인 x 2박
test('목·금 2박 4인은 95,000원', () => {
  assert.equal(
    calcAmount({ checkIn: '2026-07-23', checkOut: '2026-07-25', people: 4, holiday: false }),
    35000 + 40000 + 2 * RATE.EXTRA_PER_PERSON_NIGHT * 2
  );
});

test('공휴일 요금을 적용하면 모든 밤이 주말 요금', () => {
  assert.equal(
    calcAmount({ checkIn: '2026-07-27', checkOut: '2026-07-29', people: 2, holiday: true }),
    80000
  );
});

test('퇴실일이 입실일보다 빠르거나 같으면 0박 0원', () => {
  assert.equal(countNights('2026-07-25', '2026-07-25'), 0);
  assert.equal(countNights('2026-07-25', '2026-07-23'), 0);
  assert.equal(
    calcAmount({ checkIn: '2026-07-25', checkOut: '2026-07-23', people: 2, holiday: false }),
    0
  );
});

test('날짜가 비어 있으면 0박 0원', () => {
  assert.equal(countNights('', ''), 0);
  assert.equal(calcAmount({ checkIn: '', checkOut: '', people: 2, holiday: false }), 0);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test calc.test.mjs`
Expected: FAIL — `Cannot find module ... calc.js`

- [ ] **Step 3: 최소 구현 작성**

`calc.js`:

```js
export const RATE = {
  WEEKDAY: 35000,
  WEEKEND: 40000,
  EXTRA_PER_PERSON_NIGHT: 5000,
  BASE_PEOPLE: 2,
  MAX_PEOPLE: 4,
};

// 'YYYY-MM-DD'를 로컬 시간 자정 Date로 변환한다.
// new Date('2026-07-24')는 UTC로 해석되어 시간대에 따라 하루가 밀리므로 쓰지 않는다.
function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function countNights(checkIn, checkOut) {
  const a = parseDate(checkIn);
  const b = parseDate(checkOut);
  if (!a || !b) return 0;
  const nights = Math.round((b - a) / 86400000);
  return nights > 0 ? nights : 0;
}

export function calcAmount({ checkIn, checkOut, people, holiday }) {
  const nights = countNights(checkIn, checkOut);
  if (nights === 0) return 0;

  const start = parseDate(checkIn);
  const extra = Math.max(0, people - RATE.BASE_PEOPLE) * RATE.EXTRA_PER_PERSON_NIGHT;

  let total = 0;
  for (let i = 0; i < nights; i++) {
    const night = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const day = night.getDay(); // 0=일 ... 5=금, 6=토
    const isWeekend = day === 5 || day === 6 || day === 0;
    total += (holiday || isWeekend) ? RATE.WEEKEND : RATE.WEEKDAY;
    total += extra;
  }
  return total;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test calc.test.mjs`
Expected: PASS — `# pass 6`, `# fail 0`

- [ ] **Step 5: 커밋**

```bash
git add calc.js calc.test.mjs
git commit -m "feat: 게스트하우스 숙박 요금 계산 모듈 추가

Why:
- 금액은 이 앱에서 유일하게 조용히 틀릴 수 있는 로직이라
  UI보다 먼저 테스트와 함께 확정할 필요가 있었음

What:
- 밤 단위로 요일을 판별해 평일 35,000 / 금·토·일 40,000 적용
- 기준 2인 초과 시 1박당 1인 5,000원 가산
- 공휴일 플래그가 켜지면 전 기간 주말 요금 적용
- 날짜 문자열을 로컬 자정으로 파싱해 시간대에 따른 하루 밀림 방지"
```

---

### Task 2: 서식 이미지를 canvas에 띄우는 뼈대

먼저 이미지가 화면에 제대로 뜨는 것만 확인한다. 텍스트 렌더링은 다음 태스크.

**Files:**
- Create: `C:\workspace\new\form.jpg` (기존 `게스트 하우스 신청서.jpg` 복사)
- Create: `C:\workspace\new\index.html`

**Interfaces:**
- Consumes: 없음
- Produces:
  - 전역 상수 `POS` — 필드별 `{x, y, maxWidth}` 좌표표
  - `drawForm(values: object): void` — canvas에 배경+텍스트를 다시 그린다 (Task 3에서 텍스트 추가)
  - `<canvas id="canvas" width="707" height="1000">`

- [ ] **Step 1: 서식 이미지를 영문 파일명으로 복사**

원본 파일명에 공백과 한글이 있어 URL 인코딩 문제가 생길 수 있다. 영문명으로 복사해 쓴다.
원본은 참고용으로 그대로 둔다.

```bash
cp "게스트 하우스 신청서.jpg" form.jpg
```

- [ ] **Step 2: `index.html` 뼈대 작성**

```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>게스트하우스 신청서</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px;
    font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
    background: #f4f5f7; color: #222;
  }
  main { max-width: 480px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 16px; }
  canvas {
    width: 100%; height: auto; display: block;
    border: 1px solid #ccc; background: #fff;
  }
</style>
</head>
<body>
<main>
  <h1>게스트하우스 신청서</h1>
  <canvas id="canvas" width="707" height="1000"></canvas>
</main>

<script type="module">
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// 707x1000 좌표계. 표 격자선을 픽셀 스캔으로 실측한 각 칸의 중심.
const POS = {
  applyDate: { x: 432, y: 211, maxWidth: 400 },
  name:      { x: 432, y: 241, maxWidth: 400 },
  unit:      { x: 432, y: 270, maxWidth: 400 },
  phone:     { x: 432, y: 300, maxWidth: 400 },
  period:    { x: 301, y: 337, maxWidth: 136 },
  nights:    { x: 560, y: 337, maxWidth: 145 },
  amount:    { x: 301, y: 370, maxWidth: 136 },
  people:    { x: 560, y: 370, maxWidth: 145 },
};

const formImage = new Image();
const imageReady = new Promise((resolve, reject) => {
  formImage.onload = resolve;
  formImage.onerror = () => reject(new Error('서식 이미지를 불러오지 못했습니다.'));
});
formImage.src = 'form.jpg';

function drawForm(values) {
  ctx.drawImage(formImage, 0, 0, canvas.width, canvas.height);
  // 텍스트 렌더링은 Task 3에서 추가한다.
}

await imageReady;
drawForm({});
</script>
</body>
</html>
```

- [ ] **Step 3: 브라우저에서 이미지가 뜨는지 확인**

Run: `python -m http.server 8000`
브라우저에서 `http://localhost:8000/` 접속.
Expected: 신청서 서식이 canvas에 선명하게 표시되고, 콘솔에 에러가 없다.

- [ ] **Step 4: 커밋**

```bash
git add form.jpg index.html
git commit -m "feat: 신청서 서식을 canvas에 렌더링하는 뼈대 추가

Why:
- 원본 서식 위에 값을 얹는 방식이므로, 텍스트를 그리기 전에
  이미지가 정확한 크기로 로드되는지부터 확인할 필요가 있었음

What:
- 서식 이미지를 URL 인코딩 문제가 없는 form.jpg로 복사
- 707x1000 canvas에 배경 렌더링하는 index.html 뼈대 작성
- 격자선 실측으로 확정한 8개 칸의 중심 좌표를 POS 상수로 정의"
```

---

### Task 3: 입력 폼과 실시간 텍스트 렌더링

**Files:**
- Modify: `C:\workspace\new\index.html`

**Interfaces:**
- Consumes: Task 1의 `countNights`, `calcAmount`, `RATE` / Task 2의 `POS`, `drawForm`, `imageReady`
- Produces:
  - `readValues(): object` — 폼에서 `{applyDate, name, unit, phone, checkIn, checkOut, people, holiday, amount}` 수집
  - `formatValues(v): object` — 서식에 그릴 문자열 8개로 변환
  - `render(): void` — 값 수집 → 계산 → 파생 필드 갱신 → `drawForm` 호출

- [ ] **Step 1: 폼 마크업과 스타일 추가**

`<h1>` 바로 아래, `<canvas>` 위에 삽입:

```html
  <form id="form" autocomplete="on">
    <label>신청일 <input type="date" id="applyDate"></label>
    <label>성명 <input type="text" id="name" placeholder="홍길동"></label>
    <label>동·호수 <input type="text" id="unit" placeholder="101동 1001호"></label>
    <label>연락처 <input type="tel" id="phone" placeholder="010-1234-5678"></label>
    <label>입실일 <input type="date" id="checkIn"></label>
    <label>퇴실일 <input type="date" id="checkOut"></label>
    <label>사용인원
      <select id="people">
        <option value="2">2명</option>
        <option value="3">3명</option>
        <option value="4">4명</option>
      </select>
    </label>
    <label class="check">
      <input type="checkbox" id="holiday"> 공휴일 요금 적용 (전 기간 40,000원)
    </label>
    <label>사용금액
      <input type="text" id="amount" inputmode="numeric" placeholder="자동 계산">
    </label>
    <p id="summary" class="summary"></p>
    <p id="warning" class="warning" hidden></p>
  </form>
```

`<style>` 안에 추가:

```css
  form { display: grid; gap: 10px; margin-bottom: 16px; }
  label { display: grid; gap: 4px; font-size: 13px; color: #555; }
  label.check { grid-auto-flow: column; justify-content: start; align-items: center; gap: 6px; }
  input, select {
    font: inherit; font-size: 16px; /* 16px 미만이면 iOS가 focus 시 확대한다 */
    padding: 9px 10px; border: 1px solid #c4c7cc; border-radius: 6px; background: #fff;
  }
  .summary { margin: 0; font-size: 13px; color: #555; }
  .warning { margin: 0; font-size: 13px; color: #c0392b; font-weight: bold; }
```

- [ ] **Step 2: 값 수집·포맷·렌더링 로직 추가**

`<script type="module">` 최상단에 import 추가:

```js
import { countNights, calcAmount, RATE } from './calc.js';
```

`drawForm` 정의를 아래로 교체하고 이어지는 코드를 추가:

```js
function drawForm(text) {
  ctx.drawImage(formImage, 0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const [key, pos] of Object.entries(POS)) {
    const value = text[key];
    if (!value) continue;

    // 칸을 넘치면 들어갈 때까지 폰트를 줄인다.
    let size = 14;
    ctx.font = `${size}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
    while (ctx.measureText(value).width > pos.maxWidth && size > 8) {
      size -= 1;
      ctx.font = `${size}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
    }
    ctx.fillText(value, pos.x, pos.y);
  }
}

const $ = (id) => document.getElementById(id);

function readValues() {
  return {
    applyDate: $('applyDate').value,
    name: $('name').value.trim(),
    unit: $('unit').value.trim(),
    phone: $('phone').value.trim(),
    checkIn: $('checkIn').value,
    checkOut: $('checkOut').value,
    people: Number($('people').value),
    holiday: $('holiday').checked,
    amount: Number($('amount').value.replace(/[^0-9]/g, '')),
  };
}

// 'YYYY-MM-DD' -> 'M/D'. 사용기간 칸이 좁아 연도는 넣지 않는다.
function shortDate(s) {
  if (!s) return '';
  const [, m, d] = s.split('-');
  return `${Number(m)}/${Number(d)}`;
}

function formatValues(v, nights) {
  return {
    applyDate: v.applyDate ? v.applyDate.replace(/-/g, '. ') : '',
    name: v.name,
    unit: v.unit,
    phone: v.phone,
    period: v.checkIn && v.checkOut ? `${shortDate(v.checkIn)} ~ ${shortDate(v.checkOut)}` : '',
    nights: nights ? `${nights}박` : '',
    amount: v.amount ? `${v.amount.toLocaleString('ko-KR')}원` : '',
    people: v.people ? `${v.people}명` : '',
  };
}

// 사용자가 금액을 직접 고쳤는지 추적한다. 고쳤다면 자동 계산으로 덮어쓰지 않는다.
let amountEdited = false;
$('amount').addEventListener('input', () => { amountEdited = true; render(); });

function render() {
  const v = readValues();
  const nights = countNights(v.checkIn, v.checkOut);

  if (!amountEdited) {
    const auto = calcAmount(v);
    $('amount').value = auto ? auto.toLocaleString('ko-KR') : '';
    v.amount = auto;
  }

  $('summary').textContent = nights
    ? `${nights}박 ${v.people}명 · 자동 계산 ${calcAmount(v).toLocaleString('ko-KR')}원`
    : '입실일과 퇴실일을 선택하세요.';

  const warn = $('warning');
  if (v.checkIn && v.checkOut && nights === 0) {
    warn.textContent = '퇴실일은 입실일보다 뒤여야 합니다.';
    warn.hidden = false;
  } else if (nights >= 5) {
    warn.textContent = '운영규정상 1세대가 한 달 기준 5박 이상 사용할 수 없습니다.';
    warn.hidden = false;
  } else {
    warn.hidden = true;
  }

  drawForm(formatValues(v, nights));
}

$('form').addEventListener('input', render);

// 신청일 기본값은 오늘.
$('applyDate').value = new Date().toLocaleDateString('sv-SE'); // sv-SE는 YYYY-MM-DD 형식

await imageReady;
render();
```

기존 `await imageReady; drawForm({});` 두 줄은 삭제한다.

- [ ] **Step 3: 브라우저에서 렌더링 확인**

Run: `python -m http.server 8000`
입력: 성명 `홍길동`, 동·호수 `101동 1001호`, 연락처 `010-1234-5678`,
입실일 `2026-07-23`, 퇴실일 `2026-07-25`, 인원 `4명`

Expected:
- 사용금액이 `95,000`으로 자동 입력된다
- canvas의 8개 칸에 값이 격자 안에 들어가게 표시된다
- 금액을 직접 고치면 날짜를 바꿔도 덮어쓰이지 않는다
- 퇴실일을 입실일보다 앞으로 바꾸면 빨간 경고가 뜬다

칸을 벗어나는 글자가 있으면 `POS` 좌표를 1~2px 조정한다.

- [ ] **Step 4: 커밋**

```bash
git add index.html
git commit -m "feat: 입력 폼과 서식 실시간 렌더링 구현

Why:
- 값을 입력하면서 결과가 어떻게 나오는지 바로 보여야
  칸을 벗어나거나 잘못 들어간 값을 사용자가 즉시 알 수 있음

What:
- 8개 입력 필드와 입력 즉시 canvas를 다시 그리는 render 루프 구현
- 칸 너비를 넘으면 measureText로 감지해 폰트를 8px까지 축소
- 숙박일수·사용금액 자동 산출, 단 사용자가 금액을 고치면 덮어쓰지 않음
- 퇴실일 역전과 5박 이상 사용을 경고로 표시
- iOS에서 focus 시 확대되지 않도록 입력 글꼴을 16px로 지정"
```

---

### Task 4: JPG 생성과 공유·다운로드

**Files:**
- Modify: `C:\workspace\new\index.html`

**Interfaces:**
- Consumes: Task 3의 `render`, `readValues` / Task 2의 `canvas`
- Produces:
  - `toJpegFile(): Promise<File>` — canvas를 `File`(`image/jpeg`, 0.92)로 변환
  - `missingFields(v): string[]` — 비어 있는 필수 항목의 한국어 이름 목록

- [ ] **Step 1: 버튼 마크업과 스타일 추가**

`</form>` 바로 다음, `<canvas>` 위에 삽입:

```html
  <div class="actions">
    <button type="button" id="share" class="primary">이미지 만들어 보내기</button>
    <button type="button" id="download">이미지 저장</button>
  </div>
  <p id="status" class="summary"></p>
```

`<style>`에 추가:

```css
  .actions { display: grid; grid-auto-flow: column; gap: 8px; margin-bottom: 12px; }
  button {
    font: inherit; font-size: 15px; padding: 12px; border-radius: 6px;
    border: 1px solid #c4c7cc; background: #fff; cursor: pointer;
  }
  button.primary { background: #2f6fed; border-color: #2f6fed; color: #fff; font-weight: bold; }
  button:disabled { opacity: 0.45; cursor: not-allowed; }
```

- [ ] **Step 2: 생성·공유·다운로드 로직 추가**

`<script>` 안, `render()` 정의 아래에 추가:

```js
const REQUIRED = {
  name: '성명',
  unit: '동·호수',
  phone: '연락처',
  checkIn: '입실일',
  checkOut: '퇴실일',
};

function missingFields(v) {
  return Object.entries(REQUIRED).filter(([k]) => !v[k]).map(([, label]) => label);
}

function toJpegFile() {
  const v = readValues();
  const stamp = (v.applyDate || '').replace(/-/g, '') || 'form';
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('이미지 생성에 실패했습니다.'));
        resolve(new File([blob], `게스트하우스신청서_${stamp}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92
    );
  });
}

function setStatus(msg) { $('status').textContent = msg; }

// 필수값이 비면 버튼을 잠근다. render 끝에서 호출한다.
function syncButtons() {
  const missing = missingFields(readValues());
  const blocked = missing.length > 0;
  $('share').disabled = blocked;
  $('download').disabled = blocked;
  setStatus(blocked ? `입력이 필요합니다: ${missing.join(', ')}` : '');
}

$('share').addEventListener('click', async () => {
  try {
    const file = await toJpegFile();
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: '게스트하우스 신청서' });
      setStatus('');
      return;
    }
    setStatus('이 브라우저는 공유를 지원하지 않습니다. "이미지 저장"을 눌러 주세요.');
  } catch (err) {
    // 사용자가 공유 시트를 닫은 경우는 오류가 아니다.
    if (err.name === 'AbortError') return;
    setStatus(`이미지를 만들지 못했습니다: ${err.message}`);
  }
});

$('download').addEventListener('click', async () => {
  try {
    const file = await toJpegFile();
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('저장했습니다.');
  } catch (err) {
    setStatus(`이미지를 만들지 못했습니다: ${err.message}`);
  }
});
```

`render()` 함수의 마지막 줄 `drawForm(formatValues(v, nights));` 다음에 한 줄 추가:

```js
  syncButtons();
```

- [ ] **Step 3: 브라우저에서 생성·저장 확인**

Run: `python -m http.server 8000`
Expected:
- 필수값이 비어 있으면 두 버튼이 비활성, "입력이 필요합니다: …" 표시
- 모두 채우면 활성화
- "이미지 저장" → `게스트하우스신청서_20260724.jpg` 다운로드
- 저장된 파일을 열면 707×1000이고 값이 모두 들어가 있다
- 폰에서 "이미지 만들어 보내기" → 공유 시트에 문자 앱이 뜬다

- [ ] **Step 4: 커밋**

```bash
git add index.html
git commit -m "feat: 신청서 JPG 생성과 공유·저장 기능 추가

Why:
- 최종 목적이 문자 첨부이므로 폰에서는 공유 시트로 바로 넘기고,
  이를 지원하지 않는 PC에서는 파일로 받을 수 있어야 함

What:
- canvas를 image/jpeg 품질 0.92로 변환해 File 객체 생성
- navigator.share 지원 시 공유 시트, 미지원 시 안내 후 다운로드 유도
- 필수값이 비면 버튼을 잠그고 어떤 항목이 비었는지 표시
- 공유 시트를 닫아 발생하는 AbortError는 오류로 취급하지 않음"
```

---

### Task 5: 입금 정보 복사와 입력값 자동 저장

**Files:**
- Modify: `C:\workspace\new\index.html`

**Interfaces:**
- Consumes: Task 3의 `readValues`, `render`, `$`
- Produces:
  - `copyText(text: string, button: HTMLElement): Promise<void>` — 클립보드 복사 + 버튼 피드백
  - `localStorage` 키 `guesthouse-form` — `{name, unit, phone}` JSON

- [ ] **Step 1: 입금 정보 마크업과 스타일 추가**

`<p id="status">` 바로 다음에 삽입:

```html
  <section class="bank">
    <div>
      <strong>국민 856901-00-129046</strong>
      <span>원흥LH13단지주거복지지원센터</span>
    </div>
    <div class="actions">
      <button type="button" id="copyAccount">계좌번호 복사</button>
      <button type="button" id="copyAmount">금액 복사</button>
    </div>
  </section>
```

`<style>`에 추가:

```css
  .bank {
    display: grid; gap: 8px; margin-bottom: 16px; padding: 12px;
    background: #fff; border: 1px solid #d8dade; border-radius: 6px;
  }
  .bank strong { display: block; font-size: 15px; }
  .bank span { font-size: 12px; color: #666; }
```

- [ ] **Step 2: 복사 로직 추가**

`<script>` 끝의 `await imageReady;` **앞에** 추가:

```js
const ACCOUNT_NUMBER = '85690100129046'; // 하이픈 없는 값. 금융앱이 하이픈을 거부하는 경우가 있다.

async function copyText(text, button) {
  const original = button.dataset.label || button.textContent;
  button.dataset.label = original;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      // http나 구형 브라우저용 폴백.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    button.textContent = '복사됨';
  } catch {
    button.textContent = '복사 실패';
  }
  setTimeout(() => { button.textContent = original; }, 1500);
}

$('copyAccount').addEventListener('click', (e) => copyText(ACCOUNT_NUMBER, e.currentTarget));
$('copyAmount').addEventListener('click', (e) => {
  const amount = readValues().amount;
  if (!amount) { setStatus('금액이 아직 계산되지 않았습니다.'); return; }
  copyText(String(amount), e.currentTarget); // 콤마·단위 없는 숫자만
});
```

- [ ] **Step 3: 고정 입력값 저장·복원 추가**

같은 위치에 이어서 추가:

```js
const STORE_KEY = 'guesthouse-form';
const SAVED_FIELDS = ['name', 'unit', 'phone']; // 매번 같은 값만 저장한다. 날짜·인원·금액은 제외.

function restoreSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    for (const id of SAVED_FIELDS) {
      if (saved[id]) $(id).value = saved[id];
    }
  } catch {
    // 저장값이 깨졌으면 무시하고 빈 폼으로 시작한다.
  }
}

function saveFields() {
  const v = readValues();
  const data = Object.fromEntries(SAVED_FIELDS.map((id) => [id, v[id]]));
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch {
    // 사파리 프라이빗 모드 등 저장이 막힌 환경. 기능 자체는 계속 동작해야 한다.
  }
}

for (const id of SAVED_FIELDS) {
  $(id).addEventListener('change', saveFields);
}

restoreSaved();
```

- [ ] **Step 4: 브라우저에서 확인**

Run: `python -m http.server 8000`
Expected:
- "계좌번호 복사" → 라벨이 "복사됨"으로 1.5초 바뀌고, 붙여넣으면 `85690100129046`
- "금액 복사" → 붙여넣으면 `95000` (콤마·`원` 없음)
- 성명·동호수·연락처 입력 후 새로고침 → 값이 그대로 복원된다
- 입실일·퇴실일은 복원되지 않는다

- [ ] **Step 5: 커밋**

```bash
git add index.html
git commit -m "feat: 계좌번호·금액 복사와 고정 입력값 자동 저장 추가

Why:
- 이미지 속 계좌번호를 폰에서 금융앱으로 옮겨 적는 것이 번거로웠고,
  성명·동호수·연락처는 매번 같은 값이라 재입력이 낭비였음

What:
- 계좌번호는 하이픈 없이, 금액은 콤마·단위 없이 복사해 붙여넣기 호환 확보
- clipboard API가 막힌 환경을 위해 execCommand 폴백 구현
- 성명·동호수·연락처만 localStorage에 저장하고 날짜·인원·금액은 제외
- 저장이 막힌 브라우저에서도 앱이 계속 동작하도록 예외를 삼킴"
```

---

### Task 6: 배포 준비와 GitHub Pages 공개

**Files:**
- Create: `C:\workspace\new\.nojekyll`
- Create: `C:\workspace\new\README.md`

**Interfaces:**
- Consumes: Task 1~5의 결과물 전체
- Produces: 공개 URL

- [ ] **Step 1: 전체 테스트 재실행**

Run: `node --test calc.test.mjs`
Expected: PASS — `# fail 0`

- [ ] **Step 2: `.nojekyll`과 `README.md` 작성**

`.nojekyll`은 빈 파일이다. GitHub Pages의 Jekyll 처리를 건너뛰게 해 예상치 못한 파일 누락을 막는다.

```bash
touch .nojekyll
```

`README.md`:

```markdown
# 게스트하우스 신청서 자동 작성

원흥LH13단지 게스트하우스 신청서를 웹에서 작성해 JPG로 만들어 문자로 보냅니다.

## 사용법

1. 공개 URL에 접속합니다.
2. 성명·동호수·연락처를 입력합니다. 다음부터는 자동으로 채워집니다.
3. 입실일·퇴실일·인원을 고르면 숙박일수와 금액이 자동 계산됩니다.
4. "이미지 만들어 보내기"를 누르고 문자 앱을 선택합니다.
5. "계좌번호 복사"로 입금 계좌를 금융앱에 붙여넣습니다.

입력한 정보는 서버로 전송되지 않고 본인 브라우저에만 저장됩니다.

## 금액 계산 기준

- 월~목: 1박 35,000원 / 금·토·일: 1박 40,000원
- 기준 2인, 3인부터 1박당 1인 5,000원 추가
- 공휴일은 자동 판별하지 않습니다. "공휴일 요금 적용"을 직접 체크하세요.
- 금액은 직접 수정할 수 있습니다. 최종 확인은 관리사무소(031-965-7502) 기준입니다.

## 개발

```bash
node --test calc.test.mjs   # 요금 계산 테스트
python -m http.server 8000  # 로컬 확인 (file://로 열면 이미지 저장이 실패합니다)
```
```

- [ ] **Step 3: 커밋**

```bash
git add .nojekyll README.md
git commit -m "docs: 사용법 문서와 Pages 배포 설정 추가

Why:
- 단지 주민 누구나 쓰는 공개 앱이므로 사용법과 요금 기준을
  링크만 받은 사람도 알 수 있게 남겨야 함

What:
- 사용 절차, 금액 계산 기준, 개인정보 미전송 사실을 README에 기재
- Jekyll 처리로 파일이 누락되지 않도록 .nojekyll 추가"
```

- [ ] **Step 4: GitHub 저장소 생성과 배포**

> **이 단계는 외부에 공개되는 작업이므로 실행 전 사용자 확인을 받는다.**
> 저장소 이름과 공개 범위를 사용자에게 물은 뒤 진행한다.

```bash
gh repo create <저장소명> --public --source=. --push
gh api -X POST repos/{owner}/<저장소명>/pages -f 'source[branch]=main' -f 'source[path]=/'
```

- [ ] **Step 5: 배포된 URL에서 최종 확인**

`https://<계정>.github.io/<저장소명>/` 접속.
Expected:
- 서식 이미지가 로드된다
- 값을 채우고 이미지를 저장하면 정상적인 JPG가 나온다
- 폰에서 접속해 공유 시트로 문자 첨부까지 된다

폰에서 실제 문자로 한 번 보내 수신 측에서 글자가 읽히는지 확인한다.
읽기 어려우면 `POS`의 폰트 크기 기준값 `14`를 올린다.

---

## 완료 기준

- [ ] `node --test calc.test.mjs` 전부 통과
- [ ] 공개 URL에서 계정 없이 접속 가능
- [ ] iOS Safari와 Android Chrome에서 각각 문자 첨부 성공
- [ ] 생성된 JPG의 8개 칸이 모두 격자 안에 정확히 들어감
- [ ] 계좌번호 복사값이 금융앱에 그대로 붙여넣어짐
