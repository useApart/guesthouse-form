// 어제 만들어진 신청서 건수를 텔레그램으로 보낸다. GitHub Actions가 매일 부른다.
//
// 봇 토큰은 Actions Secrets에만 있다. 브라우저에 들어가면 누구나 그 토큰으로
// 채팅방에 아무 메시지나 보낼 수 있으므로 발송은 반드시 이쪽에서 한다.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// ---- 순수 함수 (테스트 대상) ----

// 한국 시간 기준 '어제'. 러너는 UTC로 도므로 new Date()를 그대로 쓰면
// 한국 아침 7시에 하루가 밀린다.
export function seoulYesterday(now) {
  const KST = 9 * 60 * 60 * 1000;
  const DAY = 24 * 60 * 60 * 1000;
  return new Date(now.getTime() + KST - DAY).toISOString().slice(0, 10);
}

// row는 get_usage의 첫 행. 그날 기록이 없으면 undefined다.
export function formatMessage(day, row) {
  const typed = row ? row.typed : 0;
  const hand = row ? row.hand : 0;
  const total = typed + hand;

  const [, month, date] = day.split('-');
  const head = `📋 ${Number(month)}월 ${Number(date)}일 신청서 ${total}건`;

  // 0건이어도 보낸다. 안 오면 시스템이 고장 난 것으로 읽을 수 있다.
  if (total === 0) return head;
  return `${head}\n   타이핑 ${typed} · 손글씨 ${hand}`;
}

// ---- 아래는 네트워크를 타므로 자동 테스트하지 않는다 ----

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error('TELEGRAM_BOT_TOKEN과 TELEGRAM_CHAT_ID가 필요합니다.');
  }

  // Supabase 주소는 config.json 하나만 본다. 여기에 또 적어두면 프로젝트를
  // 옮길 때 한쪽만 고치고 끝나는 사고가 난다.
  const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
  const { url, anonKey } = config.reservation || {};
  if (!url || !anonKey) {
    throw new Error('config.json에 reservation.url·anonKey가 없습니다.');
  }

  const day = seoulYesterday(new Date());

  const res = await fetch(`${url}/rest/v1/rpc/get_usage`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_day: day }),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);

  const rows = await res.json();
  const text = formatMessage(day, rows[0]);

  // 토큰이 URL에 들어가므로 이 주소는 절대 로그에 찍지 않는다.
  const sent = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  // 조용히 성공한 척하면 워크플로는 초록불인데 알림은 안 오는 상태를 못 알아챈다.
  if (!sent.ok) throw new Error(`Telegram ${sent.status}: ${await sent.text()}`);

  console.log(`보냈습니다 (${day}): ${text.split('\n')[0]}`);
}

// 테스트가 import 할 때는 main()이 돌면 안 된다. 직접 실행할 때만 돈다.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
