export const palette = {
  paper: '#f6f1e8',
  ink: '#111111',
  red: '#ef3e36',
  blue: '#2457ff',
  teal: '#0c8f7f',
  gold: '#ffb100',
  slate: '#425067',
  cream: '#fff9ef',
};

export const issues = [
  {
    rank: '01',
    category: 'AI·과학',
    accent: palette.red,
    kicker: '인간 vs AI',
    titleLines: ['신진서,', '현존 최강 바둑 AI', '꺾었다'],
    body:
      '신진서 9단이 최강 바둑 AI를 상대로 승리했습니다. "전략이 있는 한 인간은 쉽게 지지 않는다"는 경기 후 발언이 화제입니다.',
  },
  {
    rank: '02',
    category: '사건',
    accent: palette.blue,
    kicker: '현장 충격',
    titleLines: ['압구정 아파트 화재,', '원인은', '로봇청소기'],
    body:
      '압구정 한양아파트에서 중국산 로봇청소기 발화로 불이 났습니다. 외국인 주민이 "배큠! 배큠!"을 외쳤다는 목격담이 확산 중입니다.',
  },
  {
    rank: '03',
    category: '국제',
    accent: palette.teal,
    kicker: '해상 리스크',
    titleLines: ['후티,', '해상봉쇄', '선언'],
    body:
      '예멘 후티 반군이 사우디 항구를 이용하는 선박도 표적이 될 것이라 경고했습니다. 글로벌 물류 불안이 커지고 있습니다.',
  },
  {
    rank: '04',
    category: '경제',
    accent: palette.gold,
    kicker: '정책 발언',
    titleLines: ['대통령 "부동산 불로소득,', '국민통합 저해', '주범"'],
    body:
      '이재명 대통령이 부동산 불로소득을 강하게 비판하며 주택 공급에 속도를 내겠다고 밝혔습니다.',
  },
  {
    rank: '05',
    category: '정치',
    accent: palette.slate,
    kicker: '법원 생중계',
    titleLines: ['오세훈', '시장직 걸린', '1심 선고'],
    body:
      "'여론조사 대납 혐의' 1심 선고를 법원이 생중계로 허가했습니다. 서울시장직의 향방이 걸려 있습니다.",
  },
];

export const coverDuration = 90;
export const issueDuration = 114;
export const outroDuration = 84;
