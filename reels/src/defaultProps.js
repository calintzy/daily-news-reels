// Remotion Studio 프리뷰용 기본 inputProps.
// 실제 렌더는 scripts/render.mjs가 data/DATE.json을 inputProps로 주입한다.
// 이 값은 스튜디오에서 컴포지션을 열었을 때 보이는 샘플일 뿐이다.
export const defaultInputProps = {
  date: '2026-07-21',
  todayOneLiner: '지금 대한민국이 주목하는 다섯 가지 소식을 1분에 정리해 드립니다.',
  imageDir: 'img/current',
  issues: [
    {rank: 1, category: 'AI·과학', kicker: '인간 vs AI', title: '신진서, 현존 최강 바둑 AI 꺾었다', summary: '신진서 9단이 현존 최강으로 꼽히는 바둑 AI를 상대로 승리했습니다. 경기 후 인터뷰가 온라인에서 화제가 되고 있습니다.'},
    {rank: 2, category: '사건', kicker: '현장 충격', title: '압구정 아파트 화재, 원인은 로봇청소기', summary: '압구정의 한 아파트에서 로봇청소기 발화로 화재가 발생했습니다. 당시 상황을 전한 주민 목격담이 확산되고 있습니다.'},
    {rank: 3, category: '국제', kicker: '해상 리스크', title: '후티, 해상봉쇄 선언', summary: '예멘 후티 반군이 해상봉쇄를 선언하며 특정 항구를 이용하는 선박도 표적이 될 수 있다고 경고했습니다. 글로벌 물류 불안이 커지고 있습니다.'},
    {rank: 4, category: '경제', kicker: '정책 발언', title: '대통령 부동산 불로소득 강하게 비판', summary: '대통령이 부동산 불로소득을 강하게 비판하며 주택 공급에 속도를 내겠다고 밝혔습니다. 관련 논의가 이어지고 있습니다.'},
    {rank: 5, category: '정치', kicker: '법원 생중계', title: '오세훈 시장직 걸린 1심 선고', summary: '오세훈 서울시장의 시장직이 걸린 1심 선고를 법원이 생중계로 허가했습니다. 서울시장직의 향방에 관심이 쏠리고 있습니다.'},
  ],
};
