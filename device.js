// "이 기기가 폰인가"를 판별한다.
//
// 왜 따로 두는가. 예전에는 `navigator.canShare({files})`로 이걸 대신 물었다.
// 그러나 그건 "공유가 되는가"이지 "폰인가"가 아니다 — Windows의 Chrome·Edge도
// 파일 공유를 지원한다. 그래서 PC가 폰 분기를 타서 "이미지 저장"이 다운로드
// 대신 공유 대화상자를 열었고, Windows 공유 대화상자에는 '파일로 저장'에
// 해당하는 항목이 없어 저장할 방법이 아예 사라졌다.
//
// 기기 종류를 알고 싶으면 기기 종류를 물어야 한다.

// 순수 함수. 브라우저 값을 인자로 받아 node로 검증할 수 있게 한다.
// uaData        - navigator.userAgentData (Chromium에만 있다)
// coarsePointer - matchMedia('(pointer: coarse)').matches
export function isMobileDevice(uaData, coarsePointer) {
  // Chromium이 직접 알려주면 그 말을 믿는다. 터치스크린 노트북처럼
  // 포인터만 보면 헷갈리는 기기도 여기서 정확히 갈린다.
  if (uaData && typeof uaData.mobile === 'boolean') return uaData.mobile;

  // Firefox·Safari에는 userAgentData가 없다. 주(主) 포인터로 판별한다.
  // any-pointer가 아니라 pointer를 쓰는 이유: 마우스가 달린 터치스크린
  // 노트북은 주 포인터가 fine이라 PC로 올바르게 분류된다.
  return coarsePointer === true;
}

// 브라우저에서 실제 값을 읽어 판별한다. 페이지마다 한 번만 부르면 된다.
export function detectMobile() {
  const coarse = typeof matchMedia === 'function'
    ? matchMedia('(pointer: coarse)').matches
    : undefined;
  return isMobileDevice(navigator.userAgentData, coarse);
}
