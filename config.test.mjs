import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_CONFIG, rectToPoint, clone, normalizeConfig, parseConfig,
  formFields, printedCells, packRows,
} from './config.js';

// 리팩터 전 index.html이 하드코딩하고 있던 값. 설정 기반으로 바꾼 뒤에도
// 같은 자리에 찍혀야 한다. 이 테스트가 리팩터 전체의 안전망이다.
const LEGACY_POS = {
  applyDate: { x: 432, y: 211, maxWidth: 400 },
  name:      { x: 432, y: 241, maxWidth: 400 },
  unit:      { x: 432, y: 270, maxWidth: 400 },
  phone:     { x: 432, y: 300, maxWidth: 400 },
  period:    { x: 301, y: 337, maxWidth: 136 },
  nights:    { x: 560, y: 337, maxWidth: 145 },
  amount:    { x: 301, y: 370, maxWidth: 136 },
  people:    { x: 560, y: 370, maxWidth: 145 },
  deposit:   { x: 301, y: 471, maxWidth: 136 },
};

test('기본 설정의 칸 좌표가 기존 하드코딩 POS와 일치한다', () => {
  for (const [id, legacy] of Object.entries(LEGACY_POS)) {
    const field = DEFAULT_CONFIG.fields.find((f) => f.id === id);
    assert.ok(field, `${id} 항목이 기본 설정에 없다`);
    assert.ok(field.rect, `${id}에 rect가 없다`);

    const point = rectToPoint(field.rect);
    // 중심점 ±1px: 기존 값이 픽셀 스캔으로 손수 읽은 값이라 반올림 방향이
    // 일관되지 않다. 설계 문서 "반올림으로 생기는 1px 차이" 참조.
    assert.ok(Math.abs(point.x - legacy.x) <= 1, `${id} x: ${point.x} vs ${legacy.x}`);
    assert.ok(Math.abs(point.y - legacy.y) <= 1, `${id} y: ${point.y} vs ${legacy.y}`);
    assert.ok(
      Math.abs(point.maxWidth - legacy.maxWidth) <= 3,
      `${id} maxWidth: ${point.maxWidth} vs ${legacy.maxWidth}`
    );
  }
});

test('서식에 찍히는 칸은 정확히 9개다', () => {
  const printed = DEFAULT_CONFIG.fields.filter((f) => f.rect);
  assert.equal(printed.length, 9);
});

test('요금표 기본값이 기존 RATE와 같다', () => {
  const p = DEFAULT_CONFIG.pricing;
  assert.equal(p.weekday, 35000);
  assert.equal(p.weekend, 40000);
  assert.equal(p.extraPerPersonNight, 5000);
  assert.equal(p.basePeople, 2);
  assert.deepEqual(p.peopleOptions, [2, 3, 4]);
  assert.deepEqual(p.weekendDays, [0, 5, 6]); // 일·금·토
});

test('clone은 원본을 공유하지 않는 깊은 복사본을 만든다', () => {
  const copy = clone(DEFAULT_CONFIG);
  copy.fields[0].rect.x = 999;
  copy.pricing.weekday = 1;
  assert.notEqual(DEFAULT_CONFIG.fields[0].rect.x, 999);
  assert.equal(DEFAULT_CONFIG.pricing.weekday, 35000);
});

// ---- 검증·정규화 ----

test('입력이 없거나 객체가 아니면 기본값을 돌려준다', () => {
  for (const bad of [null, undefined, 'x', 42, []]) {
    assert.deepEqual(normalizeConfig(bad), DEFAULT_CONFIG);
  }
});

test('기본 설정을 정규화하면 자기 자신이 나온다', () => {
  // normalizeField가 만드는 속성 집합과 DEFAULT_CONFIG가 어긋나면
  // 위 테스트가 조용히 깨진다. 그 불일치를 직접 잡는다.
  assert.deepEqual(normalizeConfig(clone(DEFAULT_CONFIG)), DEFAULT_CONFIG);
});

test('깨진 JSON 문자열은 기본값으로 복귀한다', () => {
  assert.deepEqual(parseConfig('{ 이건 JSON이 아니다'), DEFAULT_CONFIG);
  assert.deepEqual(parseConfig(''), DEFAULT_CONFIG);
});

test('일부 키만 있으면 나머지는 기본값으로 채운다', () => {
  const result = normalizeConfig({ account: { bank: '신한은행', number: '110-1', holder: '홍길동' } });
  assert.equal(result.account.bank, '신한은행');
  assert.equal(result.pricing.weekday, 35000);      // 손대지 않은 부분은 기본값
  assert.equal(result.fields.length, DEFAULT_CONFIG.fields.length);
});

test('rect가 이미지 범위를 벗어나면 범위 안으로 보정한다', () => {
  const result = normalizeConfig({
    form: { image: 'form.jpg', width: 707, height: 1000 },
    fields: [{ id: 'name', label: '성명', input: 'text', rect: { x: -50, y: 990, w: 5000, h: 5000 } }],
  });
  const rect = result.fields.find((f) => f.id === 'name').rect;
  assert.ok(rect.x >= 0 && rect.y >= 0);
  assert.ok(rect.x + rect.w <= 707);
  assert.ok(rect.y + rect.h <= 1000);
});

test('입실일·퇴실일은 숨길 수 없다', () => {
  // 숨기면 숙박일수와 금액을 계산할 방법이 사라진다.
  const result = normalizeConfig({
    fields: [
      { id: 'checkIn', label: '입실일', input: 'date', rect: null, visible: false },
      { id: 'checkOut', label: '퇴실일', input: 'date', rect: null, visible: false },
    ],
  });
  assert.equal(result.fields.find((f) => f.id === 'checkIn').visible, true);
  assert.equal(result.fields.find((f) => f.id === 'checkOut').visible, true);
});

test('삭제된 system 항목은 되살린다', () => {
  const result = normalizeConfig({
    fields: [{ id: 'name', label: '성명', input: 'text', rect: null }],
  });
  for (const id of ['checkIn', 'checkOut', 'period', 'nights', 'amount', 'people']) {
    assert.ok(result.fields.some((f) => f.id === id), `${id}가 복구되지 않았다`);
  }
});

test('알 수 없는 input 유형은 text로 대체한다', () => {
  const result = normalizeConfig({
    fields: [{ id: 'memo', label: '메모', input: 'rocket', rect: null }],
  });
  assert.equal(result.fields.find((f) => f.id === 'memo').input, 'text');
});

test('printed가 없으면 true로 취급하고, false면 좌표는 남긴다', () => {
  const result = normalizeConfig({
    fields: [
      { id: 'name', label: '성명', input: 'text', rect: { x: 10, y: 10, w: 100, h: 20 } },
      { id: 'unit', label: '동·호수', input: 'text', rect: { x: 10, y: 40, w: 100, h: 20 }, printed: false },
    ],
  });
  assert.equal(result.fields.find((f) => f.id === 'name').printed, true);
  const unit = result.fields.find((f) => f.id === 'unit');
  assert.equal(unit.printed, false);
  assert.ok(unit.rect, 'printed:false여도 좌표는 보관해야 한다');
});

test('peopleOptions가 비었거나 숫자가 아니면 기본값으로 복귀한다', () => {
  assert.deepEqual(normalizeConfig({ pricing: { peopleOptions: [] } }).pricing.peopleOptions, [2, 3, 4]);
  assert.deepEqual(normalizeConfig({ pricing: { peopleOptions: ['둘'] } }).pricing.peopleOptions, [2, 3, 4]);
});

test('요금이 음수거나 숫자가 아니면 기본값으로 복귀한다', () => {
  const result = normalizeConfig({ pricing: { weekday: -1, weekend: 'x', extraPerPersonNight: 7000 } });
  assert.equal(result.pricing.weekday, 35000);
  assert.equal(result.pricing.weekend, 40000);
  assert.equal(result.pricing.extraPerPersonNight, 7000); // 유효한 값은 살린다
});

test('추가 인원 요금 0은 유효한 값이다', () => {
  // 0은 "추가 요금 없음"이라는 뜻이지 잘못된 값이 아니다.
  assert.equal(normalizeConfig({ pricing: { extraPerPersonNight: 0 } }).pricing.extraPerPersonNight, 0);
});

test('중복 id는 첫 번째만 남긴다', () => {
  const result = normalizeConfig({
    fields: [
      { id: 'name', label: '첫번째', input: 'text', rect: null },
      { id: 'name', label: '두번째', input: 'text', rect: null },
    ],
  });
  assert.equal(result.fields.filter((f) => f.id === 'name').length, 1);
  assert.equal(result.fields.find((f) => f.id === 'name').label, '첫번째');
});

test('정규화 결과는 원본 기본값을 오염시키지 않는다', () => {
  const result = normalizeConfig({ pricing: { weekday: 99000 } });
  result.fields[0].label = '바뀐 라벨';
  assert.equal(DEFAULT_CONFIG.pricing.weekday, 35000);
  assert.equal(DEFAULT_CONFIG.fields[0].label, '신청일');
});

// ---- 배치 규칙과 대상 필터 ----

const ids = (rows) => rows.map((row) => row.map((f) => f.id));

// 설정의 fields 일부만 바꿔 정규화된 설정을 만든다.
function withFields(patch) {
  const fields = clone(DEFAULT_CONFIG.fields).map((f) => (patch[f.id] ? { ...f, ...patch[f.id] } : f));
  return normalizeConfig({ ...clone(DEFAULT_CONFIG), fields });
}

test('index.html 폼 항목 순서가 서식 순서와 같다', () => {
  // index.html은 2열 배치를 쓰지 않고 한 줄씩 쌓으므로 packRows를 거치지 않는다.
  assert.deepEqual(formFields(DEFAULT_CONFIG).map((f) => f.id), [
    'applyDate', 'name', 'unit', 'phone',
    'checkIn', 'checkOut', 'nights', 'amount', 'people', 'deposit',
  ]);
});

test('draw.html 배치', () => {
  const rows = ids(packRows(printedCells(DEFAULT_CONFIG)));
  assert.deepEqual(rows, [
    ['applyDate'],
    ['name'],
    ['unit', 'phone'],
    ['period'],
    ['nights', 'amount'],
    ['people', 'deposit'],
  ]);
});

test('formFields는 화면에 칸이 없는 항목을 뺀다', () => {
  const list = formFields(DEFAULT_CONFIG).map((f) => f.id);
  assert.ok(!list.includes('period'), '사용기간은 서식에만 찍힌다');
  assert.ok(list.includes('nights'), '사용일수는 자동 계산 표시칸으로 화면에 있다');
  assert.ok(list.includes('checkIn'));
});

test('공휴일은 폼 항목이 아니라 설정이다', () => {
  // 수동 토글을 없애고 특일정보 API 자동 판정으로 바꿨다.
  assert.ok(!DEFAULT_CONFIG.fields.some((f) => f.id === 'holiday'));
  assert.equal(DEFAULT_CONFIG.holiday.enabled, true);
  assert.equal(DEFAULT_CONFIG.holiday.eveOfHoliday, true);
});

test('예약 가능 기간이 최대 2박으로 제한된다', () => {
  assert.equal(DEFAULT_CONFIG.stay.minNights, 1);
  assert.equal(DEFAULT_CONFIG.stay.maxNights, 2);
  assert.equal(DEFAULT_CONFIG.stay.limitDates, true);
});

test('최소 숙박일수가 최대보다 크면 최대를 끌어올린다', () => {
  // 그대로 두면 달력에서 고를 수 있는 날이 하나도 없어진다.
  const result = normalizeConfig({ stay: { minNights: 3, maxNights: 1 } });
  assert.equal(result.stay.minNights, 3);
  assert.equal(result.stay.maxNights, 3);
});

test('동·호수는 화면에서 두 칸, 서식에서는 한 칸이다', () => {
  const unit = DEFAULT_CONFIG.fields.find((f) => f.id === 'unit');
  assert.equal(unit.input, 'unit');
  assert.equal(unit.dongLength, 4);
  assert.equal(unit.hoLength, 3);
  assert.ok(unit.rect, '서식에는 한 칸으로 찍힌다');
});

test('printedCells는 rect 없는 항목과 printed:false를 뺀다', () => {
  const list = printedCells(DEFAULT_CONFIG).map((f) => f.id);
  assert.ok(!list.includes('checkIn'));
  assert.ok(!list.includes('holiday'));
  assert.equal(list.length, 9);

  const hidden = withFields({ deposit: { printed: false } });
  assert.ok(!printedCells(hidden).map((f) => f.id).includes('deposit'));
});

test('숨긴 항목은 화면에서 빠지고 배치가 다시 계산된다', () => {
  const config = withFields({ deposit: { visible: false } });
  const rows = ids(packRows(formFields(config)));
  // 신청일이 홀로 남으면 한 줄 전체를 쓰고, 그 다음부터 짝이 다시 맞는다.
  assert.deepEqual(rows[0], ['applyDate']);
  assert.deepEqual(rows[1], ['name']);
  assert.deepEqual(rows[2], ['unit', 'phone']);
});

test('packRows는 빈 배열에 빈 배열을 돌려준다', () => {
  assert.deepEqual(packRows([]), []);
});

// ---- 저장소의 config.json ----

test('저장소의 config.json이 정규화를 통과한다', () => {
  const text = readFileSync(new URL('./config.json', import.meta.url), 'utf8');
  const parsed = parseConfig(text);
  // 관리자가 저장한 뒤에는 기본값과 달라지는 것이 정상이므로 구조만 확인한다.
  assert.equal(parsed.version, 1);
  // system 항목은 정규화가 되살리므로 그 개수만큼은 반드시 있다.
  assert.ok(parsed.fields.length >= 6, `항목이 ${parsed.fields.length}개뿐이다`);
  assert.ok(printedCells(parsed).length >= 1, '서식에 찍히는 칸이 하나도 없다');
  assert.ok(parsed.account.number, '계좌번호가 비어 있다');
  assert.ok(parsed.form.image, '서식 이미지 경로가 비어 있다');
});

test('config.json의 모든 칸이 서식 이미지 범위 안에 있다', () => {
  // 관리자가 좌표를 잘못 잡아 커밋해도 정규화가 잡아주지만, 저장된 파일 자체가
  // 이미 범위를 벗어났다면 관리자 페이지 쪽에 문제가 있다는 신호다.
  const parsed = parseConfig(readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
  for (const field of printedCells(parsed)) {
    const { x, y, w, h } = field.rect;
    assert.ok(x >= 0 && y >= 0, `${field.id}의 좌표가 음수다`);
    assert.ok(x + w <= parsed.form.width, `${field.id}이 이미지 오른쪽을 넘는다`);
    assert.ok(y + h <= parsed.form.height, `${field.id}이 이미지 아래를 넘는다`);
  }
});
