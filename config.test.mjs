import { test } from 'node:test';
import assert from 'node:assert/strict';
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
  for (const id of ['checkIn', 'checkOut', 'period', 'nights', 'people', 'holiday', 'amount']) {
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

test('index.html 배치가 현재와 같다', () => {
  const rows = ids(packRows(formFields(DEFAULT_CONFIG)));
  assert.deepEqual(rows, [
    ['applyDate', 'deposit'],
    ['name'],
    ['unit', 'phone'],
    ['checkIn', 'checkOut'],
    ['people'],   // half지만 다음이 full(holiday)이라 한 줄 전체로 늘어난다
    ['holiday'],
    ['amount'],
  ]);
});

test('draw.html 배치가 현재와 같다', () => {
  const rows = ids(packRows(printedCells(DEFAULT_CONFIG)));
  assert.deepEqual(rows, [
    ['applyDate', 'deposit'],
    ['name'],
    ['unit', 'phone'],
    ['period'],
    ['nights', 'people'],
    ['amount'],
  ]);
});

test('formFields는 계산 전용 항목을 뺀다', () => {
  const list = formFields(DEFAULT_CONFIG).map((f) => f.id);
  assert.ok(!list.includes('period'));
  assert.ok(!list.includes('nights'));
  assert.ok(list.includes('checkIn'));
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
