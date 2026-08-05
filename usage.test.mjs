import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBumpRequest } from './usage.js';

const RES = { enabled: true, url: 'https://x.supabase.co', anonKey: 'KEY' };

test('타이핑 화면의 집계는 bump_usage RPC로 간다', () => {
  const { url, options } = buildBumpRequest(RES, 'typed');
  assert.equal(url, 'https://x.supabase.co/rest/v1/rpc/bump_usage');
  assert.equal(options.method, 'POST');
  assert.deepEqual(JSON.parse(options.body), { p_source: 'typed' });
});

test('손글씨 화면은 p_source가 hand다', () => {
  const { options } = buildBumpRequest(RES, 'hand');
  assert.deepEqual(JSON.parse(options.body), { p_source: 'hand' });
});

test('익명 키가 헤더에 실리고 응답 본문은 받지 않는다', () => {
  const { options } = buildBumpRequest(RES, 'typed');
  assert.equal(options.headers.apikey, 'KEY');
  assert.equal(options.headers.Authorization, 'Bearer KEY');
  assert.equal(options.headers['Content-Type'], 'application/json');
  // 익명 키는 결과를 읽을 수 없다. 굳이 받아오지 않는다.
  assert.equal(options.headers.Prefer, 'return=minimal');
});

test('예약 기능이 꺼져 있으면 요청을 만들지 않는다', () => {
  // enabled는 url·anonKey가 둘 다 있을 때만 참이다(config.js).
  assert.equal(buildBumpRequest({ enabled: false, url: 'https://x', anonKey: 'K' }, 'typed'), null);
  assert.equal(buildBumpRequest(null, 'typed'), null);
  assert.equal(buildBumpRequest(undefined, 'typed'), null);
});

test('모르는 source는 보내지 않는다', () => {
  // 서버도 거부하지만 오지 않을 요청을 보낼 이유가 없다.
  assert.equal(buildBumpRequest(RES, 'admin'), null);
  assert.equal(buildBumpRequest(RES, ''), null);
  assert.equal(buildBumpRequest(RES, undefined), null);
});

import { readFileSync } from 'node:fs';

// 집계 호출은 실패해도 화면에 아무 표시가 안 난다. 연결을 빠뜨리면 조용히
// 숫자만 0으로 남으므로 wiring.test.mjs와 같은 방식으로 정적으로 잡는다.
const WIRED = [
  ['index.html', 'typed'],
  ['draw.html', 'hand'],
];

for (const [page, source] of WIRED) {
  test(`${page}: 이미지를 만드는 두 버튼 모두 집계를 부른다`, () => {
    const html = readFileSync(new URL(`./${page}`, import.meta.url), 'utf8');
    assert.match(html, /import \{ bumpUsage \} from '\.\/usage\.js';/);

    const re = new RegExp(`bumpUsage\\(config\\.reservation, '${source}'\\)`, 'g');
    const calls = html.match(re) || [];
    assert.equal(calls.length, 2, '"보내기"와 "저장" 두 곳에서 불러야 한다');
  });
}
