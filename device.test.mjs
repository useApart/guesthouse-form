import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMobileDevice } from './device.js';

// 이 함수가 생긴 이유가 곧 이 테스트의 핵심이다.
// 예전에는 navigator.canShare({files})로 "폰인가"를 물었는데, 그건 "공유가 되는가"일
// 뿐이다. Windows의 Chrome·Edge도 파일 공유를 지원해서 PC가 폰 취급을 받았고,
// "이미지 저장"이 다운로드 대신 공유 대화상자를 열었다.

test('Chromium이 폰이라고 하면 폰이다', () => {
  assert.equal(isMobileDevice({ mobile: true }, false), true);
});

test('Chromium이 폰이 아니라고 하면 PC다 — 포인터가 뭐라 하든', () => {
  // 이번 버그의 핵심 케이스. Windows 11 + Chrome/Edge가 여기 해당한다.
  // 터치스크린 노트북이라 coarse가 나와도 userAgentData를 믿는다.
  assert.equal(isMobileDevice({ mobile: false }, false), false);
  assert.equal(isMobileDevice({ mobile: false }, true), false);
});

test('userAgentData가 없으면 주 포인터로 판별한다', () => {
  // Firefox·Safari에는 userAgentData가 없다.
  assert.equal(isMobileDevice(undefined, true), true);   // iOS 사파리
  assert.equal(isMobileDevice(undefined, false), false); // 데스크톱 파이어폭스
});

test('userAgentData가 mobile을 안 주면 포인터로 넘어간다', () => {
  // 일부 브라우저는 userAgentData를 주면서 mobile은 비워둔다.
  assert.equal(isMobileDevice({}, true), true);
  assert.equal(isMobileDevice({ mobile: 'yes' }, false), false);
});

test('아무것도 모르면 PC로 본다', () => {
  // 판별에 실패했을 때 다운로드는 어디서나 최소한 동작한다. 반대로 공유 시트는
  // 아예 없을 수도 있어서, 모르면 다운로드 쪽으로 기우는 것이 안전하다.
  assert.equal(isMobileDevice(undefined, undefined), false);
  assert.equal(isMobileDevice(null, null), false);
});
