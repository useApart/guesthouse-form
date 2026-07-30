# 게스트하우스 예약 달력 설계

작성일: 2026-07-29

## 배경

지금 이 앱은 예약을 모른다. 주민이 신청서 JPG를 만들어 **문자로 보내는 것**으로 끝나고,
접수와 일정 관리는 앱 밖 관리사무소의 종이 장부에서 일어난다.

그래서 주민은 어느 날이 비었는지 알 수 없다. 신청해 보고 나서야 이미 찼다는 답을 듣는다.
관리사무소도 문자를 하나씩 열어 장부와 대조해야 한다.

달력에서 빈 날을 보고 그 자리에서 신청할 수 있게 한다.

## 이 기능이 지금까지의 작업과 다른 점

`config.json`은 **관리자 한 명만 쓰고** 주민은 읽기만 했다. 그래서 서버 없이 GitHub에
파일 하나를 두는 것으로 충분했다.

예약은 **여러 사람이 쓰는 공유 데이터**다. 주민이 데이터를 쓴다는 뜻이고, 정적 사이트에는
쓸 곳이 없다. GitHub 토큰을 주민에게 나눠줄 수는 없다. **서버가 필요하다.**

그 결과 README의 약속 하나가 깨진다.

> 입력한 정보는 서버로 전송되지 않고 본인 브라우저에만 저장됩니다.

이름·동호수·연락처가 외부 서버에 저장된다. 이것은 주민에게 고지해야 할 변화다.

## 목표

- 주민이 달력에서 빈 날을 확인하고 그 자리에서 신청
- 신청은 **대기(pending)** 상태로 들어가고, 관리사무소가 입금을 확인해 **확정**
- 같은 집에 날짜가 겹치는 예약이 생기지 않음
- 달력에 다른 주민의 이름·연락처가 노출되지 않음
- 관리사무소 직원이 쓸 수 있을 만큼 단순한 승인 화면

## 비목표 (YAGNI)

- **온라인 결제.** 지금처럼 계좌이체를 받고 관리사무소가 확인한다.
- **주민 계정·로그인.** 같은 단지 주민 대상이고 승인 절차가 있으므로 과하다.
- **알림(문자·이메일 자동 발송).** 확정 여부는 달력에서 확인한다.
- **손글씨 페이지 정리.** `draw.html`은 그대로 둔다. 쓰임새를 본 뒤 판단한다.
- **관리사무소 직원 계정 여러 개, 권한 분리.** 계정 하나를 공유한다.

## 아키텍처

```
                          ┌──────────────┐
   주민 ─── 달력에서 신청 ─▶│              │  insert만 허용 (익명 키)
                          │   Supabase   │
   관리사무소 ─ 확정/취소 ─▶│  (Postgres)  │  이메일·비밀번호 로그인 후 전체 권한
                          └──────────────┘
                                 │ 날짜·집·상태만 공개
                                 ▼
                          주민 달력에 "예약됨" 표시
```

**SDK를 쓰지 않고 `fetch`만으로 호출한다.** Supabase의 REST API(PostgREST)는 평범한
HTTP다. 라이브러리가 필요 없으므로 이 프로젝트의 "의존성 0"이 유지된다.

### 파일 구성

| 파일 | 책임 | 상태 |
|---|---|---|
| `reservations.js` | Supabase REST 래퍼 · 달력 가용성 계산 · secret 생성 | 신규 |
| `reservations.test.mjs` | 위의 순수 함수 테스트 | 신규 |
| `reserve.html` | 주민용 예약 화면 (달력 → 신청서 → 완료) | 신규 |
| `manage.html` | 관리사무소용 승인 화면 (로그인·목록·확정/취소·문서 출력) | 신규 |
| `config.js` | `houses`, `reservation` 절 추가 | 수정 |
| `index.html`·`draw.html` | **손대지 않는다** | 그대로 |

### 예약은 기존 화면에 얹지 않고 별개 페이지로 만든다

처음에는 `index.html`에 달력을 넣고 스위치로 가리려 했으나 방향을 바꿨다.

주민들은 지금 타이핑·손글씨 화면을 실제로 쓰고 있다. 예약 시스템이 자리 잡을 때까지
그 흐름이 **한 줄도 바뀌지 않아야** 한다. 별개 페이지로 만들면 기존 화면을 건드릴 일이
없어 위험이 0이 된다.

예약이 자리 잡으면 타이핑·손글씨 페이지는 필요 없어진다. 그때 정리한다.
지금은 세 화면이 나란히 존재한다.

`reservations.js`는 `config.js`·`github.js`와 같은 자리에 놓인다. 네트워크 호출과 순수
계산을 한 파일에 두되, **가용성 계산은 DOM과 네트워크에 의존하지 않는 순수 함수**로 두어
`node --test`로 검증한다. 이 프로젝트가 `calc.js`·`config.js`에 적용한 원칙과 같다.

### 기능 스위치

`config.json`에 `reservation.enabled`를 둔다. **`false`면 `index.html`은 지금과 똑같이
동작한다.** Supabase 설정이 끝나기 전에 배포해도 아무것도 깨지지 않고, 문제가 생기면
관리자 페이지에서 스위치를 내려 기존 흐름으로 즉시 되돌릴 수 있다.

## 데이터 모델

규칙을 코드가 아니라 데이터베이스에 새긴다. 코드는 틀릴 수 있고, 틀린 결과는 사람이
수습해야 한다.

```sql
create extension if not exists btree_gist;

create table reservations (
  id          uuid primary key default gen_random_uuid(),
  house       text not null,
  check_in    date not null,
  check_out   date not null,
  name        text not null,
  unit_dong   text not null,
  unit_ho     text not null,
  phone       text not null,
  people      int  not null,
  amount      int  not null,
  status      text not null default 'pending'
              check (status in ('pending', 'confirmed', 'cancelled')),
  secret      text not null,   -- 주민 본인 확인용. 신청 시 브라우저가 만들어 보관한다
  note        text,            -- 관리사무소 메모
  created_at  timestamptz not null default now(),
  -- 최소 1박. 상한 31일은 악의적인 장기 예약이 달력을 오래 막는 것을 제한한다.
  -- 실제 상한(기본 2박)은 config.stay가 정하고 관리사무소가 확인한다.
  check (check_out > check_in and check_out <= check_in + 31)
);
```

### 중복 예약을 DB가 거부한다

```sql
alter table reservations add constraint no_overlap
  exclude using gist (
    house with =,                            -- 같은 집이고
    daterange(check_in, check_out) with &&   -- 날짜가 겹치면 거부
  ) where (status <> 'cancelled');
```

이 한 줄이 이 설계의 핵심이다. 두 사람이 같은 순간에 같은 날을 신청해도 한 명만 성공한다.

코드로 하면 — "먼저 조회해서 비었으면 넣는다" — 조회와 삽입 사이에 다른 사람이 끼어드는
경쟁 조건이 반드시 생긴다. 예약 시스템에서 가장 흔한 버그이고, 겹친 예약은 자동으로
풀리지 않는다.

`daterange(check_in, check_out)`은 `[check_in, check_out)` 반개구간이다. 입실 7/16,
퇴실 7/18이면 16·17일을 점유하고 **18일은 다음 손님이 입실할 수 있다.** 숙박 예약의
올바른 동작이다.

집이 세 개로 늘어나도 이 제약은 그대로 동작한다.

### 한 세대가 대기 신청을 겹쳐 넣지 못하게

```sql
create unique index one_pending_per_unit
  on reservations (unit_dong, unit_ho)
  where status = 'pending';
```

**"대기 중인 신청은 세대당 하나"**라는 뜻이다. 확정되면 `pending`이 아니므로 다음 신청을
넣을 수 있다. 다만 **한 세대가 두 집을 동시에 신청할 수는 없다.** 대가족이 두 집을 함께
쓰려는 경우는 관리사무소에 연락해야 한다. 드문 경우를 위해 제약을 푸는 것보다, 장난 신청이
달력을 막는 것을 확실히 차단하는 편이 낫다고 본다.

장난 신청 대응은 여기까지만 한다. 같은 단지 주민 대상이고 하루 한 팀 규모다. 나머지는
관리사무소가 취소로 처리한다.

### 금액은 신뢰하지 않는다

`amount`는 클라이언트가 계산해 보낸다. 익명 사용자가 조작할 수 있고, 계산이 필요한 값이라
RLS로 막을 수 없다. 관리사무소가 확정 전에 입금액과 대조하므로 실질 피해는 없지만,
**저장된 금액을 근거로 삼지 않는다.** 승인 화면은 저장값과 함께 `calc.js`로 다시 계산한
금액을 보여주고, 다르면 눈에 띄게 표시한다.

### 개인정보도 DB가 막는다

주민용 공개 뷰를 따로 둔다.

```sql
create view public_calendar as
  select house, check_in, check_out, status
  from reservations
  where status <> 'cancelled';

grant select on public_calendar to anon, authenticated;
revoke all on reservations from anon;
grant insert on reservations to anon;
grant all on reservations to authenticated;
```

**RLS 정책만으로는 부족하다.** PostgreSQL에서 행 수준 보안은 일반 권한에 *더해서*
적용된다. 정책이 "이 행은 넣어도 된다"고 해도 테이블에 `INSERT` 권한이 없으면
`permission denied`가 난다. Supabase 예제에서 정책만 보이는 것은 프로젝트 기본값이
`anon`·`authenticated`에게 권한을 미리 깔아두기 때문이다. 프로젝트 생성 시
"Automatically expose new tables"를 끄면 직접 줘야 한다.

`anon`에게 준 것은 `insert` 하나뿐이고 `select`가 없다. 그래서 신청은 넣을 수 있어도
남의 예약을 읽을 수 없다.

주민 페이지의 익명 키로는 `reservations` 테이블을 **아예 조회할 수 없고** 이 뷰만 읽힌다.
이름·연락처는 나갈 경로가 없다.

코드에서 필드를 골라 빼는 방식이었다면 실수 한 번에 새어나간다. 뷰는 그 실수를 불가능하게
만든다.

> 이 뷰는 `security_invoker`를 켜지 않는다(기본값). 뷰가 소유자 권한으로 실행되어 기반
> 테이블의 RLS를 우회하므로, 익명 사용자가 테이블 권한 없이도 뷰를 읽을 수 있다.

### 권한 (RLS)

```sql
alter table reservations enable row level security;

-- 익명: 대기 상태로만 새 신청을 넣을 수 있다
create policy "anon inserts pending"
  on reservations for insert to anon
  with check (status = 'pending');

-- 관리사무소: 로그인하면 전부
create policy "staff full access"
  on reservations for all to authenticated
  using (true) with check (true);
```

| | 익명(주민) | 로그인(관리사무소) |
|---|---|---|
| `public_calendar` 조회 | O | O |
| `reservations` 조회 | **X** | O |
| 신청 추가 | O (`pending`만) | O |
| 확정·취소 | **X** | O |
| 내 신청 조회·취소 | 함수로만 (아래) | O |

익명에게는 `reservations` 조회 권한이 없으므로, 신청을 넣을 때 삽입된 행을 돌려받으려
하면 실패한다. 클라이언트는 `Prefer: return=minimal` 헤더를 보내야 한다.

### 내 신청 조회·취소는 함수로만

RLS로 "클라이언트가 보낸 비밀값과 일치하는 행"을 표현하기는 번거롭다. 함수 두 개로 푼다.

```sql
create function my_reservation(p_id uuid, p_secret text)
returns table (
  house text, check_in date, check_out date,
  people int, amount int, status text
)
language sql security definer stable as $$
  select house, check_in, check_out, people, amount, status
  from reservations
  where id = p_id and secret = p_secret;
$$;

create function cancel_reservation(p_id uuid, p_secret text)
returns boolean
language plpgsql security definer as $$
declare hit int;
begin
  update reservations set status = 'cancelled'
   where id = p_id and secret = p_secret and status = 'pending';
  get diagnostics hit = row_count;
  return hit > 0;
end $$;

grant execute on function my_reservation, cancel_reservation to anon;
```

**확정된 예약은 주민이 취소할 수 없다.** `status = 'pending'` 조건 때문이다. 확정 뒤
사정이 바뀌면 관리사무소에 연락해야 한다. 입금까지 끝난 건을 주민이 혼자 무를 수 있으면
관리사무소가 파악하지 못한다.

## 설정 변경

```jsonc
"houses": [
  { "id": "a", "label": "1호실" },
  { "id": "b", "label": "2호실" }
],

"reservation": {
  "enabled": false,
  "url": "https://xxxxxxxx.supabase.co",
  "anonKey": "eyJ..."
}
```

두 집의 요금·인원·규정이 같으므로 **요금표(`pricing`)는 하나를 공유**한다. 집마다
조건이 달라지면 그때 `houses[].pricing`으로 덮어쓰는 구조를 더한다. 지금은 필요 없다.

익명 키(`anonKey`)가 공개되는 것은 Supabase의 설계상 정상이다. 이 키로 할 수 있는 일은
위 RLS가 허용한 범위뿐이다. `config.json`에 두면 관리자가 화면에서 교체할 수 있다.

`houses`와 `reservation`도 `normalizeConfig()`의 검증을 거친다. `houses`가 비어 있거나
깨지면 기본값으로 복귀하고, `reservation.url`이나 `anonKey`가 없으면 `enabled`를 강제로
`false`로 내린다 — 설정이 반쯤 채워진 상태로 예약 화면이 뜨는 것을 막는다.

## 주민 화면 (`reserve.html`)

**두 단계다.** 처음 들어오면 달력만 보이고, 날짜를 고르면 신청서 작성으로 넘어간다.

```
[1단계] 달력만
   날짜 범위 선택 → 그 기간에 가능한 집 선택
        ↓
[2단계] 신청서 작성
   성명·동호수·연락처·인원  ← config.fields를 그대로 쓴다
        ↓
[3단계] 신청 완료
   관리사무소 확인 후 확정됩니다
```

입력 항목은 **기존 설정(`config.fields`)을 그대로** 쓴다. 별도로 두면 관리자가 항목을
바꿨을 때 한쪽만 반영되는 사고가 난다. 날짜는 달력에서 이미 골랐으므로 제외한다.

한 달력에 두 집을 같이 보여준다. 날짜 칸마다 작은 막대 두 개다.

```
     일    월    화    수    목    금    토
     14    15    16    17    18    19    20
     ▬▬    ▬▬    ▬░    ░░    ▬▬    ░░    ▬░

     ▬ 빈자리   ░ 예약됨      위 = 1호실,  아래 = 2호실
```

흐름:

```
[입실일 선택] → [퇴실일 선택] → [집 선택] → [성명·동호수·연락처·인원]
                                     │
                                     └─ 그 기간에 비어 있는 집만 고를 수 있다
        ↓
[신청]  ─── Supabase에 pending으로 저장
        ↓
[신청 완료. 관리사무소 확인 후 확정됩니다]
```

**집은 날짜를 고른 뒤에 선택한다.** 순서를 뒤집으면(집 먼저) 그 집이 찬 날짜를 고르려다
막히는 일이 반복된다. 날짜를 먼저 정하면 그 기간에 가능한 집만 남기면 되고, 한 곳만
비었으면 자동으로 선택해 단계를 줄인다.

- 날짜 제한(오늘~한 달, 최소 1박·최대 2박)은 `config.stay`를 그대로 쓴다. 여기에
  **이미 예약된 날은 고를 수 없음**이 더해진다.
- 신청 시 임의의 `secret`을 만들어 신청 id와 함께 `localStorage`에 저장한다. 다시
  방문하면 "내 신청" 상태(대기/확정)를 보여주고, 대기 중이면 취소할 수 있다.
- 중복 예약 제약에 걸려 실패하면(다른 사람이 방금 그 날을 잡은 경우) 달력을 새로 읽고
  "방금 다른 분이 예약했습니다. 날짜를 다시 골라 주세요"를 안내한다.

### 신청서 문서는 관리사무소가 뽑는다

주민은 JPG를 만들지 않는다. 달력에서 신청하면 끝이다.

대신 **관리사무소 화면에서 신청 내용으로 신청서 이미지를 출력**할 수 있게 한다. 종이
서식이 필요한 경우를 위해서다. 기존 `index.html`의 캔버스 렌더링 로직(`POS`·`drawForm`)을
그대로 옮겨 쓴다 — 좌표는 이미 `config.fields[].rect`에서 나온다.

기존 타이핑·손글씨 화면은 그대로 살아 있으므로, 예약 시스템에 문제가 생겨도 주민은
지금까지 하던 대로 문자를 보내면 된다.

## 관리사무소 화면 (`manage.html`)

종이 장부를 쓰던 분들이 대상이다. 화면을 최대한 줄인다.

```
┌─ 게스트하우스 예약 관리 ──────────────┐
│  [이메일] [비밀번호] [로그인]          │
├───────────────────────────────────────┤
│  확인 필요 (2건)                       │
│                                        │
│  1호실  7/16~7/18  2박  3명  70,000원  │
│  홍길동  101동 1201호  010-1234-5678   │
│                    [확정]  [취소]      │
│  ─────────────────────────────────    │
│  2호실  7/20~7/21  1박  2명  40,000원  │
│  ...                  [확정]  [취소]   │
├───────────────────────────────────────┤
│  확정된 예약                           │
│  ...                                   │
└───────────────────────────────────────┘
```

- 버튼은 **확정·취소 둘뿐**이다. 토큰·좌표·설정 같은 개념은 나오지 않는다.
- 로그인은 이메일·비밀번호 한 번. Supabase가 세션을 유지하므로 매번 하지 않아도 된다.
- `admin.html`(설정 관리)과는 **별개 화면**이다. 관리사무소 직원이 서식 좌표나 GitHub
  토큰을 볼 일이 없어야 한다.

## 개인정보

README와 신청 폼의 문구를 고친다.

| 지금 | 바뀐 뒤 |
|---|---|
| "서버로 전송되지 않고 본인 브라우저에만 저장됩니다" | "예약 신청 정보는 관리사무소 확인을 위해 저장되며, 관리사무소만 열람합니다. 달력에는 예약 여부만 표시되고 다른 주민의 이름·연락처는 보이지 않습니다." |

이 약속은 문구가 아니라 `public_calendar` 뷰가 지킨다.

## 테스트

`reservations.js`의 순수 함수만 `node --test`로 검증한다. 네트워크 호출은 테스트하지 않는다.

- **가용성 계산** — 예약 목록과 집 목록을 주면 날짜별·집별 빈자리 맵을 만든다.
  반개구간 처리가 핵심이다: 7/16~7/18 예약이 있을 때 18일은 **비어 있어야** 한다.
- **선택 가능 범위** — `config.stay`(오늘~한 달, 1~2박)와 기존 예약을 함께 반영한 뒤,
  고를 수 있는 퇴실일 목록이 맞는지.
- **선택 가능한 집** — 고른 기간에 비어 있는 집만 남는지. 두 집이 다 차면 빈 목록.
- **요청 조립** — URL·헤더(`apikey`, `Authorization`, `Prefer: return=minimal`)가
  올바른지. `fetch`는 호출하지 않고 조립 결과만 확인한다.
- **secret 생성** — 매번 다르고 충분히 길다.
- **금액 재계산** — 저장된 `amount`와 `calc.js`로 다시 계산한 값이 다른 경우를 가려낸다.

DB 제약(중복 방지·개인정보 차단)은 SQL이 보장하므로 클라이언트 테스트로 검증하지 않는다.
대신 Supabase 세팅 절차에 **확인 쿼리**를 넣어 사람이 한 번 확인하게 한다.

## 단계 분할

**1단계 — 예약이 동작하는 최소 시스템**

Supabase 세팅, `reservations.js`, `index.html`의 달력·신청, `manage.html`의 로그인·
목록·확정/취소, 개인정보 고지, 설정에 `houses`·`reservation` 추가.

이것만으로 온전히 돌아간다. 승인 화면을 1단계에 넣는 이유는, 없으면 신청만 쌓이고
확정할 방법이 없어서다.

**2단계 — 관리 편의**

달력 형태의 관리 뷰, 신청서 JPG 출력(기존 캔버스 로직 재사용), 메모, 지난 예약 검색.

## 사람이 해야 하는 준비

Supabase 프로젝트 생성과 계정 발급은 코드로 할 수 없다. 구현 계획에 다음을 그대로
복사해 실행할 수 있는 형태로 넣는다.

1. Supabase 프로젝트 생성 (무료 티어)
2. 위 SQL을 SQL Editor에 붙여넣고 실행
3. Authentication에서 관리사무소 계정 생성 (이메일·비밀번호)
4. Settings → API에서 Project URL과 anon key 복사
5. `admin.html`의 설정 화면에서 URL·키를 넣고 `enabled`를 켠다
