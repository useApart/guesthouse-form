import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, rectToPoint, clone } from './config.js';

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
