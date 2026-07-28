# 게스트하우스 신청서 관리자 페이지 설계

작성일: 2026-07-28

## 배경

`index.html`과 `draw.html`은 지금 다음 값들을 **코드에 하드코딩**하고 있다.

- 서식 이미지 파일명 (`form.jpg`)과 칸 좌표 9개 (`index.html`의 `POS`, `draw.html`의 `BOXES`)
- 요금표 (`calc.js`의 `RATE`), 인원 버튼 2/3/4명, 5박 이상 경고 문구
- 계좌번호 (`ACCOUNT_NUMBER`), 예금주, 상단 기관명·제목
- 입력 항목 목록과 필수 여부 (`REQUIRED`), 저장 대상 (`SAVED_FIELDS`), 날짜 지우기 허용 (`CLEARABLE`)

그런데 실제로는 이 값들이 바뀐다. 신청서 서식이 개정되면 JPG가 통째로 교체되고 칸 위치가 전부
달라진다. 요금은 인상될 수 있다. 계좌가 변경될 수 있다. 은행입금일 같은 칸이 새로 생기거나
없어질 수 있다. 지금은 그때마다 개발자가 코드를 고치고 커밋해야 한다.

관리자가 브라우저에서 직접 바꿀 수 있게 한다.

## 목표

- 서식 이미지 교체와 칸 위치 조정을 **이미지 위 클릭·드래그**로 처리
- 입력 항목 추가·삭제·순서 변경·라벨 변경
- 요금표·계좌·안내 문구 편집
- 저장하면 **모든 주민에게 반영** (수동 배포 단계 없음)
- 저장 전 실제 화면·실제 생성 JPG를 미리 확인
- 잘못 저장했을 때 이전 설정으로 되돌리기

## 비목표 (YAGNI)

- **계산식 편집기.** 관리자가 "이 칸 = 다른 칸 × 단가" 같은 식을 정의하는 기능. 사실상 노코드
  빌더를 만드는 일이고, 요금 체계가 근본적으로 바뀌는 일은 서식 개정보다 훨씬 드물다.
- **관리자 계정·역할·감사 로그.** GitHub 커밋 이력이 "누가 언제 무엇을"을 이미 남긴다.
- **`index.html`과 `draw.html`의 UI 코드 공유.** 타이핑 입력과 손글씨 캔버스는 입력 방식이
  근본적으로 달라 억지로 합치면 양쪽 다 복잡해진다. 설정 로딩과 좌표 계산까지만 공유한다.
- 서식 여러 벌 동시 운영, 다국어, 신청 이력 조회.

## 아키텍처

하드코딩된 값을 `config.json` 한 곳으로 모으고, 세 페이지가 그것을 읽는다.

```
                    ┌─────────────┐
   관리자 ─────────▶│ admin.html  │──GitHub API──▶ config.json
                    └─────────────┘                form-<시각>.jpg
                                                        │
                    ┌───────────────────────────────────┤ (GitHub Pages 배포, ~1분)
                    ▼                                   ▼
              index.html                           draw.html
            (타이핑 작성)                          (손글씨 작성)
```

### 파일 구성

| 파일 | 책임 | 상태 |
|---|---|---|
| `config.json` | 실제 설정값. 관리자가 쓰는 유일한 데이터 | 신규 |
| `config.js` | 내장 기본값 · 검증 · 정규화 · 좌표 변환. **순수 함수, DOM 의존 없음** | 신규 |
| `github.js` | GitHub Contents/Commits API 래퍼 | 신규 |
| `admin.html` | 관리자 화면 (CSS/JS 인라인) | 신규 |
| `config.test.mjs` | 설정 검증·정규화·좌표 변환 테스트 | 신규 |
| `calc.js` | 요금표를 인자로 받도록 수정 | 수정 |
| `calc.test.mjs` | 인자 변경 반영 | 수정 |
| `index.html` | config 기반 폼 생성·렌더링으로 전환 | 수정 |
| `draw.html` | config 기반 필드 박스 생성으로 전환 | 수정 |

`config.js`를 별도 모듈로 분리하는 이유는 이 프로젝트가 `calc.js`에 적용한 원칙과 같다.
설정 검증과 좌표 변환은 **틀릴 수 있는 로직**이므로 `node --test`로 검증 가능해야 한다.
DOM에 얽히면 검증이 불가능해진다.

### 설정 로딩과 폴백

```
fetch('config.json', { cache: 'no-cache' })
        │
   성공 ├──▶ normalizeConfig(json)  ──▶ 사용
        │         │
        │    검증 실패 항목은 기본값으로 대체
        │
   실패 └──▶ DEFAULT_CONFIG (config.js 내장) ──▶ 사용
```

`config.json`이 없거나, 네트워크가 실패하거나, JSON이 깨졌거나, 필수 키가 빠졌으면
`config.js`에 내장된 기본값으로 자동 복귀한다. 이 기본값은 **현재 하드코딩된 값과 동일**하다.
따라서 관리자가 설정을 어떻게 망가뜨려도 신청서는 최소한 지금 상태로는 동작한다.

`cache: 'no-cache'`는 ETag 재검증을 쓴다. 파일이 안 바뀌었으면 304로 끝나 비용이 거의 없고,
바뀌었으면 즉시 새 값을 받는다. GitHub Pages의 기본 10분 캐시를 기다리지 않아도 된다.

## 데이터 모델

### 핵심 결정: 항목 하나가 화면과 서식을 동시에 기술한다

지금은 같은 항목이 세 군데에 흩어져 있다 — `index.html`의 HTML 입력칸, `index.html`의
`POS` 중심점, `draw.html`의 `BOXES` 사각형. 이것을 `fields` 배열 하나로 합친다.

```jsonc
{
  "version": 1,

  "site": {
    "org": "원흥LH13단지주거복지지원센터",
    "title": "게스트하우스 신청서"
  },

  "form": {
    "image": "form.jpg",
    "width": 707,
    "height": 1000
  },

  "fields": [
    { "id": "applyDate", "label": "신청일", "input": "date", "width": "half",
      "rect": { "x": 231, "y": 198, "w": 403, "h": 26 },
      "required": true, "visible": true, "defaultToday": true, "clearable": false },

    { "id": "deposit", "label": "은행입금일", "input": "date", "width": "half",
      "rect": { "x": 232, "y": 454, "w": 138, "h": 34 },
      "required": false, "visible": true, "defaultToday": true, "clearable": true },

    { "id": "name", "label": "성명", "input": "text", "width": "full",
      "rect": { "x": 231, "y": 228, "w": 403, "h": 25 },
      "required": true, "visible": true, "remember": true,
      "placeholder": "이름을 입력하세요", "maxlength": 20 },

    { "id": "unit", "label": "동·호수", "input": "text", "width": "half",
      "rect": { "x": 231, "y": 257, "w": 403, "h": 26 },
      "required": true, "visible": true, "remember": true,
      "placeholder": "예: 101동 1201호", "maxlength": 20 },

    { "id": "phone", "label": "연락처", "input": "phone", "width": "half",
      "rect": { "x": 231, "y": 287, "w": 403, "h": 25 },
      "required": true, "visible": true, "remember": true,
      "placeholder": "010-0000-0000", "maxlength": 20 },

    { "id": "checkIn",  "label": "입실일", "input": "date", "width": "half",
      "rect": null, "required": true, "visible": true, "system": true, "clearable": true },

    { "id": "checkOut", "label": "퇴실일", "input": "date", "width": "half",
      "rect": null, "required": true, "visible": true, "system": true, "clearable": true },

    { "id": "period", "label": "사용기간", "input": null, "width": "full",
      "rect": { "x": 232, "y": 323, "w": 138, "h": 28 }, "visible": true, "system": true },

    { "id": "nights", "label": "숙박일수", "input": null, "width": "half",
      "rect": { "x": 487, "y": 323, "w": 147, "h": 28 }, "visible": true, "system": true },

    { "id": "people", "label": "사용인원", "input": "choice", "width": "half",
      "rect": { "x": 487, "y": 355, "w": 147, "h": 29 },
      "visible": true, "system": true },

    { "id": "holiday", "label": "공휴일 요금 적용", "input": "toggle", "width": "full",
      "rect": null, "visible": true, "system": true },

    { "id": "amount", "label": "사용금액", "input": "money", "width": "full",
      "rect": { "x": 232, "y": 355, "w": 138, "h": 29 },
      "visible": true, "system": true }
  ],

  "pricing": {
    "weekday": 35000,
    "weekend": 40000,
    "weekendDays": [0, 5, 6],
    "extraPerPersonNight": 5000,
    "basePeople": 2,
    "peopleOptions": [2, 3, 4],
    "maxNights": 5,
    "maxNightsText": "운영규정상 1세대가 한 달 기준 5박 이상 사용할 수 없습니다."
  },

  "account": {
    "bank": "국민은행",
    "number": "856901-00-129046",
    "holder": "원흥LH13단지주거복지지원센터"
  }
}
```

### 두 개의 `null`이 구조를 설명한다

- **`rect: null`** — 화면에는 있지만 서식에 찍히지 않는 항목. 입실일·퇴실일·공휴일이 여기 해당한다.
  지금 코드가 암묵적으로 하던 것(폼에는 있는데 `POS`에는 없음)을 명시적으로 표현한 것이다.
- **`input: null`** — 입력칸 없이 계산 결과로만 나오는 항목. 사용기간·숙박일수.

여기에 선택 속성 `printed`(기본값 `true`)가 붙는다. 서식에 찍는 조건은
`rect !== null && printed !== false`이다. `rect: null`은 "아직 위치를 잡지 않음",
`printed: false`는 "위치는 기억하되 지금은 찍지 않음"으로 구분된다.

### 파생 문구는 저장하지 않는다

현재 공휴일 토글 아래에는 `전 기간 40,000원`이라는 설명이 하드코딩되어 있다. 이것을 설정값으로
저장하면 관리자가 주말 요금을 45,000원으로 올렸을 때 설명만 40,000원으로 남는 사고가 난다.
따라서 이 문구는 저장하지 않고 `pricing.weekend`에서 매번 만들어 쓴다
(`전 기간 ${weekend.toLocaleString('ko-KR')}원`).

같은 이유로 계좌 복사 문자열도 저장하지 않고 `account.bank`와 `account.number`를 합쳐 만든다.

### 입력 유형

| `input` | 화면 | 자유 추가 |
|---|---|---|
| `text` | 텍스트 입력 | 가능 |
| `date` | 커스텀 달력 팝오버 | 가능 |
| `phone` | 텍스트 + 하이픈 자동 삽입 | 가능 |
| `choice` | 버튼 그룹 (`pricing.peopleOptions`) | 불가 (system 전용) |
| `toggle` | 스위치 | 불가 (system 전용) |
| `money` | 숫자 입력 + 자동 계산 연동 | 불가 (system 전용) |
| `null` | 없음 (계산 결과 출력 전용) | 불가 (system 전용) |

관리자가 새로 추가할 수 있는 항목은 `text` / `date` / `phone` 세 가지다. 나머지는 요금 계산
로직에 물려 있어 자유 생성이 무의미하다.

### `system` 플래그와 보호 규칙

`system: true`인 항목은 **삭제할 수 없다.** 라벨·좌표·표시여부만 조정 가능하다.
대상은 요금 계산에 관여하는 7개: `checkIn`, `checkOut`, `people`, `holiday`, `amount`,
`period`, `nights`.

추가로 **`checkIn`과 `checkOut`은 `visible: false`로 만들 수 없다.** 숨기면 숙박일수와 금액을
계산할 방법 자체가 사라지기 때문이다. `normalizeConfig()`가 이 두 항목의 `visible`을 강제로
`true`로 되돌린다. 예외는 이 둘뿐이며 테스트로 고정한다.

### 출력 문자열 서식

서식 이미지에 찍히는 문자열의 포맷은 코드가 갖는다 (관리자 편집 대상 아님).
좁은 칸에 맞추기 위해 의도적으로 압축된 형태이고, 이미 `index.html`에 검증된 로직이 있다.

| 항목 | 출력 예 | 규칙 |
|---|---|---|
| `date` 유형 전체 | `2026.7.28` | 앞자리 0 제거 (`compactDate`) |
| `period` | `2026.7.28 ~ 7.30` | 연도는 앞에만. 연도가 넘어가면 뒤에도 표기 (`shortDate`) |
| `nights` | `2일` | |
| `amount` | `70,000원` | 천 단위 구분 |
| `people` | `3명` | |
| 그 외 | 입력값 그대로 | |

### 좌표: 사각형 하나가 두 페이지를 모두 커버한다

`draw.html`은 사각형을, `index.html`은 중심점과 최대폭을 쓴다. 실측 결과 두 값은 같은 칸을
가리킨다.

| 항목 | `draw.html` 사각형 | 사각형 중심 | `index.html` `POS` |
|---|---|---|---|
| applyDate | (231, 198, 403, 26) | (432.5, 211) | (432, 211) |
| name | (231, 228, 403, 25) | (432.5, 240.5) | (432, 241) |
| unit | (231, 257, 403, 26) | (432.5, 270) | (432, 270) |
| phone | (231, 287, 403, 25) | (432.5, 299.5) | (432, 300) |
| period | (232, 323, 138, 28) | (301, 337) | (301, 337) |
| nights | (487, 323, 147, 28) | (560.5, 337) | (560, 337) |
| amount | (232, 355, 138, 29) | (301, 369.5) | (301, 370) |
| people | (487, 355, 147, 29) | (560.5, 369.5) | (560, 370) |
| deposit | (232, 454, 138, 34) | (301, 471) | (301, 471) |

사각형 중심과 기존 `POS`의 차이는 최대 0.5px다. 따라서 **사각형을 유일한 진실**로 삼고
`config.js`가 변환 함수를 제공한다.

```js
export function rectToPoint(rect) {
  return {
    x: Math.round(rect.x + rect.w / 2),
    y: Math.round(rect.y + rect.h / 2),
    maxWidth: rect.w - 2,   // 좌우 1px 안쪽 여백
  };
}
```

#### 반올림으로 생기는 1px 차이

`Math.round`를 적용하면 세로 좌표 9개는 기존 값과 **정확히 일치**하지만, 가로 좌표 4개는 1px
커진다. 중심이 `.5`로 떨어지는데 기존 값은 내림되어 있기 때문이다.

| | 사각형 중심 | `Math.round` | 기존 `POS` |
|---|---|---|---|
| applyDate·name·unit·phone | 432.5 | 433 | 432 |
| nights·people | 560.5 | 561 | 560 |

`Math.floor`로 바꾸면 이 4개는 맞지만 세로 좌표 3개(240.5·299.5·369.5)가 대신 1px 어긋난다.
어느 쪽도 완전 일치는 불가능하다 — 기존 값이 픽셀 스캔으로 손수 읽은 값이라 반올림 방향이
일관되지 않기 때문이다.

707px 폭 이미지에서 가운데 정렬된 글자가 1px 이동하는 것은 눈에 보이지 않으므로 `Math.round`를
쓴다. **테스트는 중심점을 ±1px 이내로 검증한다.** "정확히 일치"를 요구하면 통과할 수 없는
테스트가 된다.

변환된 `maxWidth`는 현재 값과 같거나 1px 크다 (403→401 vs 400, 138→136 vs 136, 147→145 vs 145).
`index.html`의 폰트 축소 루프는 1px 단위로 동작하고 실제 입력값 폭은 이 한계에서 한참 떨어져
있으므로 출력에 변화가 없다. `maxWidth`는 ±3px 이내로 검증한다.

관리자는 칸을 **한 번만** 잡으면 두 페이지에 동시에 반영된다.

## 관리자 화면 (`admin.html`)

탭 4개짜리 단일 페이지.

### 탭 ① 서식 & 칸 위치

```
┌─ 서식 이미지 ─────────────────┐  ┌─ 선택된 칸 ──────────┐
│ [이미지 교체]  form.jpg 707×1000│  │ 항목   신청일        │
│                               │  │ x 231   y 198        │
│  ┌───────────────────────┐    │  │ 폭 403  높이 26      │
│  │ ┌───신청일────────┐    │    │  │ 미리보기 2026.7.28   │
│  │ │ 2026.7.28      │    │    │  │ ⚠ 글자가 칸을 넘침   │
│  │ └────────────────┘    │    │  └──────────────────────┘
│  │ ┌───성명──────────┐   │    │  ┌─ 칸 목록 ────────────┐
│  │ │ 홍길동          │   │    │  │ ☑ 신청일   ☑ 성명    │
│  │ └─────────────────┘   │    │  │ ☑ 동·호수  ☑ 연락처  │
│  │ ┌─사용기간─┐┌─숙박일수┐│    │  │ ☑ 사용기간 ☐ 숙박일수│
│  │ │2026.7.28 ││ 2일    ││    │  │ ☑ 사용금액 ☑ 사용인원│
│  │ └──────────┘└────────┘│    │  │ ☑ 은행입금일         │
│  └───────────────────────┘    │  │ [+ 칸 추가]          │
└───────────────────────────────┘  └──────────────────────┘
```

- 박스 **클릭** → 선택 / **드래그** → 이동 / **모서리 핸들** → 크기 조절 / **방향키** → 1px 이동
- 빈 곳을 드래그하면 새 칸을 그린다
- 각 박스 안에 **실제 출력될 문자열을 실제 렌더링 폰트 크기로** 그린다. 칸을 넘치면 그 자리에서
  경고가 보인다. (현재 코드는 넘치면 폰트를 8px까지 줄이는데, 그 전에 관리자가 알아채는 편이 낫다)
- 좌표는 항상 **원본 이미지 좌표계**(`form.width` × `form.height`)로 저장한다. 화면 표시 배율은
  별도로 계산해 적용한다.

**두 종류의 체크박스를 혼동하지 않도록 한다.** 탭 ①의 칸 목록 체크박스는 `rect`의 유무
(= 서식 이미지에 찍을지)를 토글하고, 탭 ②의 표시/숨김은 `visible`(= 화면 입력칸을 보여줄지)을
토글한다. 둘은 독립이며 네 가지 조합이 모두 의미를 갖는다.

| `visible` | 서식 출력 | 의미 | 예 |
|---|---|---|---|
| O | O | 입력받아 서식에 찍는다 | 성명 |
| O | ✕ | 입력받지만 서식에는 안 찍는다 | 입실일·퇴실일·공휴일 |
| ✕ | O | 입력 없이 계산 결과만 찍는다 | 사용기간·숙박일수 |
| ✕ | ✕ | 사실상 비활성 항목 | 새 서식에서 없어진 칸 |

체크를 해제해도 좌표값은 버리지 않는다. `rect`를 `null`로 만드는 대신 `printed: false`를 세운다.
다시 켜면 이전 위치가 그대로 복원되어, 서식 개정으로 잠시 사라졌던 칸이 되살아날 때 좌표를 다시
잡지 않아도 된다.

**이미지 교체 시 좌표 자동 조정**: 새 이미지의 크기가 기존과 다르면 "기존 칸 위치를 비율에 맞춰
자동 조정할까요?"를 묻는다. 707×1000 → 1414×2000처럼 같은 서식을 고화질로 다시 스캔하는 경우가
흔한데, 이때 좌표를 다시 잡는 것은 낭비다. 승인하면 모든 `rect`에 `newW/oldW`, `newH/oldH`를
곱한다.

### 탭 ② 항목

`fields` 배열을 목록으로 보여주고 편집한다.

- 순서 이동 (↑↓) — 화면 배치 순서
- 라벨 수정, 표시/숨김, 삭제(`system`이 아닌 경우만), 추가
- 항목별 설정: 입력 유형 / 필수 여부 / 기억하기(`remember`) / 폭(`full`·`half`) /
  플레이스홀더 / 최대 글자수 / 날짜 지우기 허용(`clearable`) / 오늘 기본값(`defaultToday`)

새 항목의 `id`는 라벨을 영문 슬러그로 변환해 자동 생성하고 충돌 시 숫자를 붙인다.

### 배치 규칙 — `width`와 "홀로 남은 반 칸"

두 페이지가 같은 규칙으로 `fields` 순서를 훑어 줄을 만든다.

1. `half`가 **연속 두 개** 나오면 한 줄에 나란히 놓는다 (현재의 `.row2`)
2. `half` 다음이 `full`이거나 목록의 끝이면, 그 `half`는 **한 줄 전체로 늘린다**
3. `full`은 항상 한 줄을 차지한다

두 페이지는 서로 다른 부분집합을 그린다는 점이 중요하다. `index.html`은 `visible`이면서
`input !== null`인 항목(입력칸이 있는 것)을, `draw.html`은 **서식에 찍히는 칸**
(`rect !== null && printed !== false`)을 그린다. `draw.html`에는 입실일·퇴실일·공휴일 입력이
없고 사용기간·숙박일수를 손으로 직접 쓰기 때문이다.

이 규칙과 위 `fields` 순서가 맞물리면 두 페이지 모두 **현재 레이아웃이 그대로 재현된다.**

| | 배치 결과 |
|---|---|
| `index.html` | [신청일·은행입금일] [성명] [동호수·연락처] [입실일·퇴실일] [사용인원*] [공휴일] [사용금액] |
| `draw.html` | [신청일·은행입금일] [성명] [동호수·연락처] [사용기간] [숙박일수·사용인원] [사용금액] |

`사용인원`은 `width: half`지만 `index.html`에서는 다음 항목이 `full`(공휴일)이라 규칙 2에
따라 한 줄로 늘어난다(*). 현재 인원 버튼 3개가 한 줄을 쓰는 모습 그대로다. 반면 `draw.html`
에서는 앞의 `숙박일수`와 짝을 이뤄 현재의 2열 배치가 유지된다. **하나의 `width` 값으로 두
페이지의 현재 모습이 모두 나온다.**

### 탭 ③ 요금 · 계좌 · 문구

- 요금: 평일·주말 단가, 주말로 취급할 요일 (현재 금·토·일), 추가 인원 단가, 기준 인원,
  인원 버튼 목록, 최대 숙박일수와 경고 문구, 공휴일 토글 설명 문구
- 계좌: 은행명 / 계좌번호 / 예금주
- 문구: 상단 기관명, 제목

### 탭 ④ 미리보기 & 저장

**실제 `index.html`을 iframe으로 띄운다.** 관리자 페이지 안에 신청서 화면을 다시 구현하지
않는다. 그러면 화면이 두 벌이 되어 한쪽만 고치는 사고가 반드시 발생한다.

동작 방식: 편집 중인 설정을 `sessionStorage['guesthouse-config-preview']`에 넣고
`index.html?preview=1`을 iframe으로 연다. `index.html`은 `?preview=1`일 때만 이 값을
`config.json`보다 우선해 읽고, 샘플 값(홍길동 / 101동 1201호 / 010-1234-5678 / 날짜·인원)을
자동으로 채운다. 같은 출처이므로 `sessionStorage`가 공유된다. `draw.html`도 같은 방식으로 확인한다.

결과적으로 **실제 생성될 JPG가 그대로 보인다.**

## 저장 · 인증 · 되돌리기

### 인증

`admin.html`은 GitHub Pages에 있으므로 URL을 아는 누구나 열 수 있다. 그러나 열어도 저장은
불가능하다. GitHub 토큰이 없기 때문이다. **토큰이 유일한 열쇠다.**

정적 사이트에 비밀번호 게이트를 붙이지 않는다. 비밀번호가 소스코드에 그대로 들어가 개발자도구
한 번이면 노출된다 — 보안이 아니라 보안처럼 보이는 것이고, 그편이 더 위험하다.

- 최초 1회 **파인그레인드 개인 액세스 토큰** 등록. 권한은 이 저장소 하나, `Contents: Read/Write`만.
- 토큰은 `localStorage`에 보관하며 `api.github.com` 외 어디로도 전송하지 않는다.
- "토큰 삭제" 버튼으로 즉시 로그아웃.
- `index.html`·`draw.html`에는 관리자 링크를 노출하지 않는다.

### 저장 순서

```
새 이미지 있음? ──▶ ① 이미지 커밋 (form-20260728-1530.jpg)
                          │
                          ▼
                    ② config.json 커밋
```

**이미지를 먼저 커밋한다.** ①만 성공하고 ②가 실패해도 옛 `config.json`이 옛 이미지를 계속
가리키므로 주민 화면은 정상이다. 순서를 반대로 하면 `config.json`이 아직 존재하지 않는 이미지를
가리켜 화면이 깨진다.

**이미지는 덮어쓰지 않고 새 이름으로 올린다** (`form-<YYYYMMDD-HHmm>.jpg`). 같은 이름으로 덮으면
브라우저·CDN 캐시가 옛 이미지를 계속 보여주고, 되돌리기를 해도 이미지는 되돌아오지 않는다.

**동시 편집**은 GitHub Contents API의 `sha` 검사로 막힌다. 다른 사람이 먼저 저장했으면 409가
반환되고 "설정이 변경되었습니다. 새로고침 후 다시 시도하세요"를 안내한다. 조용히 덮어쓰지 않는다.

커밋 메시지: `chore: 관리자 설정 변경 (2026-07-28 15:30)`

### 되돌리기

`config.json`을 건드린 최근 커밋 10건을 날짜와 함께 나열한다. 선택하면 그 시점의 내용을 편집기로
불러오고, **미리보기로 확인한 뒤 새 커밋으로 저장**한다.

이력을 되감는 것이 아니라 옛 값으로 새로 저장하는 방식이다. 커밋 이력이 선형으로 유지되어
되돌리기를 되돌리는 것도 동일하게 동작한다.

## `index.html` · `draw.html` 리팩터 범위

### 제거되는 상수

| 파일 | 제거 대상 | 대체 |
|---|---|---|
| `index.html` | `POS` | `config.fields[].rect` → `rectToPoint()` |
| `index.html` | `REQUIRED` | `config.fields[].required` |
| `index.html` | `SAVED_FIELDS` | `config.fields[].remember` |
| `index.html` | `CLEARABLE` | `config.fields[].clearable` |
| `index.html` | `ACCOUNT_NUMBER` | `config.account` |
| `index.html` | 손으로 작성한 입력칸 HTML | `config.fields`로 생성 |
| `index.html` | `canvas width="707" height="1000"` | `config.form.width/height` |
| `draw.html` | `CELLS` | `config.fields[].rect` |
| `draw.html` | 손으로 작성한 `.field-box` 9개 HTML | 서식에 찍히는 칸으로부터 생성 |
| `draw.html` | `compositeCanvas` · `largeCanvas`의 707×1000 리터럴 | `config.form.width/height` |
| `calc.js` | `RATE` | `calcAmount(values, pricing)` 인자 |

`draw.html`의 손글씨 캔버스는 `id="c-<필드id>"` 규칙으로 `CELLS`와 연결되어 있다. 이 규칙은
유지하되 캔버스 자체를 config에서 생성한다. 미니 미리보기 캔버스(84×119)의 크기도 서식 비율에서
계산한다 — 서식이 가로로 긴 이미지로 바뀌면 지금은 찌그러진다.

### 유지되는 것

폼 생성이 동적으로 바뀔 뿐, 각 입력 유형의 동작(달력 팝오버, 하이픈 자동 삽입, 금액 자동계산과
수동 편집 추적, 손글씨 캔버스, 공유·저장, iOS 대응)은 현재 구현을 그대로 쓴다. 이 부분은 이미
실기기에서 검증된 코드이므로 건드리지 않는다.

`calc.js`의 `calcAmount`는 두 번째 인자로 `pricing`을 받는다. 인자를 생략하면 기본 요금표를
쓰도록 해 기존 호출부와 테스트의 변경을 최소화한다.

## 테스트

`node --test`로 검증한다. 실행: `node --test calc.test.mjs config.test.mjs`

### 가장 중요한 테스트 — 리팩터 회귀 방지

```js
test('기본 설정의 칸 중심점이 기존 하드코딩 POS와 일치한다', ...)
```

`DEFAULT_CONFIG`의 `rect` 9개를 `rectToPoint()`로 변환한 결과가 위 실측 표의 `index.html` `POS`
값과 일치하는지 검증한다 (중심점 ±1px, `maxWidth` ±3px — 사유는 위 "반올림으로 생기는 1px 차이" 참조).

**이 테스트 하나가 리팩터 전체의 안전망이다.** config 기반으로 갈아엎어도 출력 JPG가 픽셀 단위로
동일하다는 것이 보장된다.

### 그 외 `config.test.mjs`

- 깨진 JSON 문자열 → `DEFAULT_CONFIG` 반환
- 필수 키 누락(`fields`, `form`, `pricing`, `account`) → 해당 부분만 기본값으로 대체
- `rect`의 음수 좌표, 이미지 범위를 벗어난 좌표 → 범위 안으로 보정
- `checkIn`/`checkOut`의 `visible: false` → `true`로 강제 복구
- `system: true` 항목 삭제 시도 → 거부
- `peopleOptions`가 비었거나 `basePeople`보다 작은 값만 있는 경우 → 기본값 복구
- 알 수 없는 `input` 유형 → `text`로 대체
- `printed: false`인 항목은 `rect`가 있어도 서식 출력 목록에서 빠진다
- `printed`가 없으면 `true`로 취급한다 (기존 설정 하위 호환)

### `calc.test.mjs` 수정

- 기존 케이스는 `pricing` 인자를 생략해 그대로 통과해야 한다 (하위 호환 확인)
- 요금표를 바꿔 넣었을 때 결과가 따라 바뀌는지
- `weekendDays`를 바꿨을 때 주말 판정이 따라 바뀌는지

### 수동 확인

`python -m http.server 8000`으로 띄워 실제 폰(iOS/Android)에서 확인한다. `file://`로 열면
canvas가 오염되어 `toBlob`이 실패한다.

## 구현 순서

1. `config.js` + `config.test.mjs` — 기본값·검증·좌표 변환. **먼저 테스트가 통과해야 한다**
2. `calc.js` `pricing` 인자화 + `calc.test.mjs` 수정
3. `index.html`을 config 기반으로 전환 (`config.json` 없이 기본값만으로 현재와 동일 동작 확인)
4. `draw.html`을 config 기반으로 전환
5. `github.js` — Contents API 읽기/커밋, Commits API 이력
6. `admin.html` 탭 ②③ (항목·요금·계좌) — 좌표 없이 먼저 동작하는 관리 화면
7. `admin.html` 탭 ① 좌표 피커
8. `admin.html` 탭 ④ 미리보기 + 저장 + 되돌리기
9. `config.json` 초기 커밋 (= 기본값 그대로)

3번까지 끝나면 기존 기능이 그대로 동작하는지 확인할 수 있고, 6번에서 이미 쓸 수 있는 관리
화면이 나온다. 가장 난도가 높은 좌표 피커는 그 뒤에 붙인다.
