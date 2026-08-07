# 관리자 설정을 GitHub 토큰 대신 로그인으로 바꾸기

날짜: 2026-08-06

## 배경

`admin.html`은 설정을 바꾸면 GitHub Contents API로 `config.json`을 저장소에 커밋한다.
그래서 쓰려면 **파인그레인드 토큰을 직접 발급해 붙여넣어야** 한다.

실제로 이 화면을 쓸 사람은 관리사무소 직원이다. 개발자가 아니다.

- 토큰이 무엇인지, 파인그레인드가 무엇인지, `Contents: Read and write`가 무엇인지
  설명해야 한다
- 만료되면 다시 발급해야 하는데 그 시점을 화면이 알려줄 수 없다(뒤의 "확인한 사실" 참고)
- 대안으로 소유자 토큰을 나눠 쓰면 더 나쁘다 — 누가 무엇을 바꿨는지 사라지고
  한 사람이 유출하면 전부 폐기해야 한다

`manage.html`은 이미 이메일·비밀번호 로그인으로 동작한다. 같은 사람들이 두 화면을
쓰는데 인증 방식이 둘인 것도 어색하다.

**목표: 직원이 토큰을 평생 볼 일이 없게 한다.**

## 확인한 사실

설계 판단의 근거가 된 것들이다. 추측이 아니라 확인한 값이다.

| 확인한 것 | 결과 |
|---|---|
| 저장소 소유자 유형 | Organization(`useApart`) — 파인그레인드 토큰 최대 366일, 무기한 불가 |
| GitHub 만료일 헤더를 브라우저가 읽을 수 있나 | **못 읽는다.** `Access-Control-Expose-Headers`에 없다 |
| `manage.html` 세션 저장 위치 | `localStorage['guesthouse-staff-token']` — 같은 도메인이라 `admin.html`이 그대로 읽는다 |
| GitHub Pages 캐시 | `Cache-Control: max-age=600`, 모든 파일에 배포 시각이 `Last-Modified`로 붙는다 |

만료일을 화면에 미리 알려줄 수 없다는 점이 특히 결정적이다. 토큰 방식을 유지하면
직원은 **저장이 실패하고 나서야** 만료를 알게 된다.

## 결정: 설정은 Supabase에 두고, GitHub은 정적 사본을 받는다

```
관리소 직원 → 로그인 → admin.html → Supabase  (설정 원본)
                                        │
                    GitHub Action이 5분마다 읽어
                                        ↓
                        저장소에 config.json 커밋 (내용이 다를 때만)
                                        ↓
주민 화면 → config.json  ← 지금과 똑같음. 코드 변경 없음
```

**설정을 읽는 방식은 어느 화면도 바뀌지 않는다.** `index`·`draw`·`reserve`·`manage`
모두 계속 정적 `config.json`을 읽는다. 그래서 Supabase가 죽어도 주민 화면은 완전히
정상이다 — 폴백 경로가 아니라 **원래 경로**다.

바뀌는 것은 `admin.html`, 새 워크플로, 그리고 `manage.html`에 `admin.html`로 가는
링크 한 줄이다.

### 왜 주민 화면이 Supabase를 직접 읽지 않는가

처음에는 "Supabase 먼저 시도하고 실패하면 `config.json`으로 폴백"을 생각했다. 버렸다.

- 모든 페이지 로딩이 Supabase 왕복을 기다린다. 콜드 스타트면 첫 화면이 늦는다
- 폴백 경로는 평소에 안 쓰이므로 **고장 나 있어도 아무도 모른다.** 정작 필요한
  날에 동작하지 않는다
- 설정은 거의 안 바뀐다. 실시간으로 읽을 이유가 없다

정적 파일을 원래 경로로 두면 폴백이라는 개념 자체가 사라진다. 늘 쓰는 길이라
고장 나면 즉시 드러난다.

### 왜 OCI 같은 다른 클라우드에 이중 보관하지 않는가

두 번째 사본은 **사이트와 같은 실패 영역에 두는 것이 맞다.** 이 사이트는 GitHub
Pages가 서빙한다. GitHub이 죽으면 페이지 자체가 안 열리므로, 다른 클라우드에
설정이 살아 있어도 읽을 사람이 없다.

관리할 시스템만 하나 늘고 실제로 막아주는 장애는 없다.

### 왜 Edge Function으로 토큰을 숨기지 않는가

로그인 → Edge Function → 함수가 GitHub에 커밋하는 방법도 있다. 그러면 `config.json`이
계속 GitHub에 원본으로 남는다.

버린 이유는 **토큰이 없어지지 않기 때문**이다. 함수 안의 토큰도 366일마다 만료되어
누군가는 갱신해야 한다. 직원에게서는 숨겨지지만 소유자에게는 그대로 남는다.
게다가 Deno·Supabase CLI 배포 파이프라인이 새로 생긴다.

GitHub Action은 **자체 `GITHUB_TOKEN`으로 자기 저장소에 커밋**할 수 있다. 발급도
갱신도 없다. 아무도 토큰을 만지지 않는다.

## DB 변경

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
-- 계좌번호도 신청서 화면에 그대로 표시되는 값이다.
create policy "설정은 누구나 읽는다"
  on app_config for select to anon, authenticated using (true);

-- 쓰기는 로그인한 직원만. manage.html이 쓰는 계정과 같다.
create policy "로그인한 직원만 고친다"
  on app_config for update to authenticated using (true) with check (true);

-- 정책과 GRANT는 다른 층이다. RLS는 '어떤 행을 볼 수 있나'를, GRANT는 '테이블을
-- 건드릴 수 있나'를 정한다. 이 프로젝트는 "Automatically expose new tables"를
-- 꺼 두어 새 테이블에 권한이 자동으로 붙지 않으므로 직접 준다.
grant select on public.app_config to anon, authenticated;
grant update on public.app_config to authenticated;
```

**insert·delete는 정책도 GRANT도 주지 않는다.** 행은 하나뿐이고 아래 시딩으로
만든다. 권한이 없으면 아무도 못 지운다 — 설정 행이 사라지면 동기화가 빈 설정을
커밋해 사이트가 기본값으로 떨어지므로, 실수로라도 지워지면 안 된다.

`updated_at`은 트리거로 갱신한다.

```sql
create or replace function touch_app_config()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists app_config_touch on app_config;
create trigger app_config_touch before update on app_config
  for each row execute function touch_app_config();
```

`updated_by`를 브라우저가 보내지 않고 트리거가 `auth.uid()`로 채우는 이유는, 보낸
값을 그대로 믿으면 아무 값이나 적을 수 있기 때문이다. 누가 바꿨는지는 감사용이라
믿을 수 있어야 의미가 있다.

### 시딩

현재 `config.json` 내용을 그대로 넣는다. 구현 계획에 실제 값이 들어간다.

## 브라우저 변경

### 새 파일 `configstore.js`

`reservations.js`의 `buildRequest`를 재사용해 요청을 조립한다. `usage.js`와 같은
구조다 — 조립은 순수 함수로 테스트하고 `fetch` 한 줄만 밖에 남긴다.

```js
export function buildLoadConfigRequest(reservation, accessToken)  // GET  app_config
export function buildSaveConfigRequest(reservation, accessToken, config)  // PATCH app_config
export function loadStoredConfig(reservation, accessToken)
export function saveStoredConfig(reservation, accessToken, config)
```

`config.js`(기본값·검증·정규화)와 이름이 비슷하지만 역할이 다르다. `config.js`는
설정의 **의미**를 알고, `configstore.js`는 설정을 **어디에 넣고 빼는지**만 안다.

### `admin.html`

| 지금 | 바뀐 뒤 |
|---|---|
| GitHub 토큰 붙여넣기 | 이메일·비밀번호 로그인 (`manage.html`과 같은 화면) |
| 저장 = `config.json` 커밋 | 저장 = `app_config` 갱신 |
| 이력 = 커밋 목록(토큰 필요) | 이력 = 커밋 목록(**토큰 불필요** — 아래 참고) |
| 서식 이미지 교체 = 토큰 | 그대로. "고급" 영역으로 접고 "관리자 전용" 표시 |

로그인은 `reservations.js`의 `signIn`을 그대로 쓴다. 세션은 `manage.html`과 같은
`localStorage['guesthouse-staff-token']`에 저장되므로 **한쪽에서 로그인하면 다른
쪽도 로그인된 상태**다. 별도의 통합 로그인 화면을 만들지 않고 두 화면에 서로
가는 링크만 둔다 — 페이지를 하나 더 만들어도 하는 일이 같다.

### 되돌리기가 어디에 쓰는지

이력은 여전히 `config.json`의 git 커밋 목록에서 읽는다. 동기화 워크플로가 변경마다
커밋을 남기므로 이력은 계속 쌓인다. 공개 저장소라 **익명으로 조회된다** — 토큰이
필요 없어진다.

다만 **되돌리기는 저장소가 아니라 Supabase에 쓴다.** 옛 커밋에서 설정을 읽어와
`app_config`를 그 내용으로 갱신하고, 다음 동기화가 `config.json`을 따라오게 한다.
저장소에 직접 되돌리면 다음 동기화가 도로 덮어쓴다 — Supabase가 원본이기 때문이다.

익명 GitHub API는 IP당 시간당 60회 제한이 있다. 이력을 여는 것은 드문 일이라
문제되지 않지만, 이력 화면에서 커밋을 하나씩 조회하며 목록을 채우는 방식이라면
호출 수를 아껴야 한다.

### 세션 만료

**세션이 만료돼도 편집 내용을 잃지 않아야 한다.** Supabase 액세스 토큰은 한 시간쯤
지나면 만료된다(`manage.html`도 마찬가지다). 저장이 401로 실패하면 편집 중이던
설정을 그대로 둔 채 로그인 폼만 띄우고, 로그인 성공 후 저장을 다시 시도한다.
편집을 날려버리면 직원은 무엇을 고치고 있었는지 기억해서 다시 입력해야 한다.

## 동기화 워크플로

`.github/workflows/config-sync.yml` + `scripts/sync-config.mjs`

1. `config.json`에서 Supabase 주소·`anonKey`를 읽는다(`scripts/notify-usage.mjs`와 같다)
2. `app_config`를 읽는다. 익명 키로 읽을 수 있다(위 select 정책)
3. 저장소의 `config.json`과 **내용이 같으면 아무것도 하지 않는다**
4. 다르면 `config.json`을 쓰고 커밋·푸시한다

```yaml
on:
  schedule:
    - cron: '*/5 * * * *'
  workflow_dispatch:

permissions:
  contents: write
```

`GITHUB_TOKEN`은 Actions가 자동으로 준다. 발급도 갱신도 없다.

**빈 커밋을 만들지 않는 것이 중요하다.** 5분마다 커밋하면 이력이 쓰레기로 차고
Pages 빌드가 계속 돌아 "되돌리기"가 쓸모없어진다. 내용 비교는 정규화된 JSON
문자열끼리 한다.

**Supabase가 원본이다.** 저장소의 `config.json`을 직접 고치면 다음 동기화가
덮어쓴다. README에 적는다.

### 반영이 늦어지는 것을 받아들인다

지금은 저장 → 커밋 → Pages 빌드로 약 1분이다. 바뀐 뒤에는 저장 → 최대 5분 대기
→ 동기화 → 빌드로 **최대 10분쯤** 걸린다. Actions cron은 정시를 보장하지 않는다.

즉시 반영하려면 Supabase가 GitHub을 호출해야 하고, 그러려면 다시 토큰이 필요하다.
"아무도 토큰을 안 본다"와 맞바꾼 결과다.

요금·계좌 변경이 분 단위로 급한 경우는 없고, `admin.html`의 미리보기로 결과는
즉시 확인된다. **저장 후 화면에 "약 10분 안에 모두에게 반영됩니다"라고 알린다** —
1분이라고 적혀 있는데 10분 걸리면 고장으로 오해한다.

## 스스로를 잠글 수 있는 경로

`reservation.url`·`anonKey`도 설정 안에 있다. **여기에 잘못된 값을 저장하면
`admin.html`이 Supabase에 못 붙어 다시 고칠 수 없게 된다.**

지금도 비슷한 위험이 있지만(잘못 저장하면 예약 기능이 죽는다) 그때는 GitHub
토큰으로 언제든 되돌릴 수 있었다. 이제는 그 경로가 없다.

복구 방법을 README에 적는다.

1. Supabase SQL Editor에서 `app_config`를 직접 고친다 — 이것이 정석이다
2. 그것도 막혔으면 저장소의 `config.json`을 직접 고친다. 주민 화면은 즉시
   복구되지만 다음 동기화가 다시 덮어쓰므로 1번을 반드시 해야 한다

`admin.html`은 "예약 기능" 설정을 저장하기 전에 **입력한 주소·키로 실제 호출을
한 번 해 보고 실패하면 저장을 막는다.** 잠기는 것을 사전에 차단하는 편이 복구
문서보다 낫다.

## 테스트

기존 원칙대로 순수 함수만 자동 테스트한다.

`configstore.test.mjs`:

- `buildLoadConfigRequest`·`buildSaveConfigRequest`의 URL·메서드·본문·헤더 고정
- 액세스 토큰이 `Authorization`에 실리고 익명 키가 `apikey`에 남는지
- 로그인하지 않았으면(토큰 없음) 저장 요청을 만들지 않는지

`syncconfig.test.mjs`:

- 내용이 같으면 "쓰지 않음"을 반환한다 — 키 순서만 다른 경우도 같다고 본다
- 내용이 다르면 쓸 문자열을 반환한다. 끝에 개행이 붙는다(지금 `admin.html`이
  저장하는 형식과 같아야 한다. 다르면 첫 동기화가 무의미한 커밋을 만든다)
- `app_config`가 비었거나 깨졌으면 **쓰지 않고 실패한다.** 빈 설정을 커밋하면
  사이트가 통째로 기본값으로 떨어진다

브라우저·실제 환경으로 확인할 것:

1. 로그아웃 상태에서 `admin.html`을 열면 편집·미리보기는 되고 저장만 잠긴다
2. 로그인하면 저장된다. `manage.html`에서 로그인한 뒤 `admin.html`을 열면
   이미 로그인 상태다
3. 저장 후 5~10분 안에 `config.json`이 갱신되고 주민 화면에 반영된다
4. 아무것도 바꾸지 않고 워크플로를 수동 실행하면 **커밋이 생기지 않는다**
5. 세션이 만료된 뒤 저장을 누르면 편집 내용이 살아 있는 채로 로그인 폼이 뜨고,
   로그인하면 그대로 저장된다
6. 잘못된 Supabase 주소를 넣고 저장하면 거부된다
7. 서식 이미지 교체는 "고급"을 펼쳐 토큰을 넣어야 되고, 직원은 볼 일이 없다

## README 반영

- 관리자 절에서 토큰 발급 절차를 지우고 로그인 절차로 바꾼다
- 서식 이미지 교체만 토큰이 필요하다는 것을 "관리자 전용"으로 남긴다
- **Supabase가 설정의 원본**이고 `config.json`은 자동 생성된 사본이라는 것
- 반영에 최대 10분이 걸린다는 것
- 잠겼을 때의 복구 절차
- 직원 계정 추가 방법(Supabase Authentication → Users). `manage.html` 절에
  이미 있으므로 가리키기만 한다

## 이번에 하지 않는 것

- **서식 이미지의 Supabase Storage 이전.** 거의 바뀌지 않는 파일이고, 옮기면
  버킷·권한·동기화·폴백이 전부 늘어난다. 필요해지면 그때 별도로 한다
- **직원별 권한 구분.** 예약을 보는 사람과 요금을 고치는 사람을 나누지 않는다.
  지금 인원 규모에서는 과하다. 필요해지면 `app_config` 정책에 역할 조건을
  더하면 되고, 지금 구조를 바꾸지 않는다
- **즉시 반영.** 위에 적은 이유로 최대 10분을 받아들인다
