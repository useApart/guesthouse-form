// 신청서 이미지가 몇 건 만들어졌는지만 센다.
// 이름·동호수 같은 개인정보는 보내지 않는다 — 보내는 값은 아래 두 문자열뿐이다.
//
// reservations.js와 같은 구조를 쓴다: 조립은 순수 함수로 빼서 테스트로 고정하고,
// fetch 한 줄만 테스트 밖에 남긴다.
import { buildRequest } from './reservations.js';

const SOURCES = ['typed', 'hand'];

// 보낼 수 없는 상태면 null. 부르는 쪽은 조용히 넘어간다.
export function buildBumpRequest(reservation, source) {
  if (!reservation || !reservation.enabled) return null;
  if (!SOURCES.includes(source)) return null;

  return buildRequest(reservation, {
    path: '/rest/v1/rpc/bump_usage',
    method: 'POST',
    body: { p_source: source },
    minimal: true,
  });
}

// 집계는 신청서를 만드는 흐름의 곁다리다. 네트워크가 죽어 있어도 주민은
// 아무 차이를 느끼지 않아야 하므로 실패를 삼키고 절대 reject 하지 않는다.
export function bumpUsage(reservation, source) {
  const req = buildBumpRequest(reservation, source);
  if (!req) return Promise.resolve();
  return fetch(req.url, req.options).then(() => {}, () => {});
}
