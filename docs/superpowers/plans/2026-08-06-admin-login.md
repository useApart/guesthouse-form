# 관리자 로그인 전환 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리사무소 직원이 GitHub 토큰 없이 이메일·비밀번호 로그인만으로 설정을 바꿀 수 있게 한다.

**Architecture:** 설정 원본을 Supabase `app_config` 테이블로 옮긴다. `admin.html`은 `manage.html`과 같은 Supabase 로그인을 쓰고 저장은 Supabase로 한다. GitHub Action이 5분마다 Supabase를 읽어 `config.json`으로 커밋하므로, 설정을 읽는 화면들은 지금 그대로 정적 파일을 쓴다. Actions는 자체 `GITHUB_TOKEN`을 쓰므로 개인 토큰이 어디에도 남지 않는다.

**Tech Stack:** 정적 HTML + ES 모듈, Supabase(PostgREST·Auth·RLS), GitHub Actions, Node 20 내장 `fetch`, `node --test`

설계 문서: `docs/superpowers/specs/2026-08-06-admin-login-design.md`

## Global Constraints

- 새 npm 의존성을 추가하지 않는다. Node 20 내장 `fetch`만 쓴다.
- `service_role` 키를 쓰지 않는다. 브라우저와 Actions 모두 공개 `anonKey`를 쓴다.
- **설정을 읽는 방식은 어느 화면도 바꾸지 않는다.** `index`·`draw`·`reserve`·`manage`는 계속 정적 `config.json`을 읽는다.
- 테스트는 순수 함수만 자동화한다. `fetch`를 타는 코드는 테스트하지 않는다.
- 주석은 한국어로 "왜 이렇게 했는가"를 적는다. 기존 파일의 문체를 따른다.
- 커밋 메시지는 한국어 Conventional Commits이며 본문에 Why/What을 적는다. `Co-Authored-By` 줄을 넣지 않는다.
- **직원 권한은 나누지 않는다.** `manage.html`에 로그인할 수 있는 계정이면 설정도 바꿀 수 있다.
- 서식 이미지 교체는 이번 범위가 아니다. 지금의 GitHub 토큰 방식을 그대로 두되 "고급"으로 접는다.

**커밋하는 법.** Windows/PowerShell 환경이다. PowerShell은 heredoc을 커밋 메시지에 쓰면 깨진다. 메시지를 **저장소 밖** 임시 파일에 저장한 뒤 읽힌다.

```powershell
git add <파일들>
git commit -F "$env:TEMP\msg.txt"
```

**푸시는 하지 않는다.** 컨트롤러가 마지막에 한 번 한다.

## 파일 구조

| 파일 | 역할 | 상태 |
|---|---|---|
| `configstore.js` | Supabase `app_config` 호출 조립 | 새로 만듦 |
| `configstore.test.mjs` | 위의 순수 함수 검증 | 새로 만듦 |
| `scripts/sync-config.mjs` | Supabase → `config.json` 동기화 | 새로 만듦 |
| `syncconfig.test.mjs` | 비교·직렬화 순수 함수 검증 | 새로 만듦 |
| `.github/workflows/config-sync.yml` | 5분마다 동기화 실행 | 새로 만듦 |
| `github.js` | 토큰 없이도 읽을 수 있게 헤더 분리 | 고침 |
| `reservations.js` | 내부 `request`를 export | 고침 |
| `admin.html` | 로그인 · Supabase 저장 · 되돌리기 · 이미지 접기 | 고침 |
| `manage.html` | `admin.html`로 가는 링크 | 고침 |
| `README.md` | 절차·원본 위치·복구 방법 | 고침 |

---

### Task 1: Supabase 스키마

**Files:**
- 없음 (사람이 Supabase SQL Editor에서 실행한다)

**Interfaces:**
- Consumes: 없음
- Produces: 테이블 `app_config(id, config, updated_at, updated_by)` 1행. `anon`은 select, `authenticated`는 update.

- [ ] **Step 1: 테이블과 정책 만들기**

```sql
create table if not exists app_config (
  id         smallint primary key default 1,
  config     jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  constraint app_config_single_row check (id = 1)
);

alter table app_config enable row level security;

-- 설정에는 비밀이 없다. 이 내용은 어차피 config.json으로 공개 서빙된다.
drop policy if exists "설정은 누구나 읽는다" on app_config;
create policy "설정은 누구나 읽는다"
  on app_config for select to anon, authenticated using (true);

-- 쓰기는 로그인한 직원만. manage.html이 쓰는 계정과 같다.
drop policy if exists "로그인한 직원만 고친다" on app_config;
create policy "로그인한 직원만 고친다"
  on app_config for update to authenticated using (true) with check (true);
```

**insert·delete 정책은 만들지 않는다.** 행이 사라지면 동기화가 멈추고 설정을 되돌릴 길이 없어진다.

- [ ] **Step 2: 갱신 추적 트리거**

```sql
create or replace function touch_app_config()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  -- 브라우저가 보낸 값을 믿지 않는다. 누가 바꿨는지는 감사용이라 믿을 수 있어야 한다.
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists app_config_touch on app_config;
create trigger app_config_touch before update on app_config
  for each row execute function touch_app_config();
```

- [ ] **Step 3: 현재 설정을 시딩**

손으로 붙여넣으면 따옴표 이스케이프에서 틀리기 쉽다. SQL 문을 만들어 클립보드에 넣는다.

```powershell
$json = (Get-Content C:\workspace\new\config.json -Raw) -replace "'", "''"
"insert into app_config (id, config) values (1, '$json'::jsonb) on conflict (id) do update set config = excluded.config;" | Set-Clipboard
```

SQL Editor에 붙여넣고 실행한다. `-replace "'", "''"`는 설정 안에 작은따옴표가 있어도 SQL이 깨지지 않게 한다.

- [ ] **Step 4: 익명으로 읽히는지 확인**

`<URL>`·`<ANON_KEY>`는 `config.json`의 `reservation.url`·`reservation.anonKey`다.

```bash
curl -s "<URL>/rest/v1/app_config?id=eq.1&select=config" -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
```

기대: 설정 JSON이 담긴 배열 1개.

- [ ] **Step 5: 익명으로는 못 고치는지 확인**

```bash
curl -s -X PATCH "<URL>/rest/v1/app_config?id=eq.1" -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>" -H "Content-Type: application/json" -d "{\"config\":{}}"
```

기대: 권한 오류이거나 **0행 갱신**. 설정이 실제로 비워지면 정책이 잘못된 것이므로 Step 1을 다시 확인한다.

- [ ] **Step 6: 지워지지 않는지 확인**

```bash
curl -s -X DELETE "<URL>/rest/v1/app_config?id=eq.1" -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
```

기대: 삭제되지 않는다. Step 4를 다시 실행해 행이 남아 있는지 본다.

**참고: `jsonb`는 객체의 키 순서를 보존하지 않는다.** 배열 순서는 보존하므로 `fields`(항목 순서)는 안전하다. 첫 동기화 때 `config.json`의 키 순서가 한 번 바뀌는 커밋이 생기는데 정상이다.

---

### Task 2: 토큰 없이 GitHub을 읽을 수 있게

**Files:**
- Modify: `github.js:47-57`
- Test: `github.test.mjs`

**Interfaces:**
- Consumes: 없음
- Produces: `buildHeaders({ token, hasBody })` → 헤더 객체. `token`이 없으면 `Authorization` 키가 아예 없다.

**배경.** 지금은 토큰이 없어도 `Authorization: Bearer `를 보내서 GitHub이 401로 막는다. 그래서 되돌리기 이력에 토큰이 필요했다. 공개 저장소의 읽기는 익명으로도 되므로, 헤더만 빼면 토큰 없이 이력을 볼 수 있다.

- [ ] **Step 1: 실패하는 테스트 작성**

`github.test.mjs` 맨 위 import에 `buildHeaders`를 더하고, 파일 끝에 추가한다.

```js
test('토큰이 있으면 Authorization을 붙인다', () => {
  const h = buildHeaders({ token: 'ghp_x' });
  assert.equal(h.Authorization, 'Bearer ghp_x');
  assert.equal(h.Accept, 'application/vnd.github+json');
  assert.equal(h['X-GitHub-Api-Version'], '2022-11-28');
});

test('토큰이 없으면 Authorization 키 자체가 없다', () => {
  // 'Bearer '만 보내면 GitHub이 401로 막는다. 공개 저장소는 익명으로 읽힌다.
  const h = buildHeaders({ token: '' });
  assert.equal('Authorization' in h, false);
  assert.equal('Authorization' in buildHeaders({}), false);
});

test('본문이 있을 때만 Content-Type을 붙인다', () => {
  assert.equal(buildHeaders({ token: 't', hasBody: true })['Content-Type'], 'application/json');
  assert.equal('Content-Type' in buildHeaders({ token: 't' }), false);
});
```

- [ ] **Step 2: 실패를 확인**

Run: `node --test github.test.mjs`
Expected: FAIL — `buildHeaders is not a function`

- [ ] **Step 3: `github.js` 수정**

`const API = 'https://api.github.com';` 바로 아래에 추가한다.

```js
// 헤더 조립만 순수 함수로 뺀다. 토큰 유무로 갈리는 부분이 여기라 테스트로 고정한다.
// 토큰이 없으면 Authorization을 통째로 빼야 한다 — 'Bearer '만 보내면 GitHub이
// 401로 막는다. 공개 저장소의 읽기(이력 조회)는 익명으로도 된다.
export function buildHeaders({ token, hasBody = false } = {}) {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
  };
}
```

그리고 `createClient` 안의 `request`에서 헤더 부분을 바꾼다. 원래:

```js
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
```

바꾼 뒤:

```js
      headers: {
        ...buildHeaders({ token, hasBody: Boolean(options.body) }),
        ...options.headers,
      },
```

- [ ] **Step 4: 통과를 확인**

Run: `node --test github.test.mjs`
Expected: PASS

- [ ] **Step 5: 커밋**

```powershell
git add github.js github.test.mjs
git commit -F "$env:TEMP\msg.txt"
```

메시지:

```
refactor: 토큰 없이도 GitHub을 읽을 수 있게 헤더 분리

Why:
- 토큰이 없어도 'Bearer '를 보내 GitHub이 401로 막았다. 그래서 저장 이력을
  보는 데까지 토큰이 필요했는데, 공개 저장소의 읽기는 원래 익명으로 된다.

What:
- 헤더 조립을 buildHeaders 순수 함수로 빼고 토큰이 없으면 Authorization을 생략
- createClient가 그 함수를 쓰도록 정리. 동작은 토큰이 있을 때와 동일
```

---

### Task 3: `configstore.js` — Supabase 설정 호출

**Files:**
- Create: `configstore.js`
- Modify: `reservations.js:190` (`request`에 `export` 추가)
- Test: `configstore.test.mjs`

**Interfaces:**
- Consumes: `reservations.js`의 `buildRequest(reservation, spec)`와 `request(reservation, spec)`
- Produces:
  - `buildLoadConfigRequest(reservation)` → `{ url, options }` 또는 `null`
  - `buildSaveConfigRequest(reservation, accessToken, config)` → `{ url, options }` 또는 `null`
  - `loadStoredConfig(reservation)` → `Promise<object|null>`
  - `saveStoredConfig(reservation, accessToken, config)` → `Promise<void>`, 실패 시 `error.status`가 붙은 Error로 reject

- [ ] **Step 1: 실패하는 테스트 작성**

`configstore.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLoadConfigRequest, buildSaveConfigRequest } from './configstore.js';

const RES = { enabled: true, url: 'https://x.supabase.co', anonKey: 'ANON' };
const CONFIG = { version: 1, pricing: { weekday: 35000 } };

test('설정 읽기는 id=1 한 행만 가져온다', () => {
  const { url, options } = buildLoadConfigRequest(RES);
  assert.equal(url, 'https://x.supabase.co/rest/v1/app_config?id=eq.1&select=config');
  assert.equal(options.method, 'GET');
});

test('읽기는 로그인하지 않아도 된다 — 익명 키가 신원이다', () => {
  const { options } = buildLoadConfigRequest(RES);
  assert.equal(options.headers.apikey, 'ANON');
  assert.equal(options.headers.Authorization, 'Bearer ANON');
});

test('저장은 PATCH로 config 칸만 바꾼다', () => {
  const { url, options } = buildSaveConfigRequest(RES, 'JWT', CONFIG);
  assert.equal(url, 'https://x.supabase.co/rest/v1/app_config?id=eq.1');
  assert.equal(options.method, 'PATCH');
  assert.deepEqual(JSON.parse(options.body), { config: CONFIG });
});

test('저장은 로그인 토큰으로 신원을 밝힌다', () => {
  const { options } = buildSaveConfigRequest(RES, 'JWT', CONFIG);
  // apikey는 익명 키 그대로, Authorization만 로그인 토큰으로 바뀐다.
  assert.equal(options.headers.apikey, 'ANON');
  assert.equal(options.headers.Authorization, 'Bearer JWT');
  assert.equal(options.headers.Prefer, 'return=minimal');
});

test('로그인하지 않았으면 저장 요청을 만들지 않는다', () => {
  assert.equal(buildSaveConfigRequest(RES, '', CONFIG), null);
  assert.equal(buildSaveConfigRequest(RES, null, CONFIG), null);
});

test('예약 기능이 꺼져 있으면 아무 요청도 만들지 않는다', () => {
  const off = { enabled: false, url: 'https://x', anonKey: 'K' };
  assert.equal(buildLoadConfigRequest(off), null);
  assert.equal(buildSaveConfigRequest(off, 'JWT', CONFIG), null);
  assert.equal(buildLoadConfigRequest(null), null);
});

test('빈 설정은 저장하지 않는다', () => {
  // 빈 설정이 저장되면 동기화가 그것을 커밋해 사이트가 통째로 기본값으로 떨어진다.
  assert.equal(buildSaveConfigRequest(RES, 'JWT', null), null);
  assert.equal(buildSaveConfigRequest(RES, 'JWT', {}), null);
});
```

- [ ] **Step 2: 실패를 확인**

Run: `node --test configstore.test.mjs`
Expected: FAIL — `Cannot find module ... configstore.js`

- [ ] **Step 3: `reservations.js`의 `request`를 export**

`function request(reservation, spec) {` 를 `export function request(reservation, spec) {` 로 바꾼다. 그 위의 주석은 그대로 둔다.

- [ ] **Step 4: `configstore.js` 작성**

```js
// 설정의 원본은 Supabase의 app_config 한 행이다. 이 파일은 그 행을 읽고 쓰는
// 방법만 안다 — 설정의 '의미'(기본값·검증·정규화)는 config.js가 맡는다.
//
// reservations.js와 같은 구조를 쓴다: 조립은 순수 함수로 빼서 테스트로 고정하고,
// 네트워크를 타는 부분은 request에 맡긴다.
import { buildRequest, request } from './reservations.js';

const ROW = '/rest/v1/app_config?id=eq.1';

function usable(reservation) {
  return Boolean(reservation && reservation.enabled);
}

export function buildLoadConfigRequest(reservation) {
  if (!usable(reservation)) return null;
  return buildRequest(reservation, { path: `${ROW}&select=config` });
}

export function buildSaveConfigRequest(reservation, accessToken, config) {
  if (!usable(reservation)) return null;
  // 로그인하지 않았으면 서버도 거부한다. 오지 않을 요청을 보낼 이유가 없다.
  if (!accessToken) return null;
  // 빈 설정이 저장되면 동기화가 그것을 커밋해 사이트가 통째로 기본값으로 떨어진다.
  if (!config || typeof config !== 'object' || Object.keys(config).length === 0) return null;

  return buildRequest(reservation, {
    path: ROW,
    method: 'PATCH',
    body: { config },
    accessToken,
    minimal: true,
  });
}

// 없으면 null. 부르는 쪽이 정적 config.json으로 물러선다.
export function loadStoredConfig(reservation) {
  if (!usable(reservation)) return Promise.resolve(null);
  return request(reservation, { path: `${ROW}&select=config` })
    .then((rows) => (rows && rows[0] ? rows[0].config : null));
}

// 실패하면 error.status가 붙은 Error로 reject한다. 401이면 부르는 쪽이 다시
// 로그인시켜야 한다.
export function saveStoredConfig(reservation, accessToken, config) {
  if (!buildSaveConfigRequest(reservation, accessToken, config)) {
    return Promise.reject(new Error('저장할 수 없는 상태입니다.'));
  }
  return request(reservation, {
    path: ROW,
    method: 'PATCH',
    body: { config },
    accessToken,
    minimal: true,
  });
}
```

- [ ] **Step 5: 통과를 확인**

Run: `node --test configstore.test.mjs`
Expected: PASS (7개)

- [ ] **Step 6: 기존 테스트가 안 깨졌는지 확인**

Run: `node --test calc.test.mjs config.test.mjs github.test.mjs reservations.test.mjs wiring.test.mjs usage.test.mjs notify.test.mjs device.test.mjs configstore.test.mjs`
Expected: 전부 PASS

- [ ] **Step 7: 커밋**

```powershell
git add configstore.js configstore.test.mjs reservations.js
git commit -F "$env:TEMP\msg.txt"
```

메시지:

```
feat: Supabase에 설정을 읽고 쓰는 호출 추가

Why:
- 설정 원본을 Supabase로 옮겨 관리사무소 직원이 GitHub 토큰 없이 로그인만으로
  설정을 바꿀 수 있게 하기 위한 첫 조각이다.

What:
- configstore.js 추가. app_config 한 행을 읽고 쓰는 요청을 조립한다
- 읽기는 익명 키로, 쓰기는 로그인 토큰으로 한다
- 로그인하지 않았거나 설정이 비었으면 요청 자체를 만들지 않는다 — 빈 설정이
  저장되면 동기화가 그것을 커밋해 사이트가 기본값으로 떨어진다
- reservations.js의 request를 export해 오류 해석(status·code)을 재사용한다
```

---

### Task 4: 동기화 스크립트와 워크플로

**Files:**
- Create: `scripts/sync-config.mjs`
- Create: `.github/workflows/config-sync.yml`
- Test: `syncconfig.test.mjs`

**Interfaces:**
- Consumes: Task 1의 `app_config` 테이블, `config.json`의 `reservation.url`·`anonKey`
- Produces:
  - `sameConfig(a, b)` → `boolean` (키 순서를 무시하고 비교)
  - `nextConfigText(stored, currentText)` → 쓸 문자열, 같으면 `null`. `stored`가 비었거나 객체가 아니면 throw

- [ ] **Step 1: 실패하는 테스트 작성**

`syncconfig.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameConfig, nextConfigText } from './scripts/sync-config.mjs';

const CONFIG = { version: 1, site: { org: '원흥', title: '신청서' }, fields: [{ id: 'a' }, { id: 'b' }] };
const TEXT = `${JSON.stringify(CONFIG, null, 2)}\n`;

test('키 순서만 다르면 같은 설정으로 본다', () => {
  // jsonb는 객체의 키 순서를 보존하지 않는다. 순서만 바뀐 것을 변경으로 보면
  // 5분마다 의미 없는 커밋이 쌓이고 되돌리기가 쓸모없어진다.
  assert.equal(sameConfig({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
  assert.equal(sameConfig({ x: { p: 1, q: 2 } }, { x: { q: 2, p: 1 } }), true);
});

test('배열 순서가 다르면 다른 설정이다', () => {
  // fields 순서는 화면에 그대로 나타난다. 순서 변경은 진짜 변경이다.
  assert.equal(sameConfig({ f: [1, 2] }, { f: [2, 1] }), false);
});

test('값이 다르면 다른 설정이다', () => {
  assert.equal(sameConfig({ a: 1 }, { a: 2 }), false);
  assert.equal(sameConfig({ a: 1 }, { a: 1, b: 1 }), false);
});

test('내용이 같으면 쓰지 않는다', () => {
  assert.equal(nextConfigText(CONFIG, TEXT), null);
});

test('키 순서만 다른 저장본도 쓰지 않는다', () => {
  const reordered = { fields: CONFIG.fields, site: CONFIG.site, version: 1 };
  assert.equal(nextConfigText(reordered, TEXT), null);
});

test('내용이 다르면 쓸 문자열을 돌려준다', () => {
  const changed = { ...CONFIG, version: 2 };
  const out = nextConfigText(changed, TEXT);
  assert.equal(out, `${JSON.stringify(changed, null, 2)}\n`);
});

test('두 칸 들여쓰기와 끝 개행을 지킨다', () => {
  // admin.html이 지금까지 저장해 온 형식이다. 다르면 첫 동기화가 형식만 바꾸는
  // 커밋을 만든다.
  const out = nextConfigText({ a: 1 }, 'different');
  assert.equal(out, '{\n  "a": 1\n}\n');
});

test('저장소 파일이 깨져 있으면 새로 쓴다', () => {
  assert.equal(nextConfigText(CONFIG, '{ 깨진 JSON'), TEXT);
  assert.equal(nextConfigText(CONFIG, ''), TEXT);
});

test('저장된 설정이 비었으면 쓰지 않고 실패한다', () => {
  // 빈 설정을 커밋하면 사이트가 통째로 기본값으로 떨어진다. 조용히 넘어가면 안 된다.
  assert.throws(() => nextConfigText(null, TEXT), /비었/);
  assert.throws(() => nextConfigText({}, TEXT), /비었/);
  assert.throws(() => nextConfigText([1, 2], TEXT), /비었/);
  assert.throws(() => nextConfigText('문자열', TEXT), /비었/);
});
```

- [ ] **Step 2: 실패를 확인**

Run: `node --test syncconfig.test.mjs`
Expected: FAIL — `Cannot find module ... scripts/sync-config.mjs`

- [ ] **Step 3: `scripts/sync-config.mjs` 작성**

```js
// Supabase의 설정 원본을 읽어 저장소의 config.json으로 옮긴다.
// GitHub Actions가 주기적으로 부른다.
//
// 이 사본 덕분에 주민 화면은 Supabase를 전혀 몰라도 되고, Supabase가 죽어도
// 정상 동작한다. 사본이 아니라 '원래 경로'라는 점이 중요하다 — 평소에 안 쓰이는
// 폴백은 고장 나 있어도 아무도 모른다.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const CONFIG_PATH = new URL('../config.json', import.meta.url);

// ---- 순수 함수 (테스트 대상) ----

// 키 순서를 무시하고 비교하기 위해 재귀적으로 키를 정렬한다.
// 배열은 순서가 의미를 가지므로 정렬하지 않는다(fields 순서 = 화면 순서).
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
    return out;
  }
  return value;
}

export function sameConfig(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

// stored: app_config.config (객체). currentText: 저장소 config.json의 현재 내용.
// 같으면 null(쓰지 않음), 다르면 쓸 문자열.
export function nextConfigText(stored, currentText) {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored) || Object.keys(stored).length === 0) {
    throw new Error('저장된 설정이 비었거나 객체가 아닙니다. 커밋하지 않습니다.');
  }

  // admin.html이 지금까지 써 온 형식과 같아야 한다.
  const next = `${JSON.stringify(stored, null, 2)}\n`;

  let current = null;
  try { current = JSON.parse(currentText); } catch { return next; }
  return sameConfig(stored, current) ? null : next;
}

// ---- 아래는 네트워크·파일을 만지므로 자동 테스트하지 않는다 ----

async function main() {
  const local = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const { url, anonKey } = local.reservation || {};
  if (!url || !anonKey) throw new Error('config.json에 reservation.url·anonKey가 없습니다.');

  const res = await fetch(`${url}/rest/v1/app_config?id=eq.1&select=config`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);

  const rows = await res.json();
  const stored = rows && rows[0] ? rows[0].config : null;

  const text = nextConfigText(stored, readFileSync(CONFIG_PATH, 'utf8'));
  if (text === null) {
    console.log('바뀐 내용이 없습니다.');
    return;
  }

  writeFileSync(CONFIG_PATH, text);
  console.log('config.json을 갱신했습니다.');
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

Run: `node --test syncconfig.test.mjs`
Expected: PASS (9개)

- [ ] **Step 5: import 해도 동기화가 안 도는지 확인**

Run: `node --test syncconfig.test.mjs`
Expected: 출력에 "config.json을 갱신했습니다"나 "바뀐 내용이 없습니다"가 **없어야 한다.** 보이면 `import.meta.url` 가드가 잘못된 것이다.

- [ ] **Step 6: 워크플로 작성**

`.github/workflows/config-sync.yml`:

```yaml
name: 설정 동기화

on:
  schedule:
    # 5분마다. GitHub은 정시 실행을 보장하지 않아 실제로는 더 늦을 수 있다.
    - cron: '*/5 * * * *'
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: node scripts/sync-config.mjs
      # 내용이 같으면 스크립트가 파일을 건드리지 않으므로 여기서 커밋도 일어나지 않는다.
      # 5분마다 빈 커밋이 쌓이면 이력이 쓰레기로 차고 되돌리기가 쓸모없어진다.
      - name: 바뀌었으면 커밋
        run: |
          if [ -n "$(git status --porcelain config.json)" ]; then
            git config user.name  "github-actions[bot]"
            git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
            git add config.json
            git commit -m "chore: 관리자 설정 동기화"
            git push
          else
            echo "바뀐 내용이 없습니다."
          fi
```

`GITHUB_TOKEN`은 `actions/checkout@v4`가 자동으로 넣어 두므로 따로 줄 필요가 없다.

- [ ] **Step 7: 전체 테스트 확인**

Run: `node --test calc.test.mjs config.test.mjs github.test.mjs reservations.test.mjs wiring.test.mjs usage.test.mjs notify.test.mjs device.test.mjs configstore.test.mjs syncconfig.test.mjs`
Expected: 전부 PASS

- [ ] **Step 8: 커밋**

```powershell
git add scripts/sync-config.mjs syncconfig.test.mjs .github/workflows/config-sync.yml
git commit -F "$env:TEMP\msg.txt"
```

메시지:

```
feat: Supabase 설정을 config.json으로 동기화하는 워크플로

Why:
- 설정 원본이 Supabase로 옮겨가도 주민 화면은 정적 config.json을 계속 읽어야
  한다. 그래야 Supabase가 죽어도 화면이 정상이고, 페이지 로딩이 왕복을
  기다리지 않는다.
- Actions는 자체 GITHUB_TOKEN으로 자기 저장소에 커밋할 수 있어 개인 토큰이
  필요 없다. 아무도 토큰을 만지지 않게 하는 핵심 조각이다.

What:
- 5분마다 app_config를 읽어 내용이 다를 때만 config.json을 커밋
- 키 순서만 다른 경우는 같은 것으로 본다 — jsonb가 순서를 보존하지 않아
  그대로 비교하면 5분마다 무의미한 커밋이 쌓인다
- 배열 순서는 의미가 있으므로 정렬하지 않는다(fields 순서 = 화면 순서)
- 저장된 설정이 비었으면 커밋하지 않고 실패한다 — 빈 설정을 커밋하면 사이트가
  통째로 기본값으로 떨어진다
```

---

### Task 5: `admin.html` 로그인과 저장

**Files:**
- Modify: `admin.html:241-257` (토큰 영역 마크업), `admin.html:276-296` (import·state), `admin.html:1080-1135` (`renderTokenArea`), `admin.html:1191-1266` (`updateSaveState`·저장), `admin.html:1331-1360` (`loadFromRepo`)

**Interfaces:**
- Consumes: Task 3의 `loadStoredConfig(reservation)`·`saveStoredConfig(reservation, accessToken, config)`, `reservations.js`의 `signIn(reservation, email, password)`
- Produces: 없음 (화면)

**배경.** `manage.html`은 `signIn`으로 받은 `session.access_token`을 `localStorage['guesthouse-staff-token']`에 넣는다. 같은 도메인이므로 `admin.html`이 그 값을 그대로 읽으면 **한쪽에서 로그인하면 다른 쪽도 로그인 상태**다.

- [ ] **Step 1: import와 state 추가**

`admin.html`의 import 블록에 두 줄을 더한다.

```js
import { loadStoredConfig, saveStoredConfig } from './configstore.js';
import { signIn } from './reservations.js';
```

`const TOKEN_KEY = 'guesthouse-admin-token';` 아래에 추가한다.

```js
// manage.html과 같은 키를 쓴다. 한쪽에서 로그인하면 다른 쪽도 로그인 상태가 된다.
const STAFF_KEY = 'guesthouse-staff-token';
```

`state` 객체의 `token:` 줄 아래에 추가한다.

```js
  // GitHub 토큰(state.token)은 이제 서식 이미지 교체에만 쓴다.
  // 설정 저장은 아래 로그인 토큰으로 한다.
  staffToken: (() => { try { return localStorage.getItem(STAFF_KEY) || ''; } catch { return ''; } })(),
```

- [ ] **Step 2: 로그인 영역 마크업으로 교체**

`admin.html:241-242`는 정확히 이 두 줄이다.

```html
      <h2 style="margin-top:22px;">GitHub 토큰</h2>
      <div id="tokenArea"></div>
```

이 두 줄을 아래로 교체한다. `id="tokenArea"`는 사라지지 않고 `<details>` 안으로 옮겨 간다 — `renderTokenArea`가 계속 쓰기 때문에 지우면 이미지 교체가 죽는다.

```html
<h2 style="margin-top:22px;">로그인</h2>
<div id="authArea"></div>

<details style="margin-top:22px;">
  <summary style="cursor:pointer; font-size:14px; color:#7A8177;">서식 이미지 교체 (관리자 전용)</summary>
  <p class="hint" style="margin-top:10px;">
    서식 이미지를 바꿀 때만 GitHub 토큰이 필요합니다. 요금·계좌·항목만 고칠 때는
    로그인만으로 충분합니다.
  </p>
  <div id="tokenArea"></div>
</details>
```

- [ ] **Step 3: `renderAuthArea` 추가**

`renderTokenArea` 함수 **바로 위**에 추가한다. `renderTokenArea`는 그대로 둔다(이미지 교체용으로 계속 쓴다).

```js
function renderAuthArea() {
  const host = $('authArea');
  host.textContent = '';

  if (state.staffToken) {
    const banner = document.createElement('div');
    banner.className = 'banner banner-info';
    banner.textContent = '로그인되어 있습니다. 저장할 수 있습니다.';
    host.appendChild(banner);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-danger btn-sm';
    btn.textContent = '로그아웃';
    btn.addEventListener('click', () => {
      state.staffToken = '';
      try { localStorage.removeItem(STAFF_KEY); } catch { /* 저장 막힌 환경 */ }
      renderAll();
      renderAuthArea();
      showToast('로그아웃했습니다.');
    });
    host.appendChild(btn);
    return;
  }

  const banner = document.createElement('div');
  banner.className = 'banner banner-warn';
  banner.innerHTML = `
    로그인하지 않으면 편집과 미리보기는 되지만 <strong>저장할 수 없습니다.</strong><br>
    관리사무소 계정(예약 확인 화면과 같은 계정)으로 로그인해 주세요.
  `;
  host.appendChild(banner);

  const emailField = document.createElement('div');
  emailField.className = 'field';
  const email = document.createElement('input');
  email.type = 'email';
  email.placeholder = '이메일';
  email.autocomplete = 'username';
  emailField.appendChild(email);
  host.appendChild(emailField);

  const pwField = document.createElement('div');
  pwField.className = 'field';
  const password = document.createElement('input');
  password.type = 'password';
  password.placeholder = '비밀번호';
  password.autocomplete = 'current-password';
  pwField.appendChild(password);
  host.appendChild(pwField);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-primary btn-sm';
  btn.textContent = '로그인';

  function submit() {
    if (!email.value || !password.value) return;
    btn.disabled = true;
    signIn(state.config.reservation, email.value.trim(), password.value)
      .then((session) => {
        state.staffToken = session.access_token;
        try { localStorage.setItem(STAFF_KEY, state.staffToken); } catch { /* 저장 막힌 환경 */ }
        showToast('로그인했습니다.');
        renderAuthArea();
        renderAll();
      })
      .catch(() => {
        btn.disabled = false;
        showToast('로그인하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.');
      });
  }

  btn.addEventListener('click', submit);
  password.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  host.appendChild(btn);
}
```

- [ ] **Step 4: 저장 버튼의 잠금 조건 바꾸기**

`updateSaveState`에서 토큰 대신 로그인을 본다. 원래:

```js
  if (!state.token) parts.push('토큰이 없어 저장할 수 없습니다.');
  if (state.imageFile) parts.push('새 서식 이미지가 함께 올라갑니다.');
  $('saveState').innerHTML = parts.join(' · ');
  $('save').disabled = state.saving || !state.dirty || !state.token;
```

바꾼 뒤:

```js
  if (!state.staffToken) parts.push('로그인해야 저장할 수 있습니다.');
  if (state.imageFile && !state.token) parts.push('서식 이미지를 올리려면 GitHub 토큰이 필요합니다.');
  else if (state.imageFile) parts.push('새 서식 이미지가 함께 올라갑니다.');
  $('saveState').innerHTML = parts.join(' · ');
  $('save').disabled = state.saving || !state.dirty || !state.staffToken;
```

- [ ] **Step 5: 저장 경로를 Supabase로 바꾸기**

`$('save')` 클릭 핸들러 전체(`admin.html:1202`부터 `});`까지)를 아래로 교체한다.

```js
$('save').addEventListener('click', () => {
  if (!state.staffToken) { showToast('먼저 로그인해 주세요.'); return; }
  const now = new Date();
  state.saving = true;
  updateSaveState();

  // 서식 이미지는 아직 저장소에 커밋한다. 그래서 이때만 GitHub 토큰이 필요하다.
  // 이미지를 먼저 올린다 — 설정이 먼저 저장되면 아직 없는 파일을 가리킨다.
  const uploadImage = state.imageFile
    ? (state.token
        ? readFileAsBase64(state.imageFile).then((content) => {
            const ext = (state.imageFile.name.split('.').pop() || 'jpg').toLowerCase();
            const path = imageFileName(now, ext);
            return createClient({ repo: REPO, token: state.token })
              .putFile({ path, content, message: `chore: 서식 이미지 교체 (${path})` })
              .then(() => path);
          })
        : Promise.reject(new Error('서식 이미지를 올리려면 GitHub 토큰이 필요합니다.')))
    : Promise.resolve(null);

  uploadImage
    .then((imagePath) => {
      const config = clone(state.config);
      if (imagePath) config.form.image = imagePath;
      const text = `${JSON.stringify(config, null, 2)}\n`;

      if (!imagePath && text === state.savedText) {
        state.dirty = false;
        showToast('바뀐 내용이 없습니다.');
        renderAll();
        return null;
      }

      return saveStoredConfig(state.config.reservation, state.staffToken, config).then(() => {
        state.config = config;
        state.savedText = text;
        if (state.imageUrl) { URL.revokeObjectURL(state.imageUrl); state.imageUrl = null; }
        state.imageFile = null;
        state.dirty = false;
        showToast('저장했습니다. 약 10분 안에 모두에게 반영됩니다.');
        renderAll();
      });
    })
    .catch((err) => {
      // 세션이 만료되면 편집 내용을 남긴 채 다시 로그인시킨다. 편집을 날려버리면
      // 직원은 무엇을 고치고 있었는지 기억해서 다시 입력해야 한다.
      if (err.status === 401) {
        state.staffToken = '';
        try { localStorage.removeItem(STAFF_KEY); } catch { /* 저장 막힌 환경 */ }
        renderAuthArea();
        showToast('로그인이 만료되었습니다. 다시 로그인하면 편집 내용 그대로 저장됩니다.');
      } else {
        showToast(`저장하지 못했습니다: ${err.message}`);
      }
    })
    .finally(() => {
      state.saving = false;
      updateSaveState();
    });
});
```

**`state.sha`는 더 이상 설정 저장에 쓰지 않는다.** 되돌리기가 쓰므로 남겨 두되, 저장 경로에서만 뺀다.

- [ ] **Step 6: 불러오기를 Supabase 우선으로 바꾸기**

`loadFromRepo` 전체를 아래로 교체한다. 이름은 그대로 둔다 — 부르는 곳이 셋이다.

```js
function loadFromRepo() {
  // 원본은 Supabase다. 로그인 여부와 무관하게 익명으로 읽을 수 있다.
  // Supabase에 닿지 못하면 정적 config.json으로 물러서서 편집·미리보기는 되게 한다.
  return loadConfig()
    .then((fallback) => {
      state.config = fallback;
      return loadStoredConfig(fallback.reservation).catch(() => null);
    })
    .then((stored) => {
      if (stored) {
        state.config = normalizeConfig(stored);
      } else {
        showToast('저장된 설정을 불러오지 못했습니다. 파일 값으로 편집합니다.');
      }
      state.dirty = false;
      state.selected = null;
      snapshotSaved();
      renderAuthArea();
      renderAll();
    });
}
```

- [ ] **Step 7: 문법 검사와 전체 테스트**

인라인 모듈 스크립트에 오타가 있으면 페이지 전체가 죽는다. 문법을 확인한다.

```powershell
$t = [IO.File]::ReadAllText("C:\workspace\new\admin.html")
$m = [regex]::Match($t, '(?s)<script type="module">(.*?)</script>')
[IO.File]::WriteAllText("$env:TEMP\admin.check.mjs", $m.Groups[1].Value)
node --check "$env:TEMP\admin.check.mjs"
```

Expected: 출력 없음(정상)

Run: `node --test calc.test.mjs config.test.mjs github.test.mjs reservations.test.mjs wiring.test.mjs usage.test.mjs notify.test.mjs device.test.mjs configstore.test.mjs syncconfig.test.mjs`
Expected: 전부 PASS

- [ ] **Step 8: 커밋**

```powershell
git add admin.html
git commit -F "$env:TEMP\msg.txt"
```

메시지:

```
feat: 관리자 설정 저장을 GitHub 토큰에서 로그인으로 전환

Why:
- 이 화면을 쓸 사람은 관리사무소 직원이고 개발자가 아니다. 파인그레인드 토큰
  발급·갱신을 설명해야 했고, 만료는 저장이 실패하고 나서야 알 수 있었다.

What:
- manage.html과 같은 계정으로 로그인해 설정을 저장한다. 세션 키를 공유하므로
  한쪽에서 로그인하면 다른 쪽도 로그인 상태다
- 설정은 Supabase app_config에 저장하고, 불러올 때도 Supabase를 먼저 본다.
  닿지 못하면 정적 config.json으로 물러서서 편집·미리보기는 계속 된다
- 세션이 만료되면(401) 편집 내용을 남긴 채 로그인 폼만 다시 띄운다
- 서식 이미지 교체만 GitHub 토큰을 계속 쓰며 '관리자 전용'으로 접어 둔다
- 반영까지 최대 10분이 걸리므로 저장 안내 문구를 그에 맞게 바꿨다
```

---

### Task 6: 되돌리기와 잠금 방지

**Files:**
- Modify: `admin.html:1270-1276` (이력 불러오기), `admin.html:1305` 이후 (`restore`)
- Modify: `admin.html` 저장 경로 (예약 설정 검증)

**Interfaces:**
- Consumes: Task 2의 익명 GitHub 읽기, Task 3의 `saveStoredConfig`
- Produces: 없음

- [ ] **Step 1: 이력 조회에서 토큰 요구를 없애기**

원래:

```js
$('loadHistory').addEventListener('click', () => {
  if (!state.token) { showToast('이력을 보려면 토큰이 필요합니다.'); return; }
  createClient({ repo: REPO, token: state.token })
```

바꾼 뒤:

```js
$('loadHistory').addEventListener('click', () => {
  // 공개 저장소라 이력은 익명으로 읽힌다. 토큰이 필요 없다.
  // 익명 호출은 IP당 시간당 60회 제한이 있으나 이력을 여는 일은 드물다.
  createClient({ repo: REPO, token: state.token })
```

`state.token`이 비어 있으면 `buildHeaders`가 `Authorization`을 빼므로 그대로 익명 호출이 된다(Task 2).

- [ ] **Step 2: 되돌리기가 Supabase에 쓰도록 바꾸기**

`restore(sha)` 함수 전체를 아래로 교체한다.

```js
// 옛 커밋에서 설정을 읽어 Supabase에 되돌린다.
// 저장소에 직접 되돌리면 다음 동기화가 도로 덮어쓴다 — Supabase가 원본이다.
function restore(sha) {
  if (!state.staffToken) { showToast('되돌리려면 먼저 로그인해 주세요.'); return; }
  createClient({ repo: REPO, token: state.token })
    .getCommitContent('config.json', sha)
    .then((text) => {
      if (!text) throw new Error('그 시점의 설정을 찾지 못했습니다.');
      const restored = normalizeConfig(JSON.parse(text));
      return saveStoredConfig(state.config.reservation, state.staffToken, restored).then(() => {
        state.config = restored;
        state.savedText = `${JSON.stringify(restored, null, 2)}\n`;
        state.dirty = false;
        state.selected = null;
        showToast('되돌렸습니다. 약 10분 안에 모두에게 반영됩니다.');
        renderAll();
      });
    })
    .catch((err) => showToast(`되돌리지 못했습니다: ${err.message}`));
}
```

- [ ] **Step 3: 스스로를 잠그는 것을 막기**

Supabase 주소·키를 잘못 저장하면 `admin.html`이 Supabase에 못 붙어 다시 고칠 수 없게 된다. 저장 전에 실제로 읽어 본다.

Task 5에서 만든 `$('save')` 핸들러의 `uploadImage` 정의 **바로 위**에 넣는다.

```js
  // 예약 설정을 바꿨다면 그 주소·키로 실제 호출을 해 본다. 잘못된 값이 저장되면
  // 다음 새로고침부터 Supabase에 못 붙어 스스로를 잠근다.
  const current = state.config.reservation;
  const saved = state.savedText ? JSON.parse(state.savedText).reservation : null;
  const reservationChanged = !saved
    || saved.url !== current.url
    || saved.anonKey !== current.anonKey
    || saved.enabled !== current.enabled;

  const verify = (reservationChanged && current.enabled)
    ? loadStoredConfig(current).then((row) => {
        if (!row) throw new Error('그 주소·키로 설정을 읽지 못했습니다. 값을 다시 확인해 주세요.');
      })
    : Promise.resolve();
```

그리고 `uploadImage` 체인의 시작을 `verify`로 감싼다. 원래:

```js
  uploadImage
    .then((imagePath) => {
```

바꾼 뒤:

```js
  verify
    .then(() => uploadImage)
    .then((imagePath) => {
```

- [ ] **Step 4: 문법 검사와 전체 테스트**

```powershell
$t = [IO.File]::ReadAllText("C:\workspace\new\admin.html")
$m = [regex]::Match($t, '(?s)<script type="module">(.*?)</script>')
[IO.File]::WriteAllText("$env:TEMP\admin.check.mjs", $m.Groups[1].Value)
node --check "$env:TEMP\admin.check.mjs"
```

Expected: 출력 없음

Run: `node --test calc.test.mjs config.test.mjs github.test.mjs reservations.test.mjs wiring.test.mjs usage.test.mjs notify.test.mjs device.test.mjs configstore.test.mjs syncconfig.test.mjs`
Expected: 전부 PASS

- [ ] **Step 5: 커밋**

```powershell
git add admin.html
git commit -F "$env:TEMP\msg.txt"
```

메시지:

```
feat: 되돌리기를 Supabase에 쓰고 잠금 경로를 막음

Why:
- 설정 원본이 Supabase로 옮겨졌으므로 저장소에 되돌리면 다음 동기화가 도로
  덮어쓴다.
- Supabase 주소·키를 잘못 저장하면 admin.html이 Supabase에 못 붙어 다시 고칠
  방법이 없어진다. 예전에는 GitHub 토큰으로 언제든 되돌릴 수 있었다.

What:
- 되돌리기가 옛 커밋에서 설정을 읽어 Supabase에 쓴다
- 이력 조회에서 토큰 요구를 없앴다 — 공개 저장소라 익명으로 읽힌다
- 예약 설정을 바꿔 저장할 때 그 주소·키로 실제 호출을 해 보고 실패하면 막는다
```

---

### Task 7: `manage.html` 링크와 README

**Files:**
- Modify: `manage.html` (헤더에 `admin.html` 링크)
- Modify: `README.md`

**Interfaces:**
- Consumes: 없음
- Produces: 없음

- [ ] **Step 1: `manage.html`에 설정 화면 링크 추가**

`manage.html`의 로그인 이후 화면 상단(탭 위)에 한 줄을 넣는다. 세션이 공유되므로 눌러서 넘어가면 이미 로그인 상태다.

```html
<p style="margin:0 0 12px; font-size:13px;">
  <a href="admin.html" style="color:#1F6D57;">설정 바꾸기 (요금 · 계좌 · 항목)</a>
</p>
```

- [ ] **Step 2: README의 관리자 절 교체**

"## 관리자" 절에서 토큰 발급 절차(1~4번)를 지우고 아래로 바꾼다.

```markdown
## 관리자

`admin.html`에서 요금·계좌·입력 항목·칸 위치를 바꿉니다.

1. `manage.html`과 **같은 계정**으로 로그인합니다. 예약 확인 화면에서 이미
   로그인했다면 그대로 넘어가면 됩니다.
2. 값을 고치고 "미리보기 & 저장" 탭에서 실제 화면을 확인한 뒤 저장합니다.
3. **반영까지 최대 10분쯤 걸립니다.** 저장은 즉시 되지만, 주민 화면에 쓰이는
   `config.json`은 5분마다 도는 동기화 작업이 갱신합니다.
4. 잘못 저장했다면 "되돌리기"에서 이전 설정을 불러옵니다.

직원 계정은 Supabase Authentication → Users에서 추가합니다(아래 예약 시스템
설정 절과 같습니다). **예약 확인과 설정 변경은 같은 권한입니다** — 로그인할 수
있는 사람은 요금과 계좌도 바꿀 수 있습니다.

### 설정의 원본은 Supabase입니다

`config.json`은 자동으로 만들어지는 **사본**입니다. 저장소에서 직접 고치면
다음 동기화가 덮어씁니다. 값을 바꾸려면 `admin.html`을 쓰세요.

이렇게 나눈 이유는 주민 화면이 Supabase를 몰라도 되게 하기 위해서입니다.
Supabase가 멈춰도 신청서·예약 화면은 정적 `config.json`으로 정상 동작합니다.

### 서식 이미지 교체 (관리자 전용)

서식 이미지를 바꿀 때만 GitHub 토큰이 필요합니다. `admin.html`의 "서식 이미지
교체" 항목을 펼치면 나옵니다. 요금·계좌·항목만 고칠 때는 로그인만으로 충분합니다.

토큰은 Settings → Developer settings → Personal access tokens → Fine-grained
tokens 에서 이 저장소 하나만 선택하고 **Contents: Read and write** 권한만 주어
만듭니다. 공용 PC에서 썼다면 반드시 "토큰 삭제"를 누르세요.

### 잠겼을 때 복구하기

`admin.html`에서 예약 기능의 주소·키를 잘못 저장하면 Supabase에 못 붙어 다시
고칠 수 없게 됩니다. 저장 전에 검증하므로 웬만해선 막히지만, 그래도 막혔다면:

1. Supabase SQL Editor에서 `app_config`를 직접 고칩니다. **이것이 정석입니다.**

   ```sql
   update app_config set config = jsonb_set(config, '{reservation,url}', '"https://올바른주소"') where id = 1;
   ```

2. 그것도 막혔으면 저장소의 `config.json`을 직접 고칩니다. 주민 화면은 즉시
   복구되지만 다음 동기화가 다시 덮어쓰므로 **1번을 반드시 해야 합니다.**
```

"### 왜 공개 URL이어도 안전한가"와 "### 토큰 관리" 절은 토큰 기준으로 쓰여 있으므로, 서식 이미지 토큰에만 해당한다는 것이 위 절에 담겼으니 **지운다.**

- [ ] **Step 3: README의 "개발" 절 테스트 명령 갱신**

```bash
node --test calc.test.mjs config.test.mjs github.test.mjs reservations.test.mjs wiring.test.mjs usage.test.mjs notify.test.mjs device.test.mjs configstore.test.mjs syncconfig.test.mjs
```

- [ ] **Step 4: README의 "설정 구조" 표에 추가**

```
| `configstore.js` | Supabase에 저장된 설정 원본을 읽고 쓰기 |
```

- [ ] **Step 5: 전체 테스트 확인**

Run: `node --test calc.test.mjs config.test.mjs github.test.mjs reservations.test.mjs wiring.test.mjs usage.test.mjs notify.test.mjs device.test.mjs configstore.test.mjs syncconfig.test.mjs`
Expected: 전부 PASS (`wiring.test.mjs`가 `manage.html`을 검사하므로 링크 추가가 깨뜨리지 않았는지 함께 확인된다)

- [ ] **Step 6: 커밋**

```powershell
git add manage.html README.md
git commit -F "$env:TEMP\msg.txt"
```

메시지:

```
docs: 관리자 절차를 로그인 기준으로 다시 쓰고 화면 연결

Why:
- 설정 저장이 토큰에서 로그인으로 바뀌었는데 README는 토큰 발급 절차를
  설명하고 있었다. 직원이 그대로 따라 하면 필요 없는 일을 하게 된다.

What:
- 관리자 절을 로그인 절차로 교체하고 반영까지 10분이 걸린다는 것을 명시
- config.json이 자동 생성되는 사본이고 원본은 Supabase라는 것을 적음
- 서식 이미지 교체에만 토큰이 필요하다는 것을 별도 절로 분리
- 잘못된 주소·키를 저장해 잠겼을 때의 복구 절차 추가
- manage.html에서 admin.html로 가는 링크 추가 (세션이 공유되어 바로 들어간다)
```

---

## 완료 기준

- [ ] `node --test` 10개 파일 전부 통과
- [ ] 로그아웃 상태에서 `admin.html`을 열면 편집·미리보기는 되고 저장만 잠긴다
- [ ] `manage.html`에서 로그인한 뒤 `admin.html`을 열면 이미 로그인 상태다
- [ ] 저장하면 Supabase `app_config`가 바뀌고, 5~10분 안에 `config.json`이 갱신된다
- [ ] 아무것도 바꾸지 않고 동기화 워크플로를 수동 실행하면 **커밋이 생기지 않는다**
- [ ] 세션 만료 후 저장을 누르면 편집 내용이 살아 있는 채로 로그인 폼이 뜬다
- [ ] 잘못된 Supabase 주소를 넣고 저장하면 거부된다
- [ ] 이력 불러오기가 토큰 없이 동작하고, 되돌리기는 로그인 상태에서 Supabase에 쓴다
- [ ] 서식 이미지 교체는 "관리자 전용"을 펼쳐야 나온다
