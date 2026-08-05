# 신청서 생성 건수 텔레그램 일일 알림 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 주민이 신청서 이미지를 만들 때마다 Supabase 카운터를 올리고, 매일 아침 GitHub Actions가 어제 건수를 텔레그램으로 보낸다.

**Architecture:** 브라우저는 `security definer` RPC(`bump_usage`) 하나만 부른다 — 개인정보를 보내지 않고, `await` 하지 않으며, 실패해도 조용히 삼킨다. Supabase는 하루 1행짜리 `usage_daily` 테이블에 숫자만 쌓는다. 발송은 GitHub Actions가 맡아 봇 토큰이 브라우저에 절대 들어가지 않는다.

**Tech Stack:** 정적 HTML + ES 모듈, Supabase(PostgREST·plpgsql), GitHub Actions, Node 20 내장 `fetch`, `node --test`

설계 문서: `docs/superpowers/specs/2026-08-05-usage-telegram-design.md`

## Global Constraints

- 새 npm 의존성을 추가하지 않는다. Node 20 내장 `fetch`만 쓴다.
- 집계 호출은 절대 `await` 하지 않고 실패를 무시한다. 신청서 만들기 흐름을 막으면 안 된다.
- 서버로 개인정보(이름·동호수·연락처)를 보내지 않는다. 보내는 값은 `'typed'` / `'hand'` 두 문자열뿐이다.
- 날짜는 전부 **Asia/Seoul 기준**이다. `current_date`(UTC)나 `new Date().toISOString()`을 그대로 쓰지 않는다.
- `service_role` 키를 쓰지 않는다. Actions도 `config.json`의 공개 `anonKey`를 쓴다.
- `draw.html` 안의 코드는 기존 `var`/`function` 스타일을 따른다. `index.html`은 `const`/화살표 함수를 쓴다.
- 테스트는 순수 함수만 자동화한다. `fetch`를 타는 코드는 테스트하지 않는다.
- 커밋 메시지는 한국어 Conventional Commits이며 본문에 Why/What을 적는다.

**커밋하는 법.** 이 저장소는 Windows/PowerShell에서 작업한다. PowerShell은 heredoc
(`git commit -m @'...'@`)을 지원하지 않아 여러 줄 메시지가 깨진다. 각 Task의 메시지
블록을 **저장소 밖 임시 파일**에 저장한 뒤 파일에서 읽힌다.

```powershell
# 예: 메시지를 $env:TEMP\msg.txt 에 저장한 뒤
git add <파일들>
git commit -F "$env:TEMP\msg.txt"
```

임시 파일은 저장소 안에 만들지 않는다 — 실수로 커밋된다.

---

### Task 1: Supabase 스키마와 RPC

**Files:**
- 없음 (사람이 Supabase SQL Editor에서 실행한다)

**Interfaces:**
- Consumes: 없음
- Produces: RPC `bump_usage(p_source text) returns void`, RPC `get_usage(p_day date) returns table(day date, typed int, hand int)`. 둘 다 `anon`에 `execute` 권한이 있다.

- [ ] **Step 1: Supabase SQL Editor에 아래 전체를 붙여넣고 실행**

```sql
create table if not exists usage_daily (
  day   date primary key,
  typed int not null default 0,   -- index.html (타이핑)
  hand  int not null default 0    -- draw.html  (손글씨)
);

-- 정책을 하나도 만들지 않는다 = anon은 이 테이블을 직접 읽지도 쓰지도 못한다.
-- 접근은 아래 두 함수(security definer)를 통해서만 열린다.
alter table usage_daily enable row level security;

-- current_date는 UTC라 한국 시간 저녁 9시 이후 건이 다음 날로 밀린다.
create or replace function bump_usage(p_source text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_source not in ('typed', 'hand') then
    raise exception 'unknown source: %', p_source;
  end if;

  insert into usage_daily (day, typed, hand)
  values (
    (now() at time zone 'Asia/Seoul')::date,
    case when p_source = 'typed' then 1 else 0 end,
    case when p_source = 'hand'  then 1 else 0 end
  )
  on conflict (day) do update
    set typed = usage_daily.typed + excluded.typed,
        hand  = usage_daily.hand  + excluded.hand;
end $$;

-- 그날 기록이 없으면 0행을 돌려준다. 부르는 쪽이 0으로 해석한다.
create or replace function get_usage(p_day date)
returns table (day date, typed int, hand int)
language sql
security definer
set search_path = public
as $$
  select u.day, u.typed, u.hand from usage_daily u where u.day = p_day;
$$;

grant execute on function bump_usage(text) to anon;
grant execute on function get_usage(date) to anon;
```

- [ ] **Step 2: 카운터가 더해지는지 확인**

```sql
select bump_usage('typed');
select bump_usage('typed');
select bump_usage('hand');
select * from usage_daily;
```

기대: 오늘 날짜 1행, `typed = 2`, `hand = 1`.

- [ ] **Step 2-1: 날짜가 한국 기준인지 확인**

```sql
select (now() at time zone 'Asia/Seoul')::date as seoul_today,
       current_date                            as utc_today,
       (select day from usage_daily limit 1)   as recorded;
```

기대: `recorded`가 `seoul_today`와 같다.

한국 시간 오전 9시 이전에 실행하면 `seoul_today`와 `utc_today`가 **다르게** 나오고,
그때 `recorded`가 `utc_today`를 따라갔다면 함수가 `current_date`를 쓰고 있는 것이다.
낮에 실행하면 둘이 같아서 이 검사가 아무것도 못 잡는다 — 그럴 때는 함수 본문에
`at time zone 'Asia/Seoul'`이 들어 있는지 눈으로 확인한다.

```sql
select prosrc from pg_proc where proname = 'bump_usage';
```

- [ ] **Step 3: 모르는 source가 거부되는지 확인**

```sql
select bump_usage('admin');
```

기대: `ERROR: unknown source: admin`

- [ ] **Step 4: 조회 함수 확인**

```sql
select * from get_usage((now() at time zone 'Asia/Seoul')::date);
select * from get_usage('2020-01-01');
```

기대: 첫 줄은 1행(`typed = 2`, `hand = 1`), 둘째 줄은 **0행**.

- [ ] **Step 5: 테이블 직접 접근이 막혔는지 확인**

Supabase SQL Editor는 관리자 권한이라 이 검사가 통과해 버린다. 터미널에서 익명 키로 확인한다. `<URL>`·`<ANON_KEY>`는 `config.json`의 `reservation.url`·`reservation.anonKey` 값이다.

```bash
curl -s "<URL>/rest/v1/usage_daily?select=*" -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
```

기대: 빈 배열 `[]` 또는 권한 오류. **숫자가 보이면 RLS가 안 켜진 것이므로 Step 1을 다시 확인한다.**

- [ ] **Step 6: 시험 삼아 넣은 값 지우기**

```sql
delete from usage_daily;
```

---

### Task 2: `usage.js` 순수 요청 조립

**Files:**
- Create: `usage.js`
- Test: `usage.test.mjs`

**Interfaces:**
- Consumes: `reservations.js`의 `buildRequest(reservation, spec)` — `{ url, options }`를 돌려주는 순수 함수
- Produces:
  - `buildBumpRequest(reservation, source)` → `{ url, options }` 또는 `null`
  - `bumpUsage(reservation, source)` → `Promise<void>` (절대 reject 하지 않는다)

- [ ] **Step 1: 실패하는 테스트 작성**

`usage.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBumpRequest } from './usage.js';

const RES = { enabled: true, url: 'https://x.supabase.co', anonKey: 'KEY' };

test('타이핑 화면의 집계는 bump_usage RPC로 간다', () => {
  const { url, options } = buildBumpRequest(RES, 'typed');
  assert.equal(url, 'https://x.supabase.co/rest/v1/rpc/bump_usage');
  assert.equal(options.method, 'POST');
  assert.deepEqual(JSON.parse(options.body), { p_source: 'typed' });
});

test('손글씨 화면은 p_source가 hand다', () => {
  const { options } = buildBumpRequest(RES, 'hand');
  assert.deepEqual(JSON.parse(options.body), { p_source: 'hand' });
});

test('익명 키가 헤더에 실리고 응답 본문은 받지 않는다', () => {
  const { options } = buildBumpRequest(RES, 'typed');
  assert.equal(options.headers.apikey, 'KEY');
  assert.equal(options.headers.Authorization, 'Bearer KEY');
  assert.equal(options.headers['Content-Type'], 'application/json');
  // 익명 키는 결과를 읽을 수 없다. 굳이 받아오지 않는다.
  assert.equal(options.headers.Prefer, 'return=minimal');
});

test('예약 기능이 꺼져 있으면 요청을 만들지 않는다', () => {
  // enabled는 url·anonKey가 둘 다 있을 때만 참이다(config.js).
  assert.equal(buildBumpRequest({ enabled: false, url: 'https://x', anonKey: 'K' }, 'typed'), null);
  assert.equal(buildBumpRequest(null, 'typed'), null);
  assert.equal(buildBumpRequest(undefined, 'typed'), null);
});

test('모르는 source는 보내지 않는다', () => {
  // 서버도 거부하지만 오지 않을 요청을 보낼 이유가 없다.
  assert.equal(buildBumpRequest(RES, 'admin'), null);
  assert.equal(buildBumpRequest(RES, ''), null);
  assert.equal(buildBumpRequest(RES, undefined), null);
});
```

- [ ] **Step 2: 실패를 확인**

Run: `node --test usage.test.mjs`
Expected: FAIL — `Cannot find module ... usage.js`

- [ ] **Step 3: `usage.js` 작성**

```js
// 신청서 이미지가 몇 건 만들어졌는지만 센다.
// 이름·동호수 같은 개인정보는 보내지 않는다 — 보내는 값은 아래 두 문자열뿐이다.
//
// reservations.js와 같은 구조를 쓴다: 조립은 순수 함수로 빼서 테스트로 고정하고,
// fetch 한 줄만 테스트 밖에 남긴다.
import { buildRequest } from './reservations.js';

const SOURCES = ['typed', 'hand'];

// 보낼 수 없는 상태면 null. 부르는 쪽은 조용히 넘어간다.
export function buildBumpRequest(reservation, source) {
  if (!reservation || !reservation.enabled) return null;
  if (!SOURCES.includes(source)) return null;

  return buildRequest(reservation, {
    path: '/rest/v1/rpc/bump_usage',
    method: 'POST',
    body: { p_source: source },
    minimal: true,
  });
}

// 집계는 신청서를 만드는 흐름의 곁다리다. 네트워크가 죽어 있어도 주민은
// 아무 차이를 느끼지 않아야 하므로 실패를 삼키고 절대 reject 하지 않는다.
export function bumpUsage(reservation, source) {
  const req = buildBumpRequest(reservation, source);
  if (!req) return Promise.resolve();
  return fetch(req.url, req.options).then(() => {}, () => {});
}
```

- [ ] **Step 4: 통과를 확인**

Run: `node --test usage.test.mjs`
Expected: PASS (5개 테스트)

- [ ] **Step 5: 커밋**

```bash
git add usage.js usage.test.mjs
git commit -F "$env:TEMP\msg.txt"   # 아래 메시지를 이 파일에 먼저 저장한다
```

메시지:

```
feat: 신청서 생성 건수를 세는 집계 호출 추가

Why:
- 신청서 만들기는 전부 브라우저 안에서 끝나 서버에 흔적이 남지 않는다.
  관리사무소가 이 화면이 얼마나 쓰이는지 알 방법이 없었다.

What:
- bump_usage RPC 요청을 조립하는 순수 함수 buildBumpRequest 추가
- 예약 기능이 꺼져 있거나 모르는 source면 요청 자체를 만들지 않는다
- bumpUsage는 실패를 삼키고 reject 하지 않는다 — 집계가 신청서 흐름을 막으면 안 된다
```

---

### Task 3: `index.html`·`draw.html`에 집계 연결

**Files:**
- Modify: `index.html:167-172` (import 추가), `index.html:567-604` (두 핸들러)
- Modify: `draw.html:135` (import 추가), `draw.html:566-605` (두 핸들러)
- Test: `usage.test.mjs` (정적 배선 검사 추가)

**Interfaces:**
- Consumes: Task 2의 `bumpUsage(reservation, source)`
- Produces: 없음 (화면 배선)

**배경.** `wiring.test.mjs`가 만들어진 이유는 "함수는 만들어놓고 버튼에 연결하지 않아 눌러도 아무 일도 안 일어나던" 사고였다. 집계는 **실패해도 화면에 아무 표시가 안 나므로** 연결을 빠뜨려도 눈치챌 수 없다. 그래서 정적 검사를 같이 넣는다.

- [ ] **Step 1: 실패하는 배선 검사 작성**

`usage.test.mjs` 끝에 추가:

```js
import { readFileSync } from 'node:fs';

// 집계 호출은 실패해도 화면에 아무 표시가 안 난다. 연결을 빠뜨리면 조용히
// 숫자만 0으로 남으므로 wiring.test.mjs와 같은 방식으로 정적으로 잡는다.
const WIRED = [
  ['index.html', 'typed'],
  ['draw.html', 'hand'],
];

for (const [page, source] of WIRED) {
  test(`${page}: 이미지를 만드는 두 버튼 모두 집계를 부른다`, () => {
    const html = readFileSync(new URL(`./${page}`, import.meta.url), 'utf8');
    assert.match(html, /import \{ bumpUsage \} from '\.\/usage\.js';/);

    const re = new RegExp(`bumpUsage\\(config\\.reservation, '${source}'\\)`, 'g');
    const calls = html.match(re) || [];
    assert.equal(calls.length, 2, '"보내기"와 "저장" 두 곳에서 불러야 한다');
  });
}
```

- [ ] **Step 2: 실패를 확인**

Run: `node --test usage.test.mjs`
Expected: FAIL — `import { bumpUsage }` 가 없어 `assert.match`에서 실패

- [ ] **Step 3: `index.html` 수정**

`index.html:168` 근처의 import 블록 아래에 한 줄 추가한다.

```js
import { countNights, calcAmount } from './calc.js';
import {
  DEFAULT_CONFIG, clone, loadConfig, normalizeConfig,
  formFields, printedCells, derive, domIds,
} from './config.js';
import { bumpUsage } from './usage.js';
```

`$('share')` 핸들러 — `toJpegFile()` 성공 직후 한 줄 넣는다. 원래 코드:

```js
$('share').addEventListener('click', async () => {
  try {
    const file = await toJpegFile();
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
```

바꾼 뒤:

```js
$('share').addEventListener('click', async () => {
  try {
    const file = await toJpegFile();
    // 이미지가 실제로 만들어진 건만 센다. await 하지 않는다 — 집계가 늦거나
    // 실패해도 주민은 아무 차이를 느끼면 안 된다.
    bumpUsage(config.reservation, 'typed');
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
```

`$('download')` 핸들러도 똑같이 `const file = await toJpegFile();` 바로 다음 줄에 넣는다.

```js
$('download').addEventListener('click', async () => {
  try {
    const file = await toJpegFile();
    bumpUsage(config.reservation, 'typed');
    // 폰(iOS/안드로이드)에서는 <a download>로는 사진함에 저장되지 않는다.
```

- [ ] **Step 4: `draw.html` 수정**

`draw.html:135`의 import 아래에 추가한다.

```js
import { DEFAULT_CONFIG, clone, loadConfig, normalizeConfig, printedCells, packRows } from './config.js';
import { bumpUsage } from './usage.js';
```

`sendBtn` 핸들러의 `.then(function (file) {` 첫 줄에 넣는다. 이 파일은 `var`/`function` 스타일이므로 그대로 따른다.

```js
  $('sendBtn').addEventListener('click', function () {
    if (imageState !== 'ready') return;
    toJpegFile().then(function (file) {
      // 이미지가 실제로 만들어진 건만 센다. 실패해도 화면은 그대로 간다.
      bumpUsage(config.reservation, 'hand');
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
```

`saveBtn` 핸들러도 똑같이 `toJpegFile().then(function (file) {` 바로 다음 줄에 넣는다.

```js
  $('saveBtn').addEventListener('click', function () {
    if (imageState !== 'ready') return;
    toJpegFile().then(function (file) {
      bumpUsage(config.reservation, 'hand');
      // 폰에서는 <a download>로 사진함에 저장되지 않는다. 공유 시트를 열면
```

- [ ] **Step 5: 통과를 확인**

Run: `node --test usage.test.mjs`
Expected: PASS (7개 테스트)

- [ ] **Step 6: 기존 테스트가 안 깨졌는지 확인**

Run: `node --test calc.test.mjs config.test.mjs github.test.mjs reservations.test.mjs wiring.test.mjs usage.test.mjs`
Expected: 전부 PASS

- [ ] **Step 7: 브라우저로 눈으로 확인**

```bash
python -m http.server 8000
```

`http://localhost:8000/index.html`을 열고 필수값을 채운 뒤 "이미지 저장"을 누른다.
그리고 Supabase에서:

```sql
select * from usage_daily;
```

기대: `typed = 1`. `draw.html`에서도 해보면 `hand`가 오른다.

**개발자도구 Network 탭에서 `bump_usage` 요청 본문에 이름·동호수가 없는지 눈으로 확인한다.** `{"p_source":"typed"}` 뿐이어야 한다.

이어서 네 가지를 더 확인한다.

1. **실패한 건은 안 센다.** `config.json`의 `form.image`를 없는 파일명으로 잠깐 바꾸고
   새로고침한다. 서식 이미지 로딩이 실패해 버튼이 잠기고, 눌러도 숫자가 안 오른다.
   확인 후 되돌린다.
2. **오프라인에서도 저장이 된다.** 개발자도구 Network 탭에서 Offline으로 바꾸고
   "이미지 저장"을 누른다. 이미지는 평소처럼 저장되고 화면에 오류가 뜨지 않는다.
   Console에 `bump_usage` 요청 실패가 찍히는 것은 정상이다 — 삼켜진 것이다.
3. **예약 기능을 꺼도 신청서가 동작한다.** `config.json`의 `reservation.enabled`를
   `false`로 바꾸고 새로고침한다. 신청서가 평소대로 만들어지고 `bump_usage` 요청이
   아예 나가지 않는다. 확인 후 되돌린다.
4. **콘솔에 에러가 없다.** import를 추가했으므로 모듈 로딩이 깨지지 않았는지 본다.

- [ ] **Step 8: 커밋**

```bash
git add index.html draw.html usage.test.mjs
git commit -F "$env:TEMP\msg.txt"   # 아래 메시지를 이 파일에 먼저 저장한다
```

메시지:

```
feat: 신청서 이미지를 만들면 건수를 집계

Why:
- 관리사무소가 이 화면이 실제로 쓰이는지 알 방법이 없었다.

What:
- index.html(타이핑)·draw.html(손글씨)의 "보내기"·"저장" 네 곳에서 bumpUsage 호출
- 버튼 클릭이 아니라 이미지 생성에 성공한 직후에 센다 — 실패한 건은 세지 않는다
- await 하지 않아 집계가 신청서 만들기를 막지 않는다
- 연결을 빠뜨리면 조용히 0으로 남으므로 정적 배선 검사를 usage.test.mjs에 추가
```

---

### Task 4: 발송 스크립트

**Files:**
- Create: `scripts/notify-usage.mjs`
- Test: `notify.test.mjs`

**Interfaces:**
- Consumes: Task 1의 `get_usage(p_day date)` RPC, `config.json`의 `reservation.url`·`reservation.anonKey`
- Produces:
  - `seoulYesterday(now)` → `'YYYY-MM-DD'` (한국 시간 기준 어제)
  - `formatMessage(day, row)` → 텔레그램에 보낼 문자열. `row`는 `{ typed, hand }` 또는 `undefined`

- [ ] **Step 1: 실패하는 테스트 작성**

`notify.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seoulYesterday, formatMessage } from './scripts/notify-usage.mjs';

test('한국 시간 아침 7시에 돌면 어제는 하루 전이다', () => {
  // UTC 22:00 = KST 다음날 07:00. 워크플로가 실제로 도는 시각이다.
  assert.equal(seoulYesterday(new Date('2026-08-05T22:00:00Z')), '2026-08-05');
});

test('UTC 자정을 넘어도 한국 날짜가 밀리지 않는다', () => {
  // UTC 08-06 00:30 = KST 08-06 09:30 → 어제는 08-05
  assert.equal(seoulYesterday(new Date('2026-08-06T00:30:00Z')), '2026-08-05');
});

test('한국 시간 자정 직전과 직후에서 날짜가 정확히 갈린다', () => {
  // KST 08-05 23:59
  assert.equal(seoulYesterday(new Date('2026-08-05T14:59:00Z')), '2026-08-04');
  // KST 08-06 00:00
  assert.equal(seoulYesterday(new Date('2026-08-05T15:00:00Z')), '2026-08-05');
});

test('월초에는 지난달 말일로 넘어간다', () => {
  // KST 09-01 07:00
  assert.equal(seoulYesterday(new Date('2026-08-31T22:00:00Z')), '2026-08-31');
});

test('건수가 있으면 두 줄로 보낸다', () => {
  assert.equal(
    formatMessage('2026-08-04', { typed: 2, hand: 1 }),
    '📋 8월 4일 신청서 3건\n   타이핑 2 · 손글씨 1'
  );
});

test('한쪽이 0이어도 내역에 둘 다 표시한다', () => {
  // 0을 숨기면 어느 화면이 안 쓰이는지 보이지 않는다.
  assert.equal(
    formatMessage('2026-08-04', { typed: 3, hand: 0 }),
    '📋 8월 4일 신청서 3건\n   타이핑 3 · 손글씨 0'
  );
});

test('그날 기록이 없으면 0건 한 줄만 보낸다', () => {
  // get_usage는 기록이 없으면 0행을 준다 → rows[0]이 undefined다.
  assert.equal(formatMessage('2026-08-04', undefined), '📋 8월 4일 신청서 0건');
});

test('0건인 날도 보낸다 — 침묵이 고장인지 조용한 날인지 구분되지 않으면 더 나쁘다', () => {
  assert.equal(formatMessage('2026-08-04', { typed: 0, hand: 0 }), '📋 8월 4일 신청서 0건');
});
```

- [ ] **Step 2: 실패를 확인**

Run: `node --test notify.test.mjs`
Expected: FAIL — `Cannot find module ... scripts/notify-usage.mjs`

- [ ] **Step 3: `scripts/notify-usage.mjs` 작성**

```js
// 어제 만들어진 신청서 건수를 텔레그램으로 보낸다. GitHub Actions가 매일 부른다.
//
// 봇 토큰은 Actions Secrets에만 있다. 브라우저에 들어가면 누구나 그 토큰으로
// 채팅방에 아무 메시지나 보낼 수 있으므로 발송은 반드시 이쪽에서 한다.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// ---- 순수 함수 (테스트 대상) ----

// 한국 시간 기준 '어제'. 러너는 UTC로 도므로 new Date()를 그대로 쓰면
// 한국 아침 7시에 하루가 밀린다.
export function seoulYesterday(now) {
  const KST = 9 * 60 * 60 * 1000;
  const DAY = 24 * 60 * 60 * 1000;
  return new Date(now.getTime() + KST - DAY).toISOString().slice(0, 10);
}

// row는 get_usage의 첫 행. 그날 기록이 없으면 undefined다.
export function formatMessage(day, row) {
  const typed = row ? row.typed : 0;
  const hand = row ? row.hand : 0;
  const total = typed + hand;

  const [, month, date] = day.split('-');
  const head = `📋 ${Number(month)}월 ${Number(date)}일 신청서 ${total}건`;

  // 0건이어도 보낸다. 안 오면 시스템이 고장 난 것으로 읽을 수 있다.
  if (total === 0) return head;
  return `${head}\n   타이핑 ${typed} · 손글씨 ${hand}`;
}

// ---- 아래는 네트워크를 타므로 자동 테스트하지 않는다 ----

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error('TELEGRAM_BOT_TOKEN과 TELEGRAM_CHAT_ID가 필요합니다.');
  }

  // Supabase 주소는 config.json 하나만 본다. 여기에 또 적어두면 프로젝트를
  // 옮길 때 한쪽만 고치고 끝나는 사고가 난다.
  const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
  const { url, anonKey } = config.reservation || {};
  if (!url || !anonKey) {
    throw new Error('config.json에 reservation.url·anonKey가 없습니다.');
  }

  const day = seoulYesterday(new Date());

  const res = await fetch(`${url}/rest/v1/rpc/get_usage`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_day: day }),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);

  const rows = await res.json();
  const text = formatMessage(day, rows[0]);

  // 토큰이 URL에 들어가므로 이 주소는 절대 로그에 찍지 않는다.
  const sent = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  // 조용히 성공한 척하면 워크플로는 초록불인데 알림은 안 오는 상태를 못 알아챈다.
  if (!sent.ok) throw new Error(`Telegram ${sent.status}: ${await sent.text()}`);

  console.log(`보냈습니다 (${day}): ${text.split('\n')[0]}`);
}

// 테스트가 import 할 때는 main()이 돌면 안 된다. 직접 실행할 때만 돈다.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: 통과를 확인**

Run: `node --test notify.test.mjs`
Expected: PASS (8개 테스트)

- [ ] **Step 5: import 해도 발송이 안 도는지 확인**

Run: `node --test notify.test.mjs`
Expected: 출력에 "보냈습니다"나 `TELEGRAM_BOT_TOKEN...필요합니다` 오류가 **없어야 한다.** 보이면 `import.meta.url` 가드가 잘못된 것이다.

- [ ] **Step 6: 커밋**

```bash
git add scripts/notify-usage.mjs notify.test.mjs
git commit -F "$env:TEMP\msg.txt"   # 아래 메시지를 이 파일에 먼저 저장한다
```

메시지:

```
feat: 어제 신청서 건수를 텔레그램으로 보내는 스크립트

Why:
- 봇 토큰이 브라우저에 들어가면 누구나 그 토큰으로 채팅방에 메시지를 보낼 수 있다.
  발송은 토큰이 노출되지 않는 곳에서 해야 한다.

What:
- get_usage RPC로 어제 건수를 읽어 텔레그램 sendMessage로 보낸다
- 어제 계산을 Asia/Seoul 기준으로 한다 — 러너는 UTC라 아침 7시에 하루가 밀린다
- 0건인 날도 보낸다. 안 오면 고장으로 알 수 있어야 한다
- 텔레그램이 2xx가 아니면 0이 아닌 코드로 끝낸다 — 조용한 실패를 만들지 않는다
- Supabase 주소는 config.json만 본다. 설정 출처를 하나로 유지한다
```

---

### Task 5: GitHub Actions 워크플로와 문서

**Files:**
- Create: `.github/workflows/usage-notify.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 4의 `scripts/notify-usage.mjs`, Secrets `TELEGRAM_BOT_TOKEN`·`TELEGRAM_CHAT_ID`
- Produces: 없음

- [ ] **Step 1: 텔레그램 봇 만들기 (사람이 한다)**

1. 텔레그램에서 **@BotFather** 에게 `/newbot` — 이름을 정하면 `123456:ABC-DEF...` 형태의 토큰을 준다
2. 알림 받을 방(1:1 대화도 된다)에 그 봇을 초대하고 아무 메시지나 하나 보낸다
3. 브라우저에서 `https://api.telegram.org/bot<토큰>/getUpdates` 를 열어 `chat.id`를 확인한다. 그룹이면 음수(`-100...`)다
4. 저장소 Settings → Secrets and variables → Actions → New repository secret 로 두 개 등록:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`

- [ ] **Step 2: 워크플로 작성**

`.github/workflows/usage-notify.yml`:

```yaml
name: 일일 사용량 알림

on:
  schedule:
    # UTC 22:00 = KST 07:00. GitHub은 정시 실행을 보장하지 않지만
    # 일일 집계라 수십 분 밀려도 상관없다.
    - cron: '0 22 * * *'
  workflow_dispatch:

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: node scripts/notify-usage.mjs
        env:
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
```

- [ ] **Step 3: README 갱신**

"개발" 절의 테스트 명령에 새 파일 두 개를 더한다.

```bash
node --test calc.test.mjs config.test.mjs github.test.mjs reservations.test.mjs wiring.test.mjs usage.test.mjs notify.test.mjs
```

"설정 구조" 표에 한 줄 추가한다.

```
| `usage.js` | 신청서 생성 건수 집계 호출 |
```

그리고 "예약 시스템 설정 (Supabase)" 절 **뒤에** 새 절을 넣는다.

```markdown
## 사용량 알림 (텔레그램)

주민이 신청서 이미지를 만들 때마다 숫자가 1 오르고, 매일 아침 7시에 어제 건수가
텔레그램으로 옵니다.

```
📋 8월 4일 신청서 3건
   타이핑 2 · 손글씨 1
```

**세는 것은 이미지가 만들어진 횟수입니다. 신청 세대 수가 아닙니다.** "보내기"가
실패해서 "저장"을 다시 누르면 2로 셉니다. 세대별로 합치려면 이름·동호수를 서버로
보내야 하는데, 그러면 개인정보가 텔레그램까지 흘러갑니다. 숫자가 조금 부풀더라도
아무것도 안 보내는 쪽을 택했습니다.

**서버에 저장되는 것은 날짜와 숫자 두 개뿐입니다.** 누가 언제 무엇을 신청했는지는
저장되지 않습니다.

### 준비

1. `docs/superpowers/plans/2026-08-05-usage-telegram.md`의 Task 1 SQL을 Supabase
   SQL Editor에서 실행합니다.
2. 텔레그램 **@BotFather** 에게 `/newbot` 으로 봇을 만들고 토큰을 받습니다.
3. 알림 받을 방에 봇을 초대하고 아무 메시지나 보낸 뒤,
   `https://api.telegram.org/bot<토큰>/getUpdates` 에서 `chat.id`를 확인합니다.
   그룹이면 음수입니다.
4. 저장소 Settings → Secrets and variables → Actions 에 `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_CHAT_ID`를 등록합니다.
5. Actions 탭 → "일일 사용량 알림" → **Run workflow** 로 한 번 눌러 확인합니다.

알림이 며칠째 안 오면 Actions 탭에서 빨간불을 확인하세요. 0건인 날도 메시지가
오도록 만들었으므로 **아무것도 안 오는 것은 고장입니다.**

봇 토큰은 저장소 Secrets에만 있습니다. 주민 브라우저에는 들어가지 않습니다 —
들어가면 누구나 그 토큰으로 채팅방에 아무 메시지나 보낼 수 있습니다.
```

- [ ] **Step 4: 전체 테스트 확인**

Run: `node --test calc.test.mjs config.test.mjs github.test.mjs reservations.test.mjs wiring.test.mjs usage.test.mjs notify.test.mjs`
Expected: 전부 PASS

- [ ] **Step 5: 커밋하고 푸시**

```bash
git add .github/workflows/usage-notify.yml README.md
git commit -F "$env:TEMP\msg.txt"   # 아래 메시지를 이 파일에 먼저 저장한다
git push
```

메시지:

```
feat: 매일 아침 사용량을 텔레그램으로 보내는 워크플로

Why:
- 관리사무소가 신청서 화면이 얼마나 쓰이는지 알 방법이 없었다.

What:
- KST 07시(UTC 22시)에 도는 GitHub Actions 워크플로 추가. 수동 실행도 된다
- 덤으로 매일 Supabase를 건드려 무료 프로젝트 일시정지를 막는다
- README에 준비 절차와 "세는 것은 이미지 생성 횟수지 세대 수가 아니다"를 명시
```

- [ ] **Step 6: 실제 발송 확인**

Actions 탭 → "일일 사용량 알림" → **Run workflow**.

기대: 초록불, 텔레그램에 어제 날짜 메시지 도착.

- [ ] **Step 7: 실패가 실패로 보이는지 확인**

`TELEGRAM_CHAT_ID`를 일부러 `0`으로 바꾸고 Run workflow.

기대: **빨간불**, 로그에 `Telegram 400: ...`. 초록불이면 조용한 실패를 만든 것이므로 Task 4의 `if (!sent.ok)`를 확인한다.

확인 후 `TELEGRAM_CHAT_ID`를 원래 값으로 되돌린다.

---

## 완료 기준

- [ ] `node --test` 7개 파일 전부 통과
- [ ] `index.html`·`draw.html`에서 이미지를 만들면 `usage_daily`의 해당 칸이 오른다
- [ ] 요청 본문에 개인정보가 없다 (`{"p_source":"typed"}` 뿐)
- [ ] 익명 키로 `usage_daily`를 직접 읽으면 빈 배열이 온다
- [ ] `workflow_dispatch`로 텔레그램 메시지가 온다
- [ ] 텔레그램 발송이 실패하면 워크플로가 빨간불이 된다
- [ ] 오프라인에서도 신청서 저장이 평소와 똑같이 된다
