import React from 'react';

// 숫자 토큰(아라비아 숫자 + 내부 구분자 `.`·`,`·`:` + 바로 뒤에 붙는 단위 접미사)이
// 줄바꿈으로 끊기지 않게 감싼다. 예: "100.01달러", "7.19%", "4,000만", "329만원", "813㎜", "2027년".
// 브라우저는 wordBreak: 'keep-all'에서도 마침표 뒤를 줄바꿈 기회로 보기 때문에
// (예: "100." / "01달러"로 분리) 렌더 단계에서 숫자 토큰을 whiteSpace: 'nowrap'으로 강제 고정한다.
//
// 토큰 경계는 공백 기준으로 보수적으로 잡는다: 숫자로 시작하는 공백 분절 전체
// (숫자 + 뒤따르는 비공백 문자열 — 단위·조사 포함)를 하나로 묶는다.
// 공백·한글 조사 이후 등 자연 분절은 그대로 유지되므로 레이아웃을 해치지 않는다.
export const nowrapNumbers = (text) => {
  const str = String(text ?? '');
  // 공백을 캡처 그룹으로 분리 보존 — split(/(\s+)/)은 공백 자체도 배열 원소로 남긴다.
  const parts = str.split(/(\s+)/);
  return parts.map((part, index) =>
    /^\d/.test(part) ? (
      <span key={index} style={{whiteSpace: 'nowrap'}}>
        {part}
      </span>
    ) : (
      part
    )
  );
};
