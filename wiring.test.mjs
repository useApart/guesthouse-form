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

// ---- hidden이 CSS에 지는 요소 ----
//
// hidden 속성을 붙였는데도 화면에 그대로 남는 사고가 세 번 났다(상단 탭, 상단
// 버튼, 예약 단계 표시줄). [hidden]의 display:none은 브라우저 기본 스타일이라
// .foo { display: flex } 같은 작성자 규칙에 진다. JS는 멀쩡히 hidden을 켜므로
// 코드만 읽어서는 보이지 않고, 화면을 직접 봐야 드러난다.
//
// 그래서 "JS가 hidden을 토글하는 요소"와 "그 클래스에 display가 선언됐는지"를
// 맞춰 본다. .foo[hidden]이나 .foo:not([hidden])으로 막아 두었으면 통과한다.
const HIDDEN_PAGES = ['index.html', 'draw.html', 'reserve.html', 'manage.html', 'admin.html'];

function styleBlock(html) {
  return (html.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];
}

// JS가 el.hidden = ... 로 여닫는 id를 모은다.
function toggledIds(html) {
  const ids = new Set();
  for (const m of html.matchAll(/\$\('([\w-]+)'\)\.hidden\s*=/g)) ids.add(m[1]);
  for (const m of html.matchAll(/getElementById\('([\w-]+)'\)\.hidden\s*=/g)) ids.add(m[1]);
  return [...ids];
}

function classesOf(html, id) {
  const tag = (html.match(new RegExp(`<[^>]*id="${id}"[^>]*>`)) || [''])[0];
  return ((tag.match(/class="([^"]*)"/) || ['', ''])[1] || '').split(/\s+/).filter(Boolean);
}

for (const page of HIDDEN_PAGES) {
  test(`${page}: hidden으로 여닫는 요소가 CSS의 display에 지지 않는다`, () => {
    const html = read(page);
    const css = styleBlock(html);
    const broken = [];

    for (const id of toggledIds(html)) {
      for (const cls of classesOf(html, id)) {
        // String.raw가 필요하다. 그냥 템플릿 리터럴에 쓰면 \s·\.가 s·.로 죽어
        // 엉뚱한 것을 찾는, 늘 통과하는 테스트가 된다.
        const declaresDisplay = new RegExp(
          String.raw`(^|[,}\s])\.${cls}\s*\{[^}]*display\s*:`, 'm'
        ).test(css);
        const guarded = new RegExp(
          String.raw`\.${cls}\[hidden\]|\.${cls}:not\(\[hidden\]\)`
        ).test(css);
        if (declaresDisplay && !guarded) broken.push(`#${id}(.${cls})`);
      }
    }

    assert.deepEqual(broken, [], `[hidden] 가드를 더해야 한다: ${broken.join(', ')}`);
  });
}
