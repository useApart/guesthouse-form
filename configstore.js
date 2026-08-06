// 설정의 원본은 Supabase의 app_config 한 행이다. 이 파일은 그 행을 읽고 쓰는
// 방법만 안다 — 설정의 '의미'(기본값·검증·정규화)는 config.js가 맡는다.
//
// reservations.js와 같은 구조를 쓴다: 조립은 순수 함수로 빼서 테스트로 고정하고,
// 네트워크를 타는 부분은 request에 맡긴다.
import { buildRequest, request } from './reservations.js';

const ROW = '/rest/v1/app_config?id=eq.1';

function usable(reservation) {
  return Boolean(reservation && reservation.enabled);
}

export function buildLoadConfigRequest(reservation) {
  if (!usable(reservation)) return null;
  return buildRequest(reservation, { path: `${ROW}&select=config` });
}

export function buildSaveConfigRequest(reservation, accessToken, config) {
  if (!usable(reservation)) return null;
  // 로그인하지 않았으면 서버도 거부한다. 오지 않을 요청을 보낼 이유가 없다.
  if (!accessToken) return null;
  // 빈 설정이 저장되면 동기화가 그것을 커밋해 사이트가 통째로 기본값으로 떨어진다.
  if (!config || typeof config !== 'object' || Object.keys(config).length === 0) return null;

  return buildRequest(reservation, {
    path: ROW,
    method: 'PATCH',
    body: { config },
    accessToken,
    minimal: true,
  });
}

// 없으면 null. 부르는 쪽이 정적 config.json으로 물러선다.
export function loadStoredConfig(reservation) {
  if (!usable(reservation)) return Promise.resolve(null);
  return request(reservation, { path: `${ROW}&select=config` })
    .then((rows) => (rows && rows[0] ? rows[0].config : null));
}

// 실패하면 error.status가 붙은 Error로 reject한다. 401이면 부르는 쪽이 다시
// 로그인시켜야 한다.
export function saveStoredConfig(reservation, accessToken, config) {
  if (!buildSaveConfigRequest(reservation, accessToken, config)) {
    return Promise.reject(new Error('저장할 수 없는 상태입니다.'));
  }
  return request(reservation, {
    path: ROW,
    method: 'PATCH',
    body: { config },
    accessToken,
    minimal: true,
  });
}
