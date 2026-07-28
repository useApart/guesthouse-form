// GitHub Contents API 래퍼. 서버가 없으므로 관리자 페이지가 브라우저에서
// 저장소에 직접 커밋한다.

// btoa/atob는 바이트 단위로만 동작한다. 한글이 들어간 설정을 그대로 넣으면
// InvalidCharacterError가 나므로 UTF-8 바이트로 바꾼 뒤 인코딩한다.
export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// GitHub API는 base64를 일정 길이마다 줄바꿈해 돌려준다. 공백을 모두 제거해야 한다.
export function fromBase64(b64) {
  const binary = atob(String(b64).replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function pad2(n) { return String(n).padStart(2, '0'); }

// toISOString()은 UTC로 바꿔버려 시각이 어긋난다. 로컬 값을 그대로 조립한다.
function parts(date) {
  return {
    y: date.getFullYear(),
    m: pad2(date.getMonth() + 1),
    d: pad2(date.getDate()),
    hh: pad2(date.getHours()),
    mm: pad2(date.getMinutes()),
  };
}

export function commitMessage(now = new Date()) {
  const t = parts(now);
  return `chore: 관리자 설정 변경 (${t.y}-${t.m}-${t.d} ${t.hh}:${t.mm})`;
}

// 같은 이름으로 덮어쓰면 브라우저·CDN 캐시가 옛 이미지를 계속 보여주고,
// 되돌리기를 해도 이미지는 돌아오지 않는다. 매번 새 이름을 쓴다.
export function imageFileName(now = new Date(), ext = 'jpg') {
  const t = parts(now);
  return `form-${t.y}${t.m}${t.d}-${t.hh}${t.mm}.${ext}`;
}

const API = 'https://api.github.com';

export function createClient({ repo, token, branch = 'main' }) {
  function request(path, options = {}) {
    return fetch(`${API}${path}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    }).then((res) => {
      // 404는 오류가 아니라 "아직 없다"는 뜻이다. 최초 저장을 구분하는 데 쓴다.
      if (res.status === 404) return null;
      if (!res.ok) {
        return res.json().catch(() => ({})).then((body) => {
          const error = new Error(body.message || `GitHub ${res.status}`);
          error.status = res.status;
          throw error;
        });
      }
      return res.json();
    });
  }

  return {
    getFile(path) {
      return request(`/repos/${repo}/contents/${path}?ref=${branch}`).then((data) =>
        data ? { text: fromBase64(data.content), sha: data.sha } : null
      );
    },

    // sha를 함께 보내면 GitHub이 충돌을 409로 막아준다. 조용히 덮어쓰지 않는다.
    putFile({ path, content, sha, message }) {
      return request(`/repos/${repo}/contents/${path}`, {
        method: 'PUT',
        body: JSON.stringify({ message, content, branch, ...(sha ? { sha } : {}) }),
      });
    },

    listCommits(path, perPage = 10) {
      return request(`/repos/${repo}/commits?path=${path}&sha=${branch}&per_page=${perPage}`)
        .then((list) => (list || []).map((c) => ({
          sha: c.sha,
          date: c.commit.author.date,
          message: c.commit.message.split('\n')[0],
        })));
    },

    getCommitContent(path, sha) {
      return request(`/repos/${repo}/contents/${path}?ref=${sha}`).then((data) =>
        data ? fromBase64(data.content) : null
      );
    },
  };
}
