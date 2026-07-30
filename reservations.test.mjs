import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  occupiedNights, bookedNights, isHouseFree, availableHouses, nightStatus,
  makeSecret, buildRequest,
  findByHousehold, findByName, summarize, monthGrid,
} from './reservations.js';

const HOUSES = [{ id: 'a', label: '1호실' }, { id: 'b', label: '2호실' }];

test('예약은 퇴실일 전날 밤까지만 점유한다', () => {
  // 1/10 입실, 1/12 퇴실 = 10일 밤, 11일 밤. 12일은 다음 손님이 쓸 수 있다.
  assert.deepEqual(
    occupiedNights({ check_in: '2026-01-10', check_out: '2026-01-12' }),
    ['2026-01-10', '2026-01-11']
  );
});

test('1박은 밤 하나만 점유한다', () => {
  assert.deepEqual(
    occupiedNights({ check_in: '2026-01-10', check_out: '2026-01-11' }),
    ['2026-01-10']
  );
});

test('월을 넘어가는 예약도 이어서 센다', () => {
  assert.deepEqual(
    occupiedNights({ check_in: '2026-01-31', check_out: '2026-02-02' }),
    ['2026-01-31', '2026-02-01']
  );
});

test('날짜가 없거나 깨졌으면 빈 배열', () => {
  assert.deepEqual(occupiedNights({ check_in: '', check_out: '' }), []);
  assert.deepEqual(occupiedNights({ check_in: '2026-13-45', check_out: '2026-01-02' }), []);
  assert.deepEqual(occupiedNights(null), []);
  // 퇴실일이 입실일보다 앞서면 점유할 밤이 없다
  assert.deepEqual(occupiedNights({ check_in: '2026-01-12', check_out: '2026-01-10' }), []);
});

test('bookedNights는 집별로 밤을 모은다', () => {
  const booked = bookedNights([
    { house: 'a', check_in: '2026-01-10', check_out: '2026-01-12' },
    { house: 'b', check_in: '2026-01-11', check_out: '2026-01-12' },
  ]);
  assert.deepEqual([...booked.get('a')].sort(), ['2026-01-10', '2026-01-11']);
  assert.deepEqual([...booked.get('b')].sort(), ['2026-01-11']);
});

test('bookedNights는 취소된 예약을 넣지 않는다', () => {
  // 주민 화면은 public_calendar 뷰가 취소를 걸러 주지만, 관리사무소 화면은
  // 취소까지 포함된 전체 목록을 다룬다. 여기서 안 거르면 취소된 예약이 자리를 막는다.
  const booked = bookedNights([
    { house: 'a', check_in: '2026-01-10', check_out: '2026-01-12', status: 'cancelled' },
  ]);
  assert.equal(booked.size, 0);
  assert.equal(isHouseFree(booked, 'a', '2026-01-10', '2026-01-12'), true);
});

test('퇴실일에 바로 이어지는 예약은 겹치지 않는다', () => {
  const booked = bookedNights([{ house: 'a', check_in: '2026-01-10', check_out: '2026-01-12' }]);
  assert.equal(isHouseFree(booked, 'a', '2026-01-12', '2026-01-13'), true);
});

test('하루라도 겹치면 비어 있지 않다', () => {
  const booked = bookedNights([{ house: 'a', check_in: '2026-01-10', check_out: '2026-01-12' }]);
  assert.equal(isHouseFree(booked, 'a', '2026-01-11', '2026-01-13'), false);
  assert.equal(isHouseFree(booked, 'a', '2026-01-09', '2026-01-11'), false);
  assert.equal(isHouseFree(booked, 'a', '2026-01-09', '2026-01-13'), false); // 감싸는 경우
});

test('예약이 없는 집은 언제나 비어 있다', () => {
  const booked = bookedNights([{ house: 'a', check_in: '2026-01-10', check_out: '2026-01-12' }]);
  assert.equal(isHouseFree(booked, 'b', '2026-01-10', '2026-01-12'), true);
});

test('availableHouses는 그 기간에 가능한 집만 남긴다', () => {
  const booked = bookedNights([{ house: 'a', check_in: '2026-01-10', check_out: '2026-01-12' }]);
  assert.deepEqual(
    availableHouses(HOUSES, booked, '2026-01-10', '2026-01-11').map((h) => h.id),
    ['b']
  );
});

test('두 집이 다 차면 빈 목록', () => {
  const booked = bookedNights([
    { house: 'a', check_in: '2026-01-10', check_out: '2026-01-12' },
    { house: 'b', check_in: '2026-01-10', check_out: '2026-01-12' },
  ]);
  assert.deepEqual(availableHouses(HOUSES, booked, '2026-01-10', '2026-01-11'), []);
});

test('nightStatus는 달력 한 칸에 표시할 집별 상태를 준다', () => {
  const booked = bookedNights([{ house: 'a', check_in: '2026-01-10', check_out: '2026-01-12' }]);
  assert.deepEqual(nightStatus(HOUSES, booked, '2026-01-10'), [
    { id: 'a', label: '1호실', free: false },
    { id: 'b', label: '2호실', free: true },
  ]);
  // 퇴실일은 두 집 다 비어 있다
  assert.deepEqual(nightStatus(HOUSES, booked, '2026-01-12').map((h) => h.free), [true, true]);
});

// ---- 요청 조립 ----

const REMOTE = { enabled: true, url: 'https://demo.supabase.co', anonKey: 'anon-key' };

test('조회 요청에 apikey와 Authorization이 함께 실린다', () => {
  const { url, options } = buildRequest(REMOTE, { path: '/rest/v1/public_calendar?select=house' });
  assert.equal(url, 'https://demo.supabase.co/rest/v1/public_calendar?select=house');
  assert.equal(options.method, 'GET');
  assert.equal(options.headers.apikey, 'anon-key');
  assert.equal(options.headers.Authorization, 'Bearer anon-key');
  assert.equal(options.body, undefined);
});

test('본문이 있으면 Content-Type이 붙고 JSON으로 직렬화된다', () => {
  const { options } = buildRequest(REMOTE, {
    path: '/rest/v1/reservations', method: 'POST', body: { house: 'a' },
  });
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.equal(options.body, '{"house":"a"}');
});

test('minimal이면 반환을 끈다', () => {
  // 익명 키에는 reservations 조회 권한이 없다. 삽입 결과를 돌려받으려 하면
  // 권한 오류가 나므로 반환을 꺼야 한다.
  const { options } = buildRequest(REMOTE, {
    path: '/rest/v1/reservations', method: 'POST', body: {}, minimal: true,
  });
  assert.equal(options.headers.Prefer, 'return=minimal');
});

test('minimal이 아니면 Prefer를 붙이지 않는다', () => {
  const { options } = buildRequest(REMOTE, { path: '/rest/v1/public_calendar' });
  assert.equal(options.headers.Prefer, undefined);
});

test('로그인한 관리사무소는 자기 토큰으로 요청한다', () => {
  const { options } = buildRequest(REMOTE, { path: '/rest/v1/reservations', accessToken: 'staff-token' });
  assert.equal(options.headers.apikey, 'anon-key');        // apikey는 늘 익명 키
  assert.equal(options.headers.Authorization, 'Bearer staff-token');
});

test('secret은 매번 다르고 충분히 길다', () => {
  const a = makeSecret();
  const b = makeSecret();
  assert.notEqual(a, b);
  assert.equal(a.length, 32);
  assert.match(a, /^[0-9a-f]+$/);
});

// ---- 이용 이력 ----

// 테스트용 예약 목록. 날짜는 고정값이라 오늘이 언제든 결과가 같다.
const HISTORY = [
  { id: '1', house: 'a', check_in: '2026-01-05', check_out: '2026-01-06', name: '홍길동', unit_dong: '101', unit_ho: '1201', status: 'confirmed' },
  { id: '2', house: 'b', check_in: '2026-03-10', check_out: '2026-03-12', name: '홍길동', unit_dong: '101', unit_ho: '1201', status: 'confirmed' },
  { id: '3', house: 'a', check_in: '2025-12-20', check_out: '2025-12-22', name: '홍길동', unit_dong: '101', unit_ho: '1201', status: 'cancelled' },
  { id: '4', house: 'a', check_in: '2026-02-01', check_out: '2026-02-02', name: '김철수', unit_dong: '102', unit_ho: '303', status: 'confirmed' },
];

test('findByHousehold는 그 세대만 최신순으로 준다', () => {
  const rows = findByHousehold(HISTORY, '101', '1201');
  assert.deepEqual(rows.map((r) => r.id), ['2', '1', '3']);
});

test('findByHousehold는 취소된 예약도 포함한다', () => {
  // 이력이므로 취소도 보여준다. 요약(summarize)에서만 뺀다.
  const rows = findByHousehold(HISTORY, '101', '1201');
  assert.ok(rows.some((r) => r.status === 'cancelled'));
});

test('findByHousehold는 동과 호가 모두 맞아야 찾는다', () => {
  assert.deepEqual(findByHousehold(HISTORY, '101', '303'), []);
  assert.deepEqual(findByHousehold(HISTORY, '102', '303').map((r) => r.id), ['4']);
});

test('findByHousehold는 앞뒤 공백을 견딘다', () => {
  // 관리사무소가 ' 101 '처럼 입력할 수 있다.
  assert.equal(findByHousehold(HISTORY, ' 101 ', ' 1201 ').length, 3);
});

test('findByName은 부분 일치로 찾는다', () => {
  assert.deepEqual(findByName(HISTORY, '홍').map((r) => r.id), ['2', '1', '3']);
  assert.deepEqual(findByName(HISTORY, '철수').map((r) => r.id), ['4']);
});

test('findByName은 빈 검색어에 빈 결과를 준다', () => {
  // 빈 문자열이 모든 이름에 포함되므로, 그냥 두면 전체가 나온다.
  assert.deepEqual(findByName(HISTORY, ''), []);
  assert.deepEqual(findByName(HISTORY, '   '), []);
});

test('summarize는 최근 N개월의 횟수와 박수를 센다', () => {
  // 기준 2026-03-31에서 6개월 = 2025-09-30 이후.
  // 대상: 1(1박), 2(2박). 3은 취소라 제외.
  const now = new Date(2026, 2, 31);
  assert.deepEqual(summarize(findByHousehold(HISTORY, '101', '1201'), 6, now), { count: 2, nights: 3 });
});

test('summarize는 취소된 예약을 세지 않는다', () => {
  const only = [{ check_in: '2026-03-10', check_out: '2026-03-12', status: 'cancelled' }];
  assert.deepEqual(summarize(only, 6, new Date(2026, 2, 31)), { count: 0, nights: 0 });
});

test('summarize의 기간 경계', () => {
  const now = new Date(2026, 5, 15); // 2026-06-15, 6개월 전 = 2025-12-15
  const rows = [
    { check_in: '2025-12-15', check_out: '2025-12-16', status: 'confirmed' }, // 경계 당일: 포함
    { check_in: '2025-12-14', check_out: '2025-12-15', status: 'confirmed' }, // 하루 전: 제외
  ];
  assert.deepEqual(summarize(rows, 6, now), { count: 1, nights: 1 });
});

test('summarize는 빈 목록에 0을 준다', () => {
  assert.deepEqual(summarize([], 6, new Date(2026, 2, 31)), { count: 0, nights: 0 });
});

// ---- 월별 그리드 ----

test('monthGrid는 점유한 밤에만 예약을 넣는다', () => {
  const grid = monthGrid([
    { id: '1', check_in: '2026-03-10', check_out: '2026-03-12', status: 'confirmed' },
  ], 2026, 2); // 2 = 3월

  assert.deepEqual(grid.get('2026-03-10').map((r) => r.id), ['1']);
  assert.deepEqual(grid.get('2026-03-11').map((r) => r.id), ['1']);
  // 퇴실일은 다음 손님이 쓸 수 있으므로 비어 있어야 한다.
  assert.equal(grid.get('2026-03-12'), undefined);
});

test('monthGrid는 다른 달의 밤을 넣지 않는다', () => {
  // 1/31 입실 2/2 퇴실 = 1/31, 2/1 점유
  const rows = [{ id: '1', check_in: '2026-01-31', check_out: '2026-02-02', status: 'confirmed' }];

  const jan = monthGrid(rows, 2026, 0);
  assert.deepEqual([...jan.keys()], ['2026-01-31']);

  const feb = monthGrid(rows, 2026, 1);
  assert.deepEqual([...feb.keys()], ['2026-02-01']);
});

test('monthGrid는 같은 날 두 집을 함께 담는다', () => {
  const grid = monthGrid([
    { id: '1', house: 'a', check_in: '2026-03-10', check_out: '2026-03-11', status: 'confirmed' },
    { id: '2', house: 'b', check_in: '2026-03-10', check_out: '2026-03-11', status: 'pending' },
  ], 2026, 2);
  assert.deepEqual(grid.get('2026-03-10').map((r) => r.id).sort(), ['1', '2']);
});

test('monthGrid는 취소된 예약을 넣지 않는다', () => {
  const grid = monthGrid([
    { id: '1', check_in: '2026-03-10', check_out: '2026-03-11', status: 'cancelled' },
  ], 2026, 2);
  assert.equal(grid.size, 0);
});

test('monthGrid는 예약이 없으면 빈 Map', () => {
  assert.equal(monthGrid([], 2026, 2).size, 0);
  assert.equal(monthGrid(null, 2026, 2).size, 0);
});
