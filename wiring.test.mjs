// HTML에 id가 붙은 버튼이 실제로 리스너에 연결됐는지 정적으로 확인한다.
//
// 예약 신청 버튼에 클릭 리스너를 붙이지 않아 눌러도 아무 일도 일어나지 않는
// 사고가 있었다. 함수는 멀쩡히 있었고 구문 오류도 없어서 테스트가 전부 통과했다.
// 브라우저 동작은 node로 검증할 수 없지만 "만들어놓고 연결을 잊은 것"은 잡을 수 있다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 이 목록의 화면만 검사한다. 기존 화면(index/draw/admin)은 이벤트 위임을 쓰는
// 곳이 있어 이 단순한 규칙으로는 오탐이 난다.
const PAGES = ['reserve.html', 'manage.html'];

function read(name) {
  return readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
}

// <button ... id="X" ...> 에서 X를 모은다.
function buttonIds(html) {
  const ids = [];
  const re = /<button\b[^>]*\bid="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) ids.push(m[1]);
  return ids;
}

// $('X').addEventListener( 형태로 연결된 id를 모은다.
function wiredIds(html) {
  const ids = new Set();
  const re = /\$\('([^']+)'\)\.addEventListener\(/g;
  let m;
  while ((m = re.exec(html)) !== null) ids.add(m[1]);
  return ids;
}

for (const page of PAGES) {
  test(`${page}: id가 붙은 모든 버튼이 리스너에 연결되어 있다`, () => {
    const html = read(page);
    const buttons = buttonIds(html);
    const wired = wiredIds(html);

    assert.ok(buttons.length > 0, `${page}에서 id 붙은 버튼을 하나도 못 찾았다 (정규식 확인 필요)`);

    const missing = buttons.filter((id) => !wired.has(id));
    assert.deepEqual(missing, [], `리스너가 없는 버튼: ${missing.join(', ')}`);
  });

  test(`${page}: 리스너를 붙인 id가 실제로 존재한다`, () => {
    // 오타로 없는 id에 리스너를 붙이면 런타임에 조용히 죽는다.
    const html = read(page);
    const missing = [...wiredIds(html)].filter((id) => !html.includes(`id="${id}"`));
    assert.deepEqual(missing, [], `HTML에 없는 id에 리스너를 붙였다: ${missing.join(', ')}`);
  });
}
