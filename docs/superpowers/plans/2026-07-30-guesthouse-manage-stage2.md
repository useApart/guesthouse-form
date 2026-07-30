# 관리사무소 화면 2단계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리사무소가 이번 달 일정을 달력으로 보고, 승인할 때 그 세대의 이용 이력을 바로 확인할 수 있게 한다.

**Architecture:** 서버는 건드리지 않는다. `manage.html`이 이미 받아오는 전체 예약 목록을 클라이언트에서 가공한다. 계산은 `reservations.js`의 순수 함수로 분리해 `node --test`로 검증하고, 화면은 탭으로 나누되 기본 화면은 지금과 같은 "확인 필요" 목록으로 둔다.

**Tech Stack:** 순수 ES 모듈 + 브라우저 내장 API. 새 의존성 없음. 테스트는 `node --test`.

설계 문서: `docs/superpowers/specs/2026-07-30-guesthouse-manage-stage2-design.md`

## Global Constraints

- **의존성 0.** npm 패키지, CDN 스크립트를 추가하지 않는다.
- **SQL 변경 없음.** 새 테이블·뷰·함수·권한을 만들지 않는다.
- **최상위 `await` 금지.** 구형 사파리에서 모듈 전체가 파싱 실패한다. `.then()/.catch()`만 쓴다.
- **`new Date('YYYY-MM-DD')` 금지.** UTC로 해석되어 하루 밀린다. `new Date(y, m-1, d)`로 조립한다.
- **`toISOString()` 금지.** 같은 이유. 날짜 문자열은 `reservations.js`의 `toDateStr(date)`를 쓴다.
- **날짜 구간은 반개구간 `[check_in, check_out)`.** 퇴실일은 점유하지 않는다. `occupiedNights()`를 재사용하고 새로 구현하지 않는다.
- **새 색을 만들지 않는다.** 확정=`#EAF3EF`/`#1F6D57`, 대기=`#FDF3E7`/`#7A5A22`. 1단계에서 이미 쓰는 값이다.
- **기본 화면은 "확인 필요" 목록.** 탭을 한 번도 누르지 않아도 기존 작업이 그대로 되어야 한다.
- **셸은 PowerShell.** 이 환경에서 Bash가 응답하지 않는다.
- **테스트 실행:** `node --test wiring.test.mjs calc.test.mjs config.test.mjs github.test.mjs reservations.test.mjs`
- **수동 확인:** `python -m http.server 8000`. 예약 스위치는 로컬 `config.json`에서만 켜고 커밋하지 않는다.
- **커밋 메시지는 한국어**, Conventional Commits, 본문에 Why/What. `Co-Authored-By` 금지.

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `reservations.js` | 이력 조회·요약·월별 그리드 순수 함수 추가 | 수정 |
| `reservations.test.mjs` | 위 함수 테스트 | 수정 |
| `manage.html` | 탭 골격, 세대 이력 배지, 달력 탭, 지난 예약 탭 | 수정 |

새 파일은 없다. 계산은 `reservations.js`에 모으고 화면은 `manage.html` 하나에 둔다 — 이 프로젝트가 페이지마다 CSS/JS를 인라인으로 두는 관례를 따른다.

---

### Task 1: 이력 조회·요약 순수 함수

**Files:**
- Modify: `reservations.js`
- Test: `reservations.test.mjs`

**Interfaces:**
- Consumes: `occupiedNights(row)` (기존)
- Produces:
  - `findByHousehold(rows, dong, ho)` → `[row]` 최신순, 취소 포함
  - `findByName(rows, query)` → `[row]` 최신순, 취소 포함, 부분 일치
  - `summarize(rows, months, now)` → `{ count, nights }` 최근 N개월, 취소 제외

- [ ] **Step 1: 실패하는 테스트 작성**

`reservations.test.mjs` 끝에 추가한다. import 줄에 `findByHousehold, findByName, summarize`를 더한다.

```js
// ---- 이용 이력 ----

// 테스트용 예약 목록. 날짜는 고정값이라 오늘이 언제든 결과가 같다.
const HISTORY = [
  { id: '1', house: 'a', check_in: '2026-01-05', check_out: '2026-01-06', name: '홍길동', unit_dong: '101', unit_ho: '1201', status: 'confirmed' },
  { id: '2', house: 'b', check_in: '2026-03-10', check_out: '2026-03-12', name: '홍길동', unit_dong: '101', unit_ho: '1201', status: 'confirmed' },
  { id: '3', house: 'a', check_in: '2025-12-20', check_out: '2025-12-22', name: '홍길동', unit_dong: '101', unit_ho: '1201', status: 'cancelled' },
  { id: '4', house: 'a', check_in: '2026-02-01', check_out: '2026-02-02', name: '김철수', unit_dong: '102', unit_ho: '303', status: 'confirmed' },
];

test('findByHousehold는 그 세대만 최신순으로 준다', () => {
  const rows = findByHousehold(HISTORY, '101', '1201');
  assert.deepEqual(rows.map((r) => r.id), ['2', '1', '3']);
});

test('findByHousehold는 취소된 예약도 포함한다', () => {
  // 이력이므로 취소도 보여준다. 요약(summarize)에서만 뺀다.
  const rows = findByHousehold(HISTORY, '101', '1201');
  assert.ok(rows.some((r) => r.status === 'cancelled'));
});

test('findByHousehold는 동과 호가 모두 맞아야 찾는다', () => {
  assert.deepEqual(findByHousehold(HISTORY, '101', '303'), []);
  assert.deepEqual(findByHousehold(HISTORY, '102', '303').map((r) => r.id), ['4']);
});

test('findByHousehold는 앞뒤 공백과 숫자 표기를 견딘다', () => {
  // 관리사무소가 ' 101 '처럼 입력할 수 있다.
  assert.equal(findByHousehold(HISTORY, ' 101 ', ' 1201 ').length, 3);
});

test('findByName은 부분 일치로 찾는다', () => {
  assert.deepEqual(findByName(HISTORY, '홍').map((r) => r.id), ['2', '1', '3']);
  assert.deepEqual(findByName(HISTORY, '철수').map((r) => r.id), ['4']);
});

test('findByName은 빈 검색어에 빈 결과를 준다', () => {
  // 빈 문자열이 모든 이름에 포함되므로, 그냥 두면 전체가 나온다.
  assert.deepEqual(findByName(HISTORY, ''), []);
  assert.deepEqual(findByName(HISTORY, '   '), []);
});

test('summarize는 최근 N개월의 횟수와 박수를 센다', () => {
  // 기준 2026-03-31에서 6개월 = 2025-09-30 이후.
  // 대상: 1(1박), 2(2박). 3은 취소라 제외.
  const now = new Date(2026, 2, 31);
  assert.deepEqual(summarize(findByHousehold(HISTORY, '101', '1201'), 6, now), { count: 2, nights: 3 });
});

test('summarize는 취소된 예약을 세지 않는다', () => {
  const only = [{ check_in: '2026-03-10', check_out: '2026-03-12', status: 'cancelled' }];
  assert.deepEqual(summarize(only, 6, new Date(2026, 2, 31)), { count: 0, nights: 0 });
});

test('summarize의 기간 경계', () => {
  const now = new Date(2026, 5, 15); // 2026-06-15, 6개월 전 = 2025-12-15
  const rows = [
    { check_in: '2025-12-15', check_out: '2025-12-16', status: 'confirmed' }, // 경계 당일: 포함
    { check_in: '2025-12-14', check_out: '2025-12-15', status: 'confirmed' }, // 하루 전: 제외
  ];
  assert.deepEqual(summarize(rows, 6, now), { count: 1, nights: 1 });
});

test('summarize는 빈 목록에 0을 준다', () => {
  assert.deepEqual(summarize([], 6, new Date(2026, 2, 31)), { count: 0, nights: 0 });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run (PowerShell): `node --test reservations.test.mjs`
Expected: FAIL — `findByHousehold is not a function`

- [ ] **Step 3: 구현**

`reservations.js`의 `nightStatus` 아래, `// ---- Supabase 호출 ----` 위에 넣는다.

```js
// ---- 이용 이력 ----
// 관리사무소가 승인할 때 "이 세대가 전에 얼마나 썼나"를 보기 위한 계산.
// 전체 예약 목록을 받아 클라이언트에서 거른다 — 하루 한 팀 규모라 연 최대
// 730건이고, 통째로 다뤄도 부담이 없다.

// 최신순(입실일 내림차순). 같은 날이면 순서는 상관없다.
function byCheckInDesc(a, b) {
  return String(b.check_in).localeCompare(String(a.check_in));
}

export function findByHousehold(rows, dong, ho) {
  const d = String(dong || '').trim();
  const h = String(ho || '').trim();
  if (!d || !h) return [];
  return (rows || [])
    .filter((r) => String(r.unit_dong).trim() === d && String(r.unit_ho).trim() === h)
    .sort(byCheckInDesc);
}

export function findByName(rows, query) {
  const q = String(query || '').trim();
  // 빈 검색어는 모든 이름에 포함되므로 그냥 두면 전체가 나온다. 빈 결과로 막는다.
  if (!q) return [];
  return (rows || [])
    .filter((r) => String(r.name || '').includes(q))
    .sort(byCheckInDesc);
}

// 최근 months개월의 이용 횟수와 박수. 취소된 예약은 실제로 쓰지 않은 것이므로 뺀다.
// now를 인자로 받는 이유는 테스트다 — 함수 안에서 new Date()를 부르면
// 기간 경계를 검증할 수 없다.
export function summarize(rows, months, now = new Date()) {
  const from = new Date(now.getFullYear(), now.getMonth() - months, now.getDate());
  let count = 0;
  let nights = 0;

  for (const row of rows || []) {
    if (row.status === 'cancelled') continue;
    const nightList = occupiedNights(row);
    if (nightList.length === 0) continue;
    // 입실일 기준으로 기간에 드는지 본다.
    const [y, m, d] = String(row.check_in).split('-').map(Number);
    if (new Date(y, m - 1, d) < from) continue;
    count += 1;
    nights += nightList.length;
  }
  return { count, nights };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test reservations.test.mjs`
Expected: PASS (26개)

- [ ] **Step 5: 커밋**

메시지:

```
feat: 세대별 이용 이력 조회와 요약 추가

Why:
- 관리사무소가 승인할 때 그 세대가 전에 얼마나 썼는지 확인할 방법이 없었다.

What:
- findByHousehold/findByName: 최신순, 취소 포함. 이력이므로 취소도 보여준다
- summarize: 최근 N개월 횟수와 박수. 취소는 실제로 쓰지 않은 것이라 제외한다
- 빈 검색어는 모든 이름에 포함되므로 빈 결과로 막는다. 그냥 두면 전체가 나온다
- 기준 시각을 인자로 받는다. 함수 안에서 new Date()를 부르면 기간 경계를
  테스트할 수 없다
```

---

### Task 2: 월별 그리드 순수 함수

**Files:**
- Modify: `reservations.js`
- Test: `reservations.test.mjs`

**Interfaces:**
- Consumes: `occupiedNights(row)` (기존)
- Produces: `monthGrid(rows, year, month)` → `Map<'YYYY-MM-DD', [row]>` (`month`는 0-11)

- [ ] **Step 1: 실패하는 테스트 작성**

import 줄에 `monthGrid`를 더하고 아래를 이어 붙인다.

```js
// ---- 월별 그리드 ----

test('monthGrid는 점유한 밤에만 예약을 넣는다', () => {
  const grid = monthGrid([
    { id: '1', check_in: '2026-03-10', check_out: '2026-03-12', status: 'confirmed' },
  ], 2026, 2); // 2 = 3월

  assert.deepEqual(grid.get('2026-03-10').map((r) => r.id), ['1']);
  assert.deepEqual(grid.get('2026-03-11').map((r) => r.id), ['1']);
  // 퇴실일은 다음 손님이 쓸 수 있으므로 비어 있어야 한다.
  assert.equal(grid.get('2026-03-12'), undefined);
});

test('monthGrid는 다른 달의 밤을 넣지 않는다', () => {
  // 1/31 입실 2/2 퇴실 = 1/31, 2/1 점유
  const rows = [{ id: '1', check_in: '2026-01-31', check_out: '2026-02-02', status: 'confirmed' }];

  const jan = monthGrid(rows, 2026, 0);
  assert.deepEqual([...jan.keys()], ['2026-01-31']);

  const feb = monthGrid(rows, 2026, 1);
  assert.deepEqual([...feb.keys()], ['2026-02-01']);
});

test('monthGrid는 같은 날 두 집을 함께 담는다', () => {
  const grid = monthGrid([
    { id: '1', house: 'a', check_in: '2026-03-10', check_out: '2026-03-11', status: 'confirmed' },
    { id: '2', house: 'b', check_in: '2026-03-10', check_out: '2026-03-11', status: 'pending' },
  ], 2026, 2);
  assert.deepEqual(grid.get('2026-03-10').map((r) => r.id).sort(), ['1', '2']);
});

test('monthGrid는 취소된 예약을 넣지 않는다', () => {
  const grid = monthGrid([
    { id: '1', check_in: '2026-03-10', check_out: '2026-03-11', status: 'cancelled' },
  ], 2026, 2);
  assert.equal(grid.size, 0);
});

test('monthGrid는 예약이 없으면 빈 Map', () => {
  assert.equal(monthGrid([], 2026, 2).size, 0);
  assert.equal(monthGrid(null, 2026, 2).size, 0);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test reservations.test.mjs`
Expected: FAIL — `monthGrid is not a function`

- [ ] **Step 3: 구현**

`summarize` 아래에 넣는다.

```js
// 그 달의 날짜별 예약 목록. 주민 달력이 쓰는 occupiedNights를 그대로 재사용한다 —
// 같은 함수를 쓰므로 두 화면의 점유 판정이 어긋날 수 없다.
// month는 0-11(Date와 같은 규칙).
export function monthGrid(rows, year, month) {
  const prefix = `${year}-${pad2(month + 1)}-`;
  const grid = new Map();

  for (const row of rows || []) {
    if (row.status === 'cancelled') continue;
    for (const night of occupiedNights(row)) {
      if (!night.startsWith(prefix)) continue;
      if (!grid.has(night)) grid.set(night, []);
      grid.get(night).push(row);
    }
  }
  return grid;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test reservations.test.mjs`
Expected: PASS (31개)

- [ ] **Step 5: 커밋**

메시지:

```
feat: 달력 관리 뷰용 월별 그리드 계산 추가

Why:
- 관리사무소가 이번 달 일정을 한눈에 보려면 날짜별로 예약을 묶어야 한다.

What:
- monthGrid(rows, year, month) -> Map<'YYYY-MM-DD', [row]>
- 주민 달력이 쓰는 occupiedNights를 그대로 재사용한다. 따로 구현하면 한쪽만
  고치는 사고가 나고 두 화면의 점유 판정이 어긋난다
- 반개구간이라 퇴실일에는 나타나지 않고, 월을 걸친 예약은 해당 월의 밤만 담는다
- 취소된 예약은 달력에 보이지 않는다
```

---

### Task 3: `manage.html` 탭 골격

기존 기능이 그대로 동작하는지 여기서 확인한다. 화면을 나누기만 하고 새 기능은 넣지 않는다.

**Files:**
- Modify: `manage.html`

**Interfaces:**
- Produces: `allRows` (모듈 스코프 배열, 마지막으로 받은 전체 예약), `showTab(name)`

- [ ] **Step 1: 탭 마크업 추가**

`<section id="listArea">` 안, `.toolbar` 바로 뒤에 탭을 넣고 기존 두 카드를 `#tabPending`으로 감싼다.

```html
<div class="tabs">
  <button class="tab active" data-tab="pending" type="button" id="tabPendingBtn">확인 필요</button>
  <button class="tab" data-tab="calendar" type="button" id="tabCalendarBtn">달력</button>
  <button class="tab" data-tab="history" type="button" id="tabHistoryBtn">지난 예약</button>
</div>

<div id="tabPending">
  <!-- 기존 '확인 필요' 카드와 '확정된 예약' 카드를 그대로 여기로 옮긴다 -->
</div>

<div id="tabCalendar" hidden></div>
<div id="tabHistory" hidden></div>
```

CSS를 `<style>` 끝에 더한다. `admin.html`의 탭 스타일과 같은 값을 쓴다.

```css
  .tabs { display: flex; background: #EAE8E1; border-radius: 14px; padding: 4px; margin-bottom: 16px; gap: 4px; }
  .tab { flex: 1; height: 44px; border: none; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer; font-family: inherit; background: transparent; color: #7A8177; }
  .tab.active { background: #fff; color: #1F6D57; box-shadow: 0 1px 2px rgba(30,37,30,.08); }
```

- [ ] **Step 2: 탭 전환과 전체 목록 보관**

`loadList()`가 받은 행을 모듈 스코프에 남긴다. 달력·검색이 같은 데이터를 쓴다.

```js
let allRows = [];   // 마지막으로 받은 전체 예약(취소 포함)
let activeTab = 'pending';

function showTab(name) {
  activeTab = name;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $('tabPending').hidden = name !== 'pending';
  $('tabCalendar').hidden = name !== 'calendar';
  $('tabHistory').hidden = name !== 'history';
  if (name === 'calendar') renderCalendar();
}

$('tabPendingBtn').addEventListener('click', () => showTab('pending'));
$('tabCalendarBtn').addEventListener('click', () => showTab('calendar'));
$('tabHistoryBtn').addEventListener('click', () => showTab('history'));
```

`loadList()`의 `.then((rows) => {` 첫 줄에 추가한다.

```js
      allRows = rows;
```

그리고 `loadList()`가 끝날 때 현재 탭을 다시 그리도록 `.then` 마지막에 넣는다.

```js
      if (activeTab === 'calendar') renderCalendar();
      if (activeTab === 'history') renderHistory();
```

`renderCalendar`와 `renderHistory`는 Task 5·6에서 만든다. 이 단계에서는 빈 함수를 둔다.

```js
function renderCalendar() { /* Task 5 */ }
function renderHistory() { /* Task 6 */ }
```

- [ ] **Step 3: 구문 확인**

PowerShell:

```powershell
$tmp = "$env:TEMP\check.mjs"
$m = [regex]::Match((Get-Content manage.html -Raw), '(?s)<script type="module">(.*?)</script>')
[System.IO.File]::WriteAllText($tmp, $m.Groups[1].Value, (New-Object System.Text.UTF8Encoding $false))
node --check $tmp
```

- [ ] **Step 4: 버튼 연결 테스트**

Run: `node --test wiring.test.mjs`
Expected: PASS — 새 탭 버튼 셋도 자동으로 검사된다. 실패하면 리스너를 빠뜨린 것이다.

- [ ] **Step 5: 수동 확인**

`python -m http.server 8000` 후 `http://localhost:8000/manage.html`

- 로그인 후 "확인 필요" 탭이 기본으로 열려 있고 **기존과 똑같이** 동작하는가
- 확정·취소·신청서 버튼이 그대로 되는가
- 달력·지난 예약 탭은 아직 비어 있다(정상)

- [ ] **Step 6: 커밋**

메시지:

```
refactor: 관리사무소 화면을 탭으로 나눔

Why:
- 달력과 지난 예약을 더하려면 화면을 나눠야 한다. 다만 종이 장부를 쓰던 분들이
  대상이라 기본 화면은 지금과 같아야 한다.

What:
- 탭 셋(확인 필요·달력·지난 예약). 기본은 확인 필요라 탭을 누르지 않으면
  기존과 완전히 동일하게 동작한다
- loadList가 받은 전체 예약을 allRows에 보관해 달력·검색이 같은 데이터를 쓴다
- 탭 스타일은 admin.html과 같은 값을 쓴다. 새 디자인을 만들지 않는다
```

---

### Task 4: 세대 이용 이력 배지

**Files:**
- Modify: `manage.html`

**Interfaces:**
- Consumes: `findByHousehold`, `summarize` (Task 1), `allRows` (Task 3)

- [ ] **Step 1: import와 상수 추가**

import 줄에 더한다.

```js
import { signIn, listReservations, setStatus, findByHousehold, findByName, summarize, monthGrid } from './reservations.js';
```

상수를 둔다.

```js
// 배지에 쓰는 기간. 이용 횟수 제한이 없어 판단 기준이 아니라 참고용이므로
// 설정으로 빼지 않는다. 다른 기간을 보고 싶다는 요청이 오면 그때 옮긴다.
const HISTORY_MONTHS = 6;
```

- [ ] **Step 2: CSS 추가**

```css
  .res-history { margin-top: 12px; padding-top: 12px; border-top: 1px solid #F0EEE7; }
  .res-history-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .res-history-sum { font-size: 14px; color: #3C443B; }
  .res-history-sum strong { font-weight: 700; }
  .res-history-toggle { border: none; background: none; color: #1F6D57; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; padding: 4px; }
  .res-history-list { margin-top: 10px; font-size: 13px; color: #7A8177; line-height: 1.8; }
  .res-history-list div { display: flex; justify-content: space-between; gap: 10px; }
  .res-history-list .cancelled { text-decoration: line-through; color: #B9BDB4; }
```

- [ ] **Step 3: 배지를 카드에 붙인다**

`renderRow()`의 금액 표시(`res-money`) 다음, `res-actions` 앞에 넣는다.

```js
  box.appendChild(buildHistory(row));
```

`renderRow` 아래에 함수를 더한다.

```js
// 이 세대가 전에 얼마나 썼는지. 승인 판단을 이 자리에서 끝내기 위한 것이라
// 검색 탭으로 옮기지 않는다.
function buildHistory(row) {
  const wrap = el('div', 'res-history');
  const past = findByHousehold(allRows, row.unit_dong, row.unit_ho)
    .filter((r) => r.id !== row.id); // 지금 보고 있는 건은 이력이 아니다
  const sum = summarize(past, HISTORY_MONTHS);

  const head = el('div', 'res-history-head');
  const text = el('div', 'res-history-sum');
  text.innerHTML = sum.count === 0
    ? `이 세대 최근 ${HISTORY_MONTHS}개월 <strong>이용 없음</strong>`
    : `이 세대 최근 ${HISTORY_MONTHS}개월 <strong>${sum.count}회 · ${sum.nights}박</strong>`;
  head.appendChild(text);

  if (past.length > 0) {
    const toggle = el('button', 'res-history-toggle', { type: 'button', textContent: '이력 보기' });
    const list = el('div', 'res-history-list');
    list.hidden = true;

    for (const r of past) {
      const line = el('div', r.status === 'cancelled' ? 'cancelled' : null);
      line.appendChild(el('span', null, { textContent: `${r.check_in} ~ ${r.check_out}` }));
      line.appendChild(el('span', null, {
        textContent: `${houseLabel(r.house)} · ${countNights(r.check_in, r.check_out)}박`
          + (r.status === 'cancelled' ? ' · 취소' : ''),
      }));
      list.appendChild(line);
    }

    toggle.addEventListener('click', () => {
      list.hidden = !list.hidden;
      toggle.textContent = list.hidden ? '이력 보기' : '접기';
    });
    head.appendChild(toggle);
    wrap.appendChild(head);
    wrap.appendChild(list);
  } else {
    wrap.appendChild(head);
  }

  return wrap;
}
```

- [ ] **Step 4: 구문 확인과 테스트**

```powershell
$tmp = "$env:TEMP\check.mjs"
$m = [regex]::Match((Get-Content manage.html -Raw), '(?s)<script type="module">(.*?)</script>')
[System.IO.File]::WriteAllText($tmp, $m.Groups[1].Value, (New-Object System.Text.UTF8Encoding $false))
node --check $tmp
node --test wiring.test.mjs calc.test.mjs config.test.mjs github.test.mjs reservations.test.mjs
```

- [ ] **Step 5: 수동 확인**

같은 세대(같은 동·호)로 예약을 두 건 이상 넣고 하나를 확정한 뒤 본다.

- 대기 카드에 `이 세대 최근 6개월 1회 · 2박`이 뜨는가
- 이력이 없는 세대는 `이용 없음`이 뜨고 "이력 보기" 버튼이 없는가
- "이력 보기"를 누르면 지난 예약이 펼쳐지고 버튼이 "접기"로 바뀌는가
- **지금 보고 있는 신청 자신은 이력에 안 들어가는가**
- 취소된 예약이 취소선으로 보이는가

- [ ] **Step 6: 커밋**

메시지:

```
feat: 승인 카드에 세대 이용 이력 배지 추가

Why:
- 승인할 때마다 검색창을 열어 동·호수를 입력하고 찾는 것은 번거롭다. 승인은
  매번 하는 일이고 검색은 따로 찾아 들어가는 일이다.

What:
- 대기·확정 카드에 '이 세대 최근 6개월 N회 · N박' 요약과 펼치기 추가
- 지금 보고 있는 건 자신은 이력에서 뺀다
- 요약은 취소를 세지 않고, 펼친 목록에는 취소도 취소선으로 보여준다.
  요약은 '실제로 얼마나 썼나'이고 목록은 이력이라 목적이 다르다
- 기간 6개월은 상수로 둔다. 이용 횟수 제한이 없어 판단 기준이 아니라 참고용이다
```

---

### Task 5: 달력 탭

**Files:**
- Modify: `manage.html`

**Interfaces:**
- Consumes: `monthGrid` (Task 2), `allRows`·`showTab` (Task 3), `renderRow` (기존)

- [ ] **Step 1: 마크업**

`<div id="tabCalendar" hidden>` 안을 채운다.

```html
<div class="card">
  <div class="cal-head">
    <button type="button" class="cal-nav" id="calPrev" aria-label="이전 달">‹</button>
    <div class="cal-label" id="calLabel"></div>
    <button type="button" class="cal-nav" id="calNext" aria-label="다음 달">›</button>
  </div>
  <div class="cal-week">
    <span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span>
  </div>
  <div class="cal-grid" id="calGrid"></div>
  <div class="cal-legend">
    <span><i class="dot confirmed"></i> 확정</span>
    <span><i class="dot pending"></i> 확인 필요</span>
  </div>
</div>

<div class="card" id="dayCard" hidden>
  <h2 id="dayTitle"></h2>
  <div id="dayList"></div>
</div>
```

- [ ] **Step 2: CSS**

색은 1단계에서 쓰는 값 그대로다. 새로 만들지 않는다.

```css
  .cal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .cal-nav { width: 40px; height: 40px; border: none; background: #F5F4F0; border-radius: 10px; font-size: 18px; font-weight: 700; color: #3C443B; cursor: pointer; font-family: inherit; }
  .cal-nav:hover { background: #EAE8E1; }
  .cal-label { font-size: 17px; font-weight: 700; }
  .cal-week { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; font-size: 12px; color: #7A8177; margin-bottom: 4px; }
  .cal-week span:first-child { color: #C0392B; }
  .cal-week span:last-child { color: #2E5AA8; }
  .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
  .cal-blank { min-height: 62px; }
  .cal-day {
    min-height: 62px; border: none; background: none; border-radius: 8px; padding: 5px 3px;
    font-family: inherit; font-size: 13px; color: #1E251E; cursor: pointer;
    display: flex; flex-direction: column; align-items: stretch; gap: 2px; overflow: hidden;
  }
  .cal-day:hover { background: #F5F4F0; }
  .cal-day.sun { color: #C0392B; }
  .cal-day.sat { color: #2E5AA8; }
  .cal-day.today { box-shadow: inset 0 0 0 1.5px #1F6D57; }
  .cal-day .num { text-align: center; }
  .chip {
    font-size: 10px; line-height: 15px; border-radius: 3px; padding: 0 3px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left;
  }
  .chip.confirmed { background: #EAF3EF; color: #1F6D57; }
  .chip.pending { background: #FDF3E7; color: #7A5A22; }
  .cal-legend { display: flex; justify-content: center; gap: 16px; margin-top: 12px; font-size: 12px; color: #7A8177; }
  .cal-legend span { display: flex; align-items: center; gap: 5px; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 3px; }
  .dot.confirmed { background: #EAF3EF; box-shadow: inset 0 0 0 1px #1F6D57; }
  .dot.pending { background: #FDF3E7; box-shadow: inset 0 0 0 1px #7A5A22; }
```

- [ ] **Step 3: 렌더링**

`renderCalendar()`의 빈 자리를 채운다.

```js
let calYear = 0;
let calMonth = 0;   // 0-11
let pickedDay = ''; // 'YYYY-MM-DD'

function renderCalendar() {
  // 처음 열 때는 이번 달부터 본다.
  if (!calYear) {
    const t = new Date();
    calYear = t.getFullYear();
    calMonth = t.getMonth();
  }

  const grid = $('calGrid');
  $('calLabel').textContent = `${calYear}년 ${calMonth + 1}월`;
  grid.textContent = '';

  const cells = monthGrid(allRows, calYear, calMonth);
  const firstWeekday = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date();

  for (let i = 0; i < firstWeekday; i++) grid.appendChild(el('span', 'cal-blank'));

  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dow = new Date(calYear, calMonth, d).getDay();

    const btn = el('button', 'cal-day', { type: 'button' });
    if (dow === 0) btn.classList.add('sun');
    if (dow === 6) btn.classList.add('sat');
    if (today.getFullYear() === calYear && today.getMonth() === calMonth && today.getDate() === d) {
      btn.classList.add('today');
    }
    btn.appendChild(el('div', 'num', { textContent: String(d) }));

    for (const r of cells.get(key) || []) {
      btn.appendChild(el('div', `chip ${r.status}`, {
        textContent: `${houseLabel(r.house)} ${r.name}`,
        title: `${houseLabel(r.house)} ${r.name} (${r.unit_dong}동 ${r.unit_ho}호)`,
      }));
    }

    btn.addEventListener('click', () => showDay(key));
    grid.appendChild(btn);
  }

  if (pickedDay && pickedDay.startsWith(`${calYear}-${String(calMonth + 1).padStart(2, '0')}-`)) {
    showDay(pickedDay);
  } else {
    pickedDay = '';
    $('dayCard').hidden = true;
  }
}

// 칸을 누르면 그날 예약을 아래에 펼친다. 확정·취소·신청서 출력이 거기서 된다.
function showDay(key) {
  pickedDay = key;
  const rows = monthGrid(allRows, calYear, calMonth).get(key) || [];
  const [, m, d] = key.split('-').map(Number);

  $('dayTitle').textContent = `${m}월 ${d}일 · ${rows.length}건`;
  const host = $('dayList');
  host.textContent = '';
  if (rows.length === 0) host.appendChild(el('div', 'empty', { textContent: '이 날은 예약이 없습니다.' }));
  rows.forEach((r) => renderRow(r, host));
  $('dayCard').hidden = false;
}

$('calPrev').addEventListener('click', () => {
  calMonth -= 1;
  if (calMonth < 0) { calMonth = 11; calYear -= 1; }
  renderCalendar();
});
$('calNext').addEventListener('click', () => {
  calMonth += 1;
  if (calMonth > 11) { calMonth = 0; calYear += 1; }
  renderCalendar();
});
```

- [ ] **Step 4: 구문 확인과 테스트**

```powershell
$tmp = "$env:TEMP\check.mjs"
$m = [regex]::Match((Get-Content manage.html -Raw), '(?s)<script type="module">(.*?)</script>')
[System.IO.File]::WriteAllText($tmp, $m.Groups[1].Value, (New-Object System.Text.UTF8Encoding $false))
node --check $tmp
node --test wiring.test.mjs
```

- [ ] **Step 5: 수동 확인**

- 달력 탭에 이번 달이 뜨고 예약이 있는 날에 이름표가 보이는가
- 확정은 초록, 대기는 노랑인가
- **3월 10일 입실 12일 퇴실이면 10·11일에만 보이고 12일은 비어 있는가**
- 칸을 누르면 아래에 그날 예약이 펼쳐지고, 거기서 확정·취소가 되는가
- 확정하면 달력 색이 바뀌는가
- 이전/다음 달 이동이 되는가
- 오늘 날짜에 테두리가 있는가

- [ ] **Step 6: 커밋**

메시지:

```
feat: 관리사무소 달력 탭 추가

Why:
- 목록은 시간순이라 '이번 달 일정'을 파악하려면 줄줄이 읽어야 했다.
  청소나 열쇠 준비 일정을 잡을 때 쓸모가 없었다.

What:
- 날짜 칸에 집별로 예약자 이름표. 확정은 초록, 대기는 노랑
- 칸을 누르면 아래에 그날 예약이 펼쳐지고 거기서 확정·취소·신청서 출력이 된다
- 색은 1단계에서 쓰던 값을 그대로 쓴다. 대기 카드에서 본 노랑을 달력에서
  다시 만나면 설명 없이 알아본다
- 점유 판정은 주민 달력과 같은 occupiedNights를 쓴다. 퇴실일은 비어 있다
- 취소된 예약은 달력에 보이지 않는다
```

---

### Task 6: 지난 예약 탭

**Files:**
- Modify: `manage.html`

**Interfaces:**
- Consumes: `findByHousehold`, `findByName`, `summarize` (Task 1), `allRows` (Task 3)

- [ ] **Step 1: 마크업**

`<div id="tabHistory" hidden>` 안을 채운다.

```html
<div class="card">
  <h2>세대로 찾기</h2>
  <div class="search-row">
    <input type="text" id="qDong" inputmode="numeric" placeholder="동" maxlength="4">
    <span class="dash">-</span>
    <input type="text" id="qHo" inputmode="numeric" placeholder="호" maxlength="3">
    <button type="button" class="btn btn-secondary" id="searchUnitBtn">찾기</button>
  </div>

  <h2 style="margin-top:20px;">이름으로 찾기</h2>
  <div class="search-row">
    <input type="text" id="qName" placeholder="성명">
    <button type="button" class="btn btn-secondary" id="searchNameBtn">찾기</button>
  </div>
</div>

<div class="card" id="resultCard" hidden>
  <h2 id="resultTitle"></h2>
  <div id="resultList"></div>
</div>
```

- [ ] **Step 2: CSS**

```css
  .search-row { display: flex; align-items: center; gap: 8px; }
  .search-row input { flex: 1; min-width: 0; height: 46px; border: 1px solid #DDDBD2; border-radius: 10px; padding: 0 12px; font-size: 16px; font-family: inherit; color: #1E251E; background: #fff; }
  .search-row .dash { color: #9A9F92; font-weight: 600; }
  .search-row .btn { flex: 0 0 auto; height: 46px; }
  .hist-row { display: flex; justify-content: space-between; gap: 12px; padding: 11px 0; border-bottom: 1px solid #F0EEE7; font-size: 14px; }
  .hist-row:last-child { border-bottom: none; }
  .hist-row.cancelled { color: #B9BDB4; }
  .hist-row.cancelled .when { text-decoration: line-through; }
  .hist-when { min-width: 0; }
  .hist-what { flex: 0 0 auto; color: #7A8177; }
```

- [ ] **Step 3: 검색 구현**

`renderHistory()`의 빈 자리를 채우고 아래를 더한다.

```js
let lastSearch = null; // { kind: 'unit'|'name', a, b } — 목록 갱신 후 같은 결과를 다시 그린다

function renderHistory() {
  if (!lastSearch) { $('resultCard').hidden = true; return; }
  if (lastSearch.kind === 'unit') searchUnit(lastSearch.a, lastSearch.b);
  else searchName(lastSearch.a);
}

function searchUnit(dong, ho) {
  const rows = findByHousehold(allRows, dong, ho);
  if (!String(dong || '').trim() || !String(ho || '').trim()) {
    showToast('동과 호를 모두 입력해 주세요.');
    return;
  }
  lastSearch = { kind: 'unit', a: dong, b: ho };
  const sum = summarize(rows, HISTORY_MONTHS);
  showResult(
    `${String(dong).trim()}동 ${String(ho).trim()}호 · 총 ${rows.length}건`
      + ` (최근 ${HISTORY_MONTHS}개월 ${sum.count}회 · ${sum.nights}박)`,
    rows
  );
}

function searchName(query) {
  const q = String(query || '').trim();
  if (!q) { showToast('이름을 입력해 주세요.'); return; }
  lastSearch = { kind: 'name', a: q };
  const rows = findByName(allRows, q);
  showResult(`'${q}' · ${rows.length}건`, rows);
}

function showResult(title, rows) {
  $('resultTitle').textContent = title;
  const host = $('resultList');
  host.textContent = '';

  if (rows.length === 0) {
    host.appendChild(el('div', 'empty', { textContent: '찾은 예약이 없습니다.' }));
  }

  const STATUS = { pending: '확인 필요', confirmed: '확정', cancelled: '취소됨' };
  for (const r of rows) {
    const line = el('div', `hist-row${r.status === 'cancelled' ? ' cancelled' : ''}`);
    line.appendChild(el('div', 'hist-when when', {
      textContent: `${r.check_in} ~ ${r.check_out} · ${r.name} (${r.unit_dong}동 ${r.unit_ho}호)`,
    }));
    line.appendChild(el('div', 'hist-what', {
      textContent: `${houseLabel(r.house)} · ${countNights(r.check_in, r.check_out)}박 · ${STATUS[r.status] || r.status}`,
    }));
    host.appendChild(line);
  }
  $('resultCard').hidden = false;
}

$('searchUnitBtn').addEventListener('click', () => searchUnit($('qDong').value, $('qHo').value));
$('searchNameBtn').addEventListener('click', () => searchName($('qName').value));
$('qHo').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('searchUnitBtn').click(); });
$('qName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('searchNameBtn').click(); });
```

- [ ] **Step 4: 구문 확인과 테스트**

```powershell
$tmp = "$env:TEMP\check.mjs"
$m = [regex]::Match((Get-Content manage.html -Raw), '(?s)<script type="module">(.*?)</script>')
[System.IO.File]::WriteAllText($tmp, $m.Groups[1].Value, (New-Object System.Text.UTF8Encoding $false))
node --check $tmp
node --test wiring.test.mjs calc.test.mjs config.test.mjs github.test.mjs reservations.test.mjs
```

- [ ] **Step 5: 수동 확인**

- 동·호를 넣고 찾으면 그 세대 예약이 최신순으로 나오는가
- 제목에 `총 N건 (최근 6개월 N회 · N박)`이 뜨는가
- 취소된 예약이 취소선으로 보이는가
- 이름 일부(예: '홍')로 찾아지는가
- 동만 넣고 찾으면 안내가 뜨는가
- 빈 이름으로 찾으면 안내가 뜨는가
- Enter로 검색이 되는가

- [ ] **Step 6: 커밋**

메시지:

```
feat: 지난 예약 검색 탭 추가

Why:
- 승인 카드의 배지가 주 경로지만, 전화 문의처럼 신청과 무관하게 찾아볼 때가 있다.

What:
- 세대(동·호)로 찾기와 이름 부분 일치로 찾기
- 결과는 최신순. 취소된 예약도 취소선으로 함께 보여준다. 이력이기 때문이다
- 세대 검색 제목에 최근 6개월 요약을 함께 띄운다
- 동만 넣거나 이름이 비면 안내한다. 빈 검색어는 findByName이 빈 결과로 막지만
  사용자에게는 왜 안 나오는지 알려야 한다
- 목록을 새로 받으면 마지막 검색을 다시 그린다. 확정·취소 후에도 보던 결과가 유지된다
```

---

### Task 7: 문서 갱신

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 관리사무소 절에 탭 설명 추가**

`## 관리사무소 (manage.html)` 절의 목록 뒤에 넣는다.

```markdown
화면은 탭 셋으로 나뉩니다. 기본은 "확인 필요"라 탭을 누르지 않으면 예전과 똑같습니다.

| 탭 | 무엇을 |
|---|---|
| 확인 필요 | 대기 신청과 확정된 예약. 확정·취소·신청서 출력 |
| 달력 | 이번 달 일정을 한눈에. 날짜를 누르면 그날 예약이 펼쳐집니다 |
| 지난 예약 | 세대(동·호)나 이름으로 지난 예약 찾기 |

각 신청 카드에는 그 세대의 최근 6개월 이용 이력이 함께 표시됩니다. "이력 보기"를
누르면 지난 예약이 펼쳐집니다. 이용 횟수 제한은 없으므로 참고용 숫자입니다.
```

- [ ] **Step 2: 테스트 실행 줄 확인**

`## 개발` 절의 명령이 새 테스트를 포함하는지 본다. `reservations.test.mjs`는 이미 들어 있으므로 변경이 없어야 한다. 없으면 추가한다.

- [ ] **Step 3: 전체 테스트**

```powershell
node --test wiring.test.mjs calc.test.mjs config.test.mjs github.test.mjs reservations.test.mjs
```

Expected: 전부 통과

- [ ] **Step 4: 커밋**

메시지:

```
docs: 관리사무소 화면 탭 구성 설명 추가

Why:
- 화면이 탭 셋으로 나뉘고 세대 이력 배지가 생겼는데 README는 목록 하나만
  설명하고 있었다.

What:
- 탭별 역할 표와 세대 이력 배지 설명 추가
- 이용 횟수 제한이 없어 참고용 숫자라는 점을 명시
```

---

## Self-Review

**1. 스펙 대응**

| 설계 문서 요구사항 | 담당 Task |
|---|---|
| 검색보다 배지를 앞세운다 | 4 |
| 대기 카드에 세대 이력 요약 | 4 |
| `[이력 ▾]` 펼치기 | 4 |
| 탭 셋, 기본은 확인 필요 | 3 |
| 달력에 집별 이름표 | 5 |
| 칸을 누르면 그날 상세 펼침 | 5 |
| 확정=초록/대기=노랑, 새 색 금지 | 5 (CSS에 값 명시) |
| 취소는 달력에 안 보임 | 2 (`monthGrid`), 5 |
| 반개구간 | 2 (`monthGrid`가 `occupiedNights` 재사용) |
| 세대·이름 검색 | 6 |
| 검색 결과에 취소 포함 | 1 (`findByHousehold`), 6 |
| 요약은 취소 제외 | 1 (`summarize`) |
| 서버 변경 없음 | 전체 — SQL 없음 |
| 순수 함수 넷 | 1, 2 |
| 배지 기간 6개월 상수 | 4 (`HISTORY_MONTHS`) |
| 메모·통계·엑셀 비목표 | 없음 (의도적) |
| `wiring.test.mjs`가 새 버튼 검사 | 3 Step 4 |

빠진 것 없음.

**2. 플레이스홀더 점검**

Task 3 Step 1의 "기존 두 카드를 그대로 여기로 옮긴다"는 코드 대신 지시다. 옮길 대상이 현재 파일에 그대로 있고 내용을 바꾸지 않으므로 코드를 다시 적는 것이 오히려 오류를 부른다. Task 3 Step 2에 빈 `renderCalendar`/`renderHistory`를 두라고 명시해 Task 5·6 전에도 구문이 성립한다.

그 외 코드가 필요한 단계에는 실제 코드를 넣었다.

**3. 이름 일관성**

- `allRows`: Task 3에서 만들고 4·5·6이 읽는다
- `showTab(name)`: Task 3. `'pending' | 'calendar' | 'history'`
- `renderCalendar()`·`renderHistory()`: Task 3에서 빈 함수로 선언, 5·6에서 채운다
- `HISTORY_MONTHS`: Task 4에서 선언, 6에서도 쓴다
- `findByHousehold`·`findByName`·`summarize`: Task 1 정의, 4·6에서 사용
- `monthGrid(rows, year, month)`: Task 2 정의(`month`는 0-11), 5에서 사용
- `renderRow(row, host)`·`houseLabel(id)`·`el(tag, cls, props)`·`showToast(msg)`·`countNights`: 1단계에 이미 있는 것을 그대로 쓴다
- `.empty` 클래스는 1단계 CSS에 이미 있다 — Task 5·6이 재사용한다

**4. 실행 순서 주의**

Task 3이 Task 5·6이 채울 빈 함수를 만든다. 순서를 건너뛰면 `renderCalendar is not defined`가 난다. Task 1·2는 순수 함수라 화면 없이 끝낼 수 있다.
