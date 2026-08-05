# 신청서 생성 건수 텔레그램 일일 알림 설계

날짜: 2026-08-05

## 배경

주민이 신청서를 만드는 과정은 **전부 주민 브라우저 안에서 끝난다.** 서식 이미지를
캔버스에 그려 JPG로 만들고 문자로 보내는 것이 전부라 서버에 아무 흔적도 남지
않는다. 그래서 관리사무소는 이 화면이 실제로 쓰이는지, 얼마나 쓰이는지 알 방법이
없다. 문자가 오면 그때 한 건을 아는 것이 전부다.

알고 싶은 것은 **하루에 몇 건이 만들어졌는지**, 숫자 하나다. 누가 만들었는지는
알 필요가 없다 — 그건 어차피 문자로 온다.

## 결정: 하루 1행 카운터 + GitHub Actions 발송

브라우저는 Supabase RPC로 카운터를 +1 하고, 매일 아침 GitHub Actions가 그 숫자를
읽어 텔레그램으로 보낸다.

### 왜 브라우저에서 텔레그램을 직접 부르지 않는가

이 사이트는 정적 페이지다. 브라우저가 텔레그램 API를 부르려면 봇 토큰이 소스에
들어가야 하고, 그러면 **누구나 그 토큰으로 채팅방에 아무 메시지나 보낼 수 있다.**
`admin.html`에 비밀번호 게이트를 두지 않은 것과 같은 판단이다 — 보안이 아니라
보안처럼 보이는 것이다.

토큰은 브라우저가 닿지 않는 곳에 있어야 한다.

### 검토했다가 버린 대안

| 방법 | 버린 이유 |
|---|---|
| 이벤트 로그 테이블 (누를 때마다 1행) | 지금 필요한 것은 숫자 하나인데 행이 무한히 쌓인다. 시간대별 분석은 요구된 적이 없다 |
| Supabase Edge Function + `pg_cron` | 이 저장소는 빌드 스텝이 없는 정적 사이트다. Edge Function은 Deno·CLI 배포 파이프라인을 새로 들인다. 실패 로그를 찾기도 어렵다 |
| `pg_net`으로 DB가 직접 텔레그램 호출 | 토큰을 DB Vault에 넣어야 한다. 무료 프로젝트가 일시정지되면 cron도 같이 멈춘다 |

### GitHub Actions를 고른 근거

- 토큰이 Secrets에 있고, 저장소가 이미 GitHub 위에 있다
- 실행 로그가 그대로 보이고 `workflow_dispatch`로 언제든 수동 실행해 볼 수 있다
- **덤: 매일 Supabase를 건드려서 무료 프로젝트 일시정지를 막는다.** 무료 티어는
  한 주 동안 접속이 없으면 정지되는데(README), 이 워크플로가 그걸 막는다

cron이 정시에 안 도는 경우가 있지만(GitHub은 지연을 보장하지 않는다) 일일 집계라
수십 분 밀려도 상관없다.

## DB 변경

```sql
create table if not exists usage_daily (
  day   date primary key,
  typed int not null default 0,   -- index.html (타이핑)
  hand  int not null default 0    -- draw.html  (손글씨)
);

alter table usage_daily enable row level security;
-- 정책을 하나도 만들지 않는다 = anon은 이 테이블을 읽지도 쓰지도 못한다.
-- 접근은 아래 두 함수(security definer)를 통해서만 열린다.
```

### 날짜는 반드시 한국 시간으로

```sql
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
```

`current_date`를 쓰면 안 된다. Supabase는 UTC로 돌아가므로 **한국 시간 저녁 9시
이후에 만든 신청서가 다음 날로 잡힌다.** `reservations.js`가 `toISOString()`을
피하고 로컬 값을 직접 조립한 것과 같은 함정이다.

`on conflict do update`라 그날 첫 건이면 행을 만들고, 이후에는 더한다. 행은 하루에
하나뿐이다.

### 조회 함수

```sql
create or replace function get_usage(p_day date)
returns table (day date, typed int, hand int)
language sql
security definer
set search_path = public
as $$
  select u.day, u.typed, u.hand from usage_daily u where u.day = p_day;
$$;
```

그날 아무 일도 없었으면 **0행을 돌려준다.** 부르는 쪽이 0으로 해석한다.

### 권한

```sql
grant execute on function bump_usage(text) to anon;
grant execute on function get_usage(date) to anon;
```

집계 숫자에는 개인정보가 없으므로 `get_usage`를 `anon`에 열어도 잃을 것이 없다.
덕분에 GitHub Actions도 **공개된 anon 키를 그대로 쓴다** — 새 비밀을 만들지 않고,
`service_role` 키도 쓰지 않는다(README의 원칙).

### 숫자 조작은 막지 않는다

공개 사이트라 누구든 `bump_usage`를 반복 호출해 숫자를 부풀릴 수 있다. 얻는 것은
텔레그램에 뜨는 숫자가 틀리는 것뿐이고, 데이터가 새거나 예약이 망가지지는 않는다.
방어 장치를 넣을 값어치가 없다.

실제로 남용이 보이면 그때 IP당 제한을 넣는다. 지금 구조를 바꾸지 않는다.

## 브라우저 변경

### 새 파일 `usage.js`

```js
// 신청서가 몇 건 만들어졌는지만 센다. 개인정보는 보내지 않는다.
import { buildRequest } from './reservations.js';

// 순수 함수. 예약 기능이 꺼져 있으면 null을 돌려준다.
export function buildBumpRequest(reservation, source) {
  if (!reservation || !reservation.enabled) return null;
  return buildRequest(reservation, {
    path: '/rest/v1/rpc/bump_usage',
    method: 'POST',
    body: { p_source: source },
    minimal: true,
  });
}

export function bumpUsage(reservation, source) {
  const req = buildBumpRequest(reservation, source);
  if (!req) return Promise.resolve();
  // 집계는 부수적인 일이다. 실패해도 주민에게 알리지 않는다.
  return fetch(req.url, req.options).catch(() => {});
}
```

`reservations.js`가 순수한 `buildRequest`와 네트워크를 타는 `request`를 나눈 것과
같은 구조다. **조립은 테스트로 고정되고, `fetch` 한 줄만 테스트 밖에 남는다.**

**별도 파일로 두는 이유.** `index.html`·`draw.html`은 예약과 아무 상관이 없는
화면이다. 집계 한 줄을 위해 `reservations.js`를 통째로 끌어오면 "이 화면이 예약
기능에 의존한다"는 잘못된 신호가 된다. 헤더 조립(`buildRequest`)만 재사용한다 —
이미 테스트로 고정된 코드다.

**`reservation.enabled`로 잠그는 이유.** `enabled`는 URL과 키가 둘 다 있을 때만
참이다(`config.js`). 예약 기능을 꺼두면 집계도 함께 꺼지는데, 어차피 주소와 키가
없으면 부를 곳이 없다.

### 부르는 위치

**이미지 파일 생성에 성공한 직후**에 부른다. 버튼 클릭 시점이 아니다 — 캔버스가
아직 준비되지 않았거나 이미지 생성이 실패한 건까지 세면 숫자가 거짓이 된다.

| 파일 | 위치 | `source` |
|---|---|---|
| `index.html` | `$('share')` 핸들러, `toJpegFile()` 성공 후 | `'typed'` |
| `index.html` | `$('download')` 핸들러, `toJpegFile()` 성공 후 | `'typed'` |
| `draw.html` | `$('sendBtn')` 핸들러, `toJpegFile()` 성공 후 | `'hand'` |
| `draw.html` | `$('saveBtn')` 핸들러, `toJpegFile()` 성공 후 | `'hand'` |

**`await` 하지 않는다.** 신청서를 만드는 흐름은 집계를 기다리지 않는다. 네트워크가
죽어 있어도 주민은 아무 차이를 못 느껴야 한다. 이 화면의 존재 이유는 신청서를
만드는 것이고, 집계는 곁다리다.

`draw.html`은 `var`/`function` 스타일로 쓰여 있으므로 그 파일 안에서는 기존 문법을
따른다.

### 중복 제거는 하지 않는다

"보내기"가 실패해서 "저장"을 다시 누르면 2로 센다. 세대별로 합치려면 이름·동호수를
서버로 보내야 하는데, **개인정보를 보내지 않는다는 이번 결정과 정면으로 부딪힌다.**

그래서 숫자의 의미를 정직하게 맞춘다. 메시지에 "신청 3세대"가 아니라 "신청서
3건"이라고 쓴다 — 실제로 세는 것은 만들어진 이미지의 수다.

## 발송

### `scripts/notify-usage.mjs`

1. `config.json`에서 `reservation.url`·`reservation.anonKey`를 읽는다 — 설정 출처를
   하나로 유지한다. Actions에 Supabase 주소를 따로 적어두면 나중에 프로젝트를
   옮길 때 한쪽만 고치고 끝나는 사고가 난다
2. `get_usage(어제)`를 부른다. 어제는 **한국 시간 기준**으로 계산한다
3. 메시지를 만들어 텔레그램 `sendMessage`로 보낸다
4. 텔레그램이 2xx가 아니면 **0이 아닌 코드로 종료한다.** 조용히 성공한 척하면
   워크플로가 초록불인데 알림은 안 오는 상태를 못 알아챈다

Node 20의 내장 `fetch`를 쓴다. 의존성을 추가하지 않는다.

### 메시지 형식

```
📋 8월 4일 신청서 3건
   타이핑 2 · 손글씨 1
```

0건인 날:

```
📋 8월 4일 신청서 0건
```

**0건이어도 보낸다.** 안 오면 시스템이 고장 난 것으로 읽을 수 있다. 침묵이 "조용한
날"인지 "죽은 워크플로"인지 구분되지 않는 쪽이 더 나쁘다.

### `.github/workflows/usage-notify.yml`

```yaml
name: 일일 사용량 알림

on:
  schedule:
    - cron: '0 22 * * *'   # UTC 22:00 = KST 07:00
  workflow_dispatch:        # 손으로 눌러 테스트

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

## 준비 절차 (사람이 하는 일)

봇 생성은 자동화할 수 없다. README에 적는다.

1. 텔레그램에서 **@BotFather** 에게 `/newbot` — 이름을 정하면 토큰을 준다
2. 알림 받을 방(1:1 대화도 됨)에 그 봇을 초대하고 아무 메시지나 하나 보낸다
3. `https://api.telegram.org/bot<토큰>/getUpdates` 를 열어 `chat.id`를 확인한다.
   그룹이면 음수(`-100...`)다
4. 저장소 Settings → Secrets and variables → Actions 에서 `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_CHAT_ID` 등록
5. Actions 탭에서 "일일 사용량 알림"을 **Run workflow**로 한 번 눌러 확인

## 테스트

기존 원칙대로 **순수 함수만 자동 테스트한다.** 네트워크를 타는 코드는 테스트하지
않는다.

`usage.test.mjs`:

- `buildBumpRequest`가 만드는 URL·메서드·본문·헤더를 고정
- `reservation.enabled`가 거짓이면 `null`을 돌려준다(요청을 만들지 않는다)
- `source`가 `'typed'`/`'hand'`일 때 본문의 `p_source`가 그대로 실린다

`notify.test.mjs` — 메시지 조립을 순수 함수(`formatMessage`)로 빼서 검증:

- 3건(타이핑 2·손글씨 1) → 두 줄 메시지
- 0행(그날 기록 없음) → "0건" 한 줄
- 타이핑만 있고 손글씨가 0 → 내역 줄에 둘 다 표시(0을 숨기면 어느 화면이 안 쓰이는지
  안 보인다)
- 한국 시간 기준 '어제' 계산: UTC 자정 직후(한국 오전 9시)에 돌려도 하루가 밀리지
  않는다

브라우저·실제 환경으로 확인할 것:

1. `index.html`에서 이미지를 만들면 `usage_daily`의 `typed`가 1 오른다
2. `draw.html`에서 만들면 `hand`가 오른다
3. 이미지 생성이 실패하면(서식 이미지 미로딩) 숫자가 오르지 않는다
4. Supabase를 꺼둔 설정(`reservation.enabled: false`)에서도 신청서가 정상 동작한다
5. 오프라인 상태에서 이미지 저장이 평소와 똑같이 된다 — 집계 실패가 안 보인다
6. 한국 시간 밤 11시에 만든 건이 **그날** 행에 들어간다(다음 날이 아니다)
7. `workflow_dispatch`로 실행하면 텔레그램에 메시지가 온다
8. 토큰을 일부러 틀리면 워크플로가 빨간불로 끝난다

## README 반영

- "개발" 절의 테스트 명령에 `usage.test.mjs`·`notify.test.mjs` 추가
- "설정 구조" 표에 `usage.js` 한 줄 추가
- 텔레그램 알림 절을 새로 만들어 준비 절차와 "무엇을 세는가"(이미지 생성 횟수,
  세대 수가 아님)를 적는다
