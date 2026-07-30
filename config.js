// 설정의 단일 진실. config.json이 없거나 깨졌을 때 여기로 복귀하므로,
// 이 값은 항상 "지금 실제로 쓰이는 서식"과 일치해야 한다.
export const DEFAULT_CONFIG = {
  version: 1,

  site: { org: '원흥LH13단지주거복지지원센터', title: '게스트하우스 신청서' },

  form: { image: 'form.jpg', width: 707, height: 1000 },

  // 순서가 곧 화면 순서다. index.html은 이 순서대로 한 줄씩 쌓고,
  // draw.html은 packRows()로 묶어 손글씨 칸을 만든다.
  fields: [
    { id: 'applyDate', label: '신청일', input: 'date', width: 'full',
      rect: { x: 231, y: 198, w: 403, h: 26 },
      printed: true, visible: true, required: true, clearable: false, defaultToday: true },

    { id: 'name', label: '성명', input: 'text', width: 'full',
      rect: { x: 231, y: 228, w: 403, h: 25 },
      printed: true, visible: true, required: true,
      placeholder: '', maxlength: 20, remember: true, charset: 'korean' },

    // 화면에서는 동·호를 따로 받고, 서식에는 'N동 M호' 한 줄로 찍는다.
    { id: 'unit', label: '동·호수', input: 'unit', width: 'half',
      rect: { x: 231, y: 257, w: 403, h: 26 },
      printed: true, visible: true, required: true,
      dongLength: 4, hoLength: 3, remember: true, tallBox: true },

    { id: 'phone', label: '연락처', input: 'phone', width: 'half',
      rect: { x: 231, y: 287, w: 403, h: 25 },
      printed: true, visible: true, required: true,
      placeholder: '', maxlength: 20, remember: true, tallBox: true, charset: 'any' },

    // 입실일·퇴실일은 서식에 직접 찍히지 않는다. 둘을 합쳐 period로 출력된다.
    { id: 'checkIn', label: '입실일 (사용기간 시작)', input: 'date', width: 'half',
      rect: null, printed: true, visible: true, required: true,
      system: true, clearable: true, defaultToday: false },

    { id: 'checkOut', label: '퇴실일 (사용기간 종료)', input: 'date', width: 'half',
      rect: null, printed: true, visible: true, required: true,
      system: true, clearable: true, defaultToday: false },

    // input: null = 화면에 칸이 없고 서식에만 찍히는 항목.
    { id: 'period', label: '사용기간', input: null, width: 'full',
      rect: { x: 232, y: 323, w: 138, h: 28 },
      printed: true, visible: true, required: false, system: true, tallBox: true },

    // readout = 사람이 못 고치는 자동 계산 표시칸.
    { id: 'nights', label: '사용일수 (자동 계산)', input: 'readout', width: 'half',
      rect: { x: 487, y: 323, w: 147, h: 28 },
      printed: true, visible: true, required: false, system: true, suffix: '' },

    { id: 'amount', label: '사용금액 (자동 계산)', input: 'readout', width: 'half',
      rect: { x: 232, y: 355, w: 138, h: 29 },
      printed: true, visible: true, required: false, system: true, suffix: '원' },

    { id: 'people', label: '사용인원', input: 'choice', width: 'half',
      rect: { x: 487, y: 355, w: 147, h: 29 },
      printed: true, visible: true, required: false, system: true },

    { id: 'deposit', label: '은행입금일', input: 'date', width: 'half',
      rect: { x: 232, y: 454, w: 138, h: 34 },
      printed: true, visible: true, required: false, clearable: true, defaultToday: true },
  ],

  pricing: {
    weekday: 35000,
    weekend: 40000,
    weekendDays: [0, 5, 6], // getDay() 기준: 0=일, 5=금, 6=토
    extraPerPersonNight: 5000,
    basePeople: 2,
    peopleOptions: [2, 3, 4],
  },

  // 예약할 수 있는 기간. 달력에서 아예 못 고르게 막는 값이라 경고가 아니라 제한이다.
  stay: {
    limitDates: true,
    maxAheadMonths: 1, // 오늘부터 한 달 뒤까지만
    minNights: 1,
    maxNights: 2,      // 퇴실일은 입실일 +1 ~ +2일
  },

  // 공휴일 요금은 특일정보 API로 자동 판정한다(index.html의 loadHolidays 참조).
  // 서비스키는 index.html에 그대로 둔다 — 설정으로 옮기면 노출 지점이 늘어난다.
  holiday: {
    enabled: true,
    eveOfHoliday: true, // 공휴일 '전날 밤'도 주말 요금으로 볼지
  },

  // 게스트하우스 두 곳. 요금·인원·규정이 같으므로 pricing은 하나를 공유한다.
  // 집마다 조건이 달라지면 그때 houses[].pricing으로 덮어쓰는 구조를 더한다.
  houses: [
    { id: 'a', label: 'A동' },
    { id: 'b', label: 'B동' },
  ],

  // 예약 저장소(Supabase). anonKey는 공개되어도 되는 키다 — 이 키로 할 수 있는
  // 일은 DB의 RLS가 허용한 범위(대기 신청 추가, 공개 달력 조회)뿐이다.
  reservation: {
    enabled: false,
    url: '',
    anonKey: '',
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

// ---- 검증·정규화 ----
// config.json은 관리자가 브라우저에서 쓰는 파일이라 신뢰할 수 없는 입력이다.
// 여기가 깨진 값이 화면에 닿기 전에 막는 유일한 방어선이다.

const INPUT_TYPES = new Set(['text', 'date', 'phone', 'unit', 'choice', 'readout']);

// 입력 가능한 문자 종류. index.html이 입력할 때마다 나머지 문자를 지운다.
export const CHARSETS = ['any', 'korean', 'digits'];

// 관리자가 새로 만들 수 있는 입력 유형. 나머지는 계산 로직에 묶여 있어
// 자유롭게 생성해도 의미가 없다.
export const CREATABLE_INPUTS = ['text', 'date', 'phone'];

// 요금 계산에 물려 있어 삭제할 수 없는 항목.
const SYSTEM_IDS = ['checkIn', 'checkOut', 'period', 'nights', 'amount', 'people'];

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

// 좌표를 이미지 범위 안으로 밀어 넣는다. 관리자가 이미지를 더 작은 것으로
// 교체했을 때 옛 좌표가 그대로 남아 캔버스 밖에 찍히는 것을 막는다.
function normalizeRect(raw, form) {
  if (!raw || typeof raw !== 'object') return null;
  if (![raw.x, raw.y, raw.w, raw.h].every((n) => Number.isFinite(n))) return null;

  const x = Math.min(Math.max(0, Math.round(raw.x)), form.width - 1);
  const y = Math.min(Math.max(0, Math.round(raw.y)), form.height - 1);
  const w = Math.min(Math.max(1, Math.round(raw.w)), form.width - x);
  const h = Math.min(Math.max(1, Math.round(raw.h)), form.height - y);
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
    field.placeholder = typeof raw.placeholder === 'string' ? raw.placeholder : (base.placeholder || '');
    field.maxlength = Math.round(positiveNumber(raw.maxlength, base.maxlength || 20));
    // 받을 문자 종류. 성명에 숫자가 섞여 들어가는 것 같은 오입력을 막는다.
    field.charset = CHARSETS.includes(raw.charset) ? raw.charset : (base.charset || 'any');
  }
  if (field.input === 'date') {
    field.clearable = raw.clearable !== undefined ? raw.clearable === true : base.clearable === true;
    field.defaultToday = raw.defaultToday !== undefined
      ? raw.defaultToday === true
      : base.defaultToday === true;
  }
  if (field.input === 'unit') {
    field.dongLength = Math.round(positiveNumber(raw.dongLength, base.dongLength || 4));
    field.hoLength = Math.round(positiveNumber(raw.hoLength, base.hoLength || 3));
  }
  if (field.input === 'readout') {
    // 값 뒤에 붙는 단위. 빈 문자열이 유효한 값이라 nonEmptyString을 쓰지 않는다.
    field.suffix = typeof raw.suffix === 'string' ? raw.suffix : (base.suffix || '');
  }
  if (raw.remember !== undefined ? raw.remember === true : base.remember === true) {
    field.remember = true;
  }
  // 손글씨 칸을 높게 쓸지. 서식 칸 비율과는 무관하다 — 합성할 때 비율을 유지한 채
  // 축소되므로, 이 값은 순전히 "쓸 공간이 얼마나 필요한가"의 문제다.
  if (raw.tallBox !== undefined ? raw.tallBox === true : base.tallBox === true) {
    field.tallBox = true;
  }

  return field;
}

function normalizeFields(raw, form) {
  const defaults = new Map(DEFAULT_CONFIG.fields.map((f) => [f.id, f]));

  // 항목 목록이 통째로 없거나 비었으면 손을 댄 것으로 보지 않고 기본값을 쓴다.
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_CONFIG.fields.map((f) => normalizeField(clone(f), form, f));
  }

  const seen = new Set();
  const fields = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.id !== 'string' || !item.id.trim()) continue;
    if (seen.has(item.id)) continue; // 중복 id는 첫 번째만 살린다
    seen.add(item.id);
    fields.push(normalizeField(item, form, defaults.get(item.id)));
  }

  // 삭제된 system 항목을 원래 자리 순서대로 되살린다.
  for (const id of SYSTEM_IDS) {
    if (seen.has(id)) continue;
    const index = DEFAULT_CONFIG.fields.findIndex((f) => f.id === id);
    const restored = normalizeField(clone(defaults.get(id)), form, defaults.get(id));
    fields.splice(Math.min(index, fields.length), 0, restored);
  }

  return fields;
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
    weekendDays: days.length ? [...new Set(days)].sort((a, b) => a - b) : clone(base.weekendDays),
    // 추가 인원 요금만은 0이 유효한 값이다(추가 요금 없음).
    extraPerPersonNight: Number.isFinite(raw.extraPerPersonNight) && raw.extraPerPersonNight >= 0
      ? raw.extraPerPersonNight
      : base.extraPerPersonNight,
    basePeople: Math.round(positiveNumber(raw.basePeople, base.basePeople)),
    peopleOptions: people.length ? [...new Set(people)].sort((a, b) => a - b) : clone(base.peopleOptions),
  };
}

function normalizeStay(raw) {
  const base = DEFAULT_CONFIG.stay;
  if (!raw || typeof raw !== 'object') return clone(base);

  const minNights = Math.round(positiveNumber(raw.minNights, base.minNights));
  const maxNights = Math.round(positiveNumber(raw.maxNights, base.maxNights));
  return {
    limitDates: raw.limitDates !== false,
    maxAheadMonths: Math.round(positiveNumber(raw.maxAheadMonths, base.maxAheadMonths)),
    minNights,
    // 최소가 최대보다 크면 달력에서 고를 수 있는 날이 하나도 없어진다.
    maxNights: Math.max(minNights, maxNights),
  };
}

function normalizeHoliday(raw) {
  const base = DEFAULT_CONFIG.holiday;
  if (!raw || typeof raw !== 'object') return clone(base);
  return {
    enabled: raw.enabled !== false,
    eveOfHoliday: raw.eveOfHoliday !== false,
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

function normalizeHouses(raw) {
  const base = DEFAULT_CONFIG.houses;
  if (!Array.isArray(raw)) return clone(base);

  const seen = new Set();
  const houses = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.id !== 'string' || !item.id.trim()) continue;
    if (seen.has(item.id)) continue; // 중복 id는 첫 번째만 살린다
    seen.add(item.id);
    houses.push({ id: item.id, label: nonEmptyString(item.label, item.id) });
  }
  return houses.length ? houses : clone(base);
}

function normalizeReservation(raw) {
  const base = DEFAULT_CONFIG.reservation;
  if (!raw || typeof raw !== 'object') return clone(base);

  // 주소 끝의 슬래시를 떼지 않으면 요청 URL에 //가 생긴다.
  const url = nonEmptyString(raw.url, '').replace(/\/+$/, '');
  const anonKey = nonEmptyString(raw.anonKey, '');

  return {
    // 주소나 키가 없으면 켜져 있어도 끈다. 반쯤 설정된 상태로 예약 화면이 뜨면
    // 주민은 신청했다고 믿는데 실제로는 아무 데도 저장되지 않는다.
    enabled: raw.enabled === true && Boolean(url) && Boolean(anonKey),
    url,
    anonKey,
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

// 어떤 입력이 들어와도 항상 쓸 수 있는 설정을 돌려준다.
export function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clone(DEFAULT_CONFIG);
  const form = normalizeForm(raw.form);
  return {
    version: 1,
    site: normalizeSite(raw.site),
    form,
    fields: normalizeFields(raw.fields, form),
    pricing: normalizePricing(raw.pricing),
    stay: normalizeStay(raw.stay),
    holiday: normalizeHoliday(raw.holiday),
    houses: normalizeHouses(raw.houses),
    reservation: normalizeReservation(raw.reservation),
    account: normalizeAccount(raw.account),
  };
}

// ---- 배치 규칙과 대상 필터 ----
// 두 페이지가 서로 다른 부분집합을 같은 규칙으로 배치한다.

// index.html이 그리는 대상: 사람이 값을 입력하는 항목.
export function formFields(config) {
  return config.fields.filter((f) => f.visible !== false && f.input !== null);
}

// draw.html이 그리는 대상: 서식 이미지에 찍히는 칸. 손글씨 페이지는 입실일·퇴실일
// 대신 사용기간을 직접 쓰므로 "입력 항목"이 아니라 "출력 칸" 기준이다.
export function printedCells(config) {
  return config.fields.filter((f) => f.rect && f.printed !== false);
}

// unit 유형은 화면에서 동·호 두 칸이라 DOM id가 두 개다. 저장·입력필터처럼
// "실제 입력칸"을 대상으로 하는 처리는 이 목록을 써야 한다.
export function domIds(field) {
  return field.input === 'unit' ? [field.id + 'Dong', field.id + 'Ho'] : [field.id];
}

// index.html이 쓰던 하드코딩 상수들(POS·REQUIRED·SAVED_FIELDS·CLEARABLE·
// ACCOUNT_NUMBER)을 설정에서 한 번에 유도한다. DOM에 얽히지 않은 순수 함수라
// 값이 옛 하드코딩과 같은지 테스트로 고정할 수 있다.
export function derive(config) {
  const form = formFields(config);
  const positions = {};
  for (const field of printedCells(config)) positions[field.id] = rectToPoint(field.rect);

  const required = {};
  for (const field of form) if (field.required) required[field.id] = field.label;

  return {
    positions,
    required,
    rememberedIds: form.filter((f) => f.remember).flatMap(domIds),
    clearableIds: form.filter((f) => f.clearable).map((f) => f.id),
    dateIds: form.filter((f) => f.input === 'date').map((f) => f.id),
    // 토스·카카오페이 등의 '붙여넣기'가 은행과 계좌번호를 함께 인식하도록 은행명을 붙인다.
    accountText: config.account.bank + ' ' + config.account.number,
  };
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
