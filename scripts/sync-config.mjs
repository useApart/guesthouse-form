// Supabase의 설정 원본을 읽어 저장소의 config.json으로 옮긴다.
// GitHub Actions가 주기적으로 부른다.
//
// 이 사본 덕분에 주민 화면은 Supabase를 전혀 몰라도 되고, Supabase가 죽어도
// 정상 동작한다. 사본이 아니라 '원래 경로'라는 점이 중요하다 — 평소에 안 쓰이는
// 폴백은 고장 나 있어도 아무도 모른다.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const CONFIG_PATH = new URL('../config.json', import.meta.url);

// ---- 순수 함수 (테스트 대상) ----

// 키 순서를 무시하고 비교하기 위해 재귀적으로 키를 정렬한다.
// 배열은 순서가 의미를 가지므로 정렬하지 않는다(fields 순서 = 화면 순서).
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
    return out;
  }
  return value;
}

export function sameConfig(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

// stored: app_config.config (객체). currentText: 저장소 config.json의 현재 내용.
// 같으면 null(쓰지 않음), 다르면 쓸 문자열.
export function nextConfigText(stored, currentText) {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored) || Object.keys(stored).length === 0) {
    throw new Error('저장된 설정이 비었거나 객체가 아닙니다. 커밋하지 않습니다.');
  }

  // admin.html이 지금까지 써 온 형식과 같아야 한다.
  const next = `${JSON.stringify(stored, null, 2)}\n`;

  let current = null;
  try { current = JSON.parse(currentText); } catch { return next; }
  return sameConfig(stored, current) ? null : next;
}

// ---- 아래는 네트워크·파일을 만지므로 자동 테스트하지 않는다 ----

async function main() {
  const local = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const { url, anonKey } = local.reservation || {};
  if (!url || !anonKey) throw new Error('config.json에 reservation.url·anonKey가 없습니다.');

  const res = await fetch(`${url}/rest/v1/app_config?id=eq.1&select=config`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);

  const rows = await res.json();
  const stored = rows && rows[0] ? rows[0].config : null;

  const text = nextConfigText(stored, readFileSync(CONFIG_PATH, 'utf8'));
  if (text === null) {
    console.log('바뀐 내용이 없습니다.');
    return;
  }

  writeFileSync(CONFIG_PATH, text);
  console.log('config.json을 갱신했습니다.');
}

// 테스트가 import 할 때는 main()이 돌면 안 된다. 직접 실행할 때만 돈다.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
