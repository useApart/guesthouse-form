# 다른 기기에서 신청 조회 설계

날짜: 2026-07-30

## 배경

주민의 신청은 `secret`으로 식별하고 그 값은 브라우저 `localStorage`에 있다.
localStorage는 기기·브라우저마다 따로라 **폰으로 신청하고 PC로 접속하면
'내 신청'이 아예 뜨지 않는다.** 조회도 취소도 못 한다.

같은 이유로 이런 경우에도 접근을 잃는다.

- 브라우저 데이터(사이트 데이터) 삭제
- 시크릿 모드로 신청
- 같은 폰에서 사파리로 신청하고 크롬으로 접속

관리사무소는 전부 볼 수 있으므로 전화하면 취소는 된다. 잃는 것은 주민 본인의
조회·취소 경로다.

## 결정: 이름 + 동·호수 + 비밀번호로 조회

항공사·호텔이 쓰는 방식이다. 다만 그쪽은 **예약번호 + 비밀번호**를 쓰는데,
예약번호를 이메일·문자로 자동 전달하기 때문이다. 우리에게는 그 전달 수단이
없다 — 완료 화면에서 한 번 보여주는 것이 전부라 놓치면 끝이고 결국 전화로
돌아온다.

**이름·동·호수는 주민이 잊지 않는 자기 정보다.** 외울 것이 비밀번호 하나뿐이라
우리 상황에는 이쪽이 맞다.

검토했다가 버린 대안:

| 방법 | 버린 이유 |
|---|---|
| 링크 전달(`?s=<secret>`) | 미리 저장해 둔 사람만 구제된다. 폰을 잃은 뒤에는 못 쓴다 |
| 동·호수 + 연락처 | 둘 다 이웃이 아는 값이다. secret으로 막아둔 것을 도로 여는 셈 |
| 문자 인증(OTP) | 가장 확실하지만 발송 비용과 발신번호 등록이 든다. 지금 규모에는 과하다 |

**지금 방식은 그대로 둔다.** 같은 기기에서는 아무것도 입력할 필요가 없다.
조회는 기기가 바뀐 사람만 쓰는 보조 경로다.

### 조회한 기기가 소유자가 되지는 않는다

조회에 성공해도 그 기기에 `secret`을 저장하지 않는다. 조회 화면에서 결과를
보여주고 거기서 바로 취소할 수 있게 한다. 이유는 둘이다.

- 공용 PC에서 조회했을 때 그 PC가 조용히 소유자가 되면 안 된다
- 폰과 PC의 `secret`이 다를 때 어느 쪽을 남길지 정할 수 없다. 합치려 들면
  읽기 요청이 데이터를 바꾸게 되어 놀랍다

## DB 변경

```sql
create extension if not exists pgcrypto;

alter table reservations add column if not exists lookup_pin  text;  -- 임시. 트리거가 지운다
alter table reservations add column if not exists lookup_hash text;
```

### 평문 비밀번호는 저장하지 않는다

주민 브라우저는 bcrypt를 계산할 수 없으므로 평문을 보낸다(TLS 안). 저장되기
전에 트리거가 해시로 바꾸고 평문 칸을 비운다.

```sql
create or replace function hash_lookup_pin()
returns trigger
language plpgsql
security definer
set search_path = public, extensions   -- Supabase에서 pgcrypto는 extensions 스키마에 있다
as $$
begin
  if new.lookup_pin is not null and new.lookup_pin <> '' then
    -- cost 10. 한 번 검사에 100ms쯤 걸려 그 자체가 시도 속도를 늦춘다.
    new.lookup_hash := crypt(new.lookup_pin, gen_salt('bf', 10));
  end if;
  new.lookup_pin := null;   -- 평문은 어떤 경우에도 남기지 않는다
  return new;
end $$;

drop trigger if exists hash_pin on reservations;
create trigger hash_pin before insert or update on reservations
  for each row execute function hash_lookup_pin();
```

이름·연락처가 이미 같은 테이블에 있어서 비밀번호까지 평문이면 유출 시 피해가
커진다. 주민이 다른 곳과 같은 번호를 쓸 수도 있다.

### 조회 함수

```sql
create or replace function find_my_reservations(
  p_name text, p_dong text, p_ho text, p_pin text
) returns table (
  id uuid, house text, check_in date, check_out date,
  people int, amount int, status text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
    select r.id, r.house, r.check_in, r.check_out, r.people, r.amount, r.status
      from reservations r
     where r.name = btrim(p_name)
       and r.unit_dong = btrim(p_dong)
       and r.unit_ho = btrim(p_ho)
       and r.lookup_hash is not null
       and r.lookup_hash = crypt(p_pin, r.lookup_hash)
       and r.status <> 'cancelled'
     order by r.check_in;

  if not found then
    perform pg_sleep(1);   -- 무차별 대입 지연
  end if;
end $$;
```

`secret`과 `phone`은 돌려주지 않는다. 조회 화면에 필요 없다.

### 취소 함수

```sql
create or replace function cancel_by_lookup(
  p_id uuid, p_name text, p_dong text, p_ho text, p_pin text
) returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare ok boolean;
begin
  update reservations r
     set status = 'cancelled'
   where r.id = p_id
     and r.name = btrim(p_name)
     and r.unit_dong = btrim(p_dong)
     and r.unit_ho = btrim(p_ho)
     and r.lookup_hash is not null
     and r.lookup_hash = crypt(p_pin, r.lookup_hash)
     and r.status = 'pending';        -- 확정된 예약은 관리사무소를 거친다
  get diagnostics ok = row_count;

  if not ok then perform pg_sleep(1); end if;
  return ok;
end $$;
```

### 권한

```sql
grant execute on function find_my_reservations(text, text, text, text) to anon;
grant execute on function cancel_by_lookup(uuid, text, text, text, text) to anon;
```

`reservations` 테이블 권한은 그대로다. `anon`은 여전히 INSERT만 할 수 있고,
조회는 이 함수들을 통해서만 된다.

## 무차별 대입에 대한 정직한 평가

이름·동·호수는 이웃이 다 아는 값이다. 실제로 지키는 것은 6자리 비밀번호
하나뿐이고, 경우의 수는 100만이다.

- bcrypt cost 10이 한 번에 약 100ms를 쓴다
- 실패하면 `pg_sleep(1)`이 1초를 더 쓴다

순차로는 11일이 걸리지만 **병렬로 던지면 몇 시간이면 뚫린다.** 이 지연이
막아주는 것은 "지나가다 해보는 시도"까지다. 작정한 공격자는 막지 못한다.

그럼에도 이 수준으로 가는 근거:

- 위협은 이웃의 장난 정도이고, 얻는 것이 거의 없다(날짜·금액 조회, 대기 건 취소)
- 취소해도 행은 남고 `status`만 바뀐다. 관리사무소가 이력을 보고 되돌릴 수 있다
- 확정된 예약은 이 경로로 취소되지 않는다
- 병렬 공격은 커넥션 풀을 묶어 관리사무소 화면이 느려지므로 금방 드러난다

**나중에 올릴 경로:** 세대별 실패 횟수를 기록해 10회 초과 시 30분 잠근다.
테이블 하나와 함수 안 로직이면 되고, 지금 구조를 바꾸지 않는다. 실제로 남용이
보이면 그때 넣는다.

## 화면 변경

### `reserve.html` 신청서

`fieldList`(설정에서 만들어지는 항목들) 다음에 **고정 칸**으로 넣는다.
`config.js`의 필드로 만들지 않는다 — 그러면 종이 서식인 `index.html`에도
나타난다.

```
확인용 비밀번호 (숫자 6자리)
[      ]
다른 기기에서 신청 내역을 확인하실 때 씁니다. 잊지 마세요.
```

6자리가 아니면 신청을 막는다.

### `reserve.html` 조회

'내 신청' 카드 아래에 접힌 형태로 둔다.

```
다른 기기에서 신청하셨나요?  [조회하기]
  이름 [        ]
  동 [    ] - 호 [    ]
  확인용 비밀번호 [      ]
  [조회]
```

결과는 '내 신청'과 같은 모양으로 보여주고, 대기 중인 건에는 취소 버튼을 붙인다.
실패하면 "일치하는 신청이 없습니다. 입력하신 내용을 다시 확인해 주세요."
— 어느 항목이 틀렸는지는 알려주지 않는다.

## 테스트

순수 함수만 자동 테스트한다(기존 원칙).

- `buildRequest`로 두 RPC 요청의 URL·본문을 고정
- 비밀번호 형식 검사(`isValidPin`)를 순수 함수로 빼서 테스트: 6자리 숫자만 통과,
  공백·문자·자릿수 부족은 거부
- 버튼 연결은 `wiring.test.mjs`가 막는다

브라우저로 확인할 것:

1. 비밀번호를 넣고 신청 → 다른 브라우저에서 조회하면 나온다
2. 비밀번호를 틀리면 결과가 없고 약 1초 뒤에 응답한다
3. 조회 결과에서 대기 건이 취소된다
4. 확정된 건은 취소 버튼이 없다
5. 조회한 기기를 새로고침하면 '내 신청'은 여전히 비어 있다(소유자가 되지 않는다)
6. DB에서 `lookup_pin`이 항상 `null`이고 `lookup_hash`가 `$2a$`로 시작한다
