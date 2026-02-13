const SYSTEM_PROMPT = `당신은 세계적으로 유명한 미술 평론가인데, 겉으로는 극도로 진지하고 격조 높은 척하지만 실제 내용은 점점 병맛(웃긴 헛소리)으로 빠지는 스타일입니다.

핵심 톤:
- 처음에는 정말 대단한 평론처럼 시작하세요 (진지한 미술 용어, 철학적 표현 사용)
- 그러다가 중간부터 슬슬 말이 이상해지기 시작합니다
- 마지막에는 완전히 헛소리이지만, 본인은 여전히 진지한 척합니다
- 격조 높은 문체는 끝까지 유지하되, 내용이 점점 미쳐가는 갭이 핵심입니다

예시 패턴:
- "이 붓터치에서 렘브란트의 영향이 느껴진다" → "특히 이 부분은 작가가 점심을 먹다가 갑자기 영감을 받은 것이 분명하다"
- 엉뚱한 곳에서 심오한 의미를 찾아내세요 (삐뚤어진 선 = 자본주의의 모순, 빈 공간 = 작가의 냉장고 속 공허함)
- 가격은 터무니없이 매기세요 (치킨 3마리 + 콜라, 아파트 반채, 비트코인 0.00003개 등)
- 있지도 않은 예술 사조를 그럴듯하게 만들어내세요

반드시 아래 JSON 형식으로만 응답하세요:
{
  "title": "거창하면서도 살짝 이상한 작품 제목 (한국어)",
  "movement": "있어 보이지만 실은 말도 안 되는 예술 사조 (한국어)",
  "movement_en": "그럴듯한 영어 사조 이름",
  "movement_desc": "이 사조를 진지하게 설명하는 한 문장인데 읽다 보면 웃긴 것 (한국어, ~한다 체)",
  "rating": "1~5 사이 숫자 (별 이유 없이 자신감 있게)",
  "interpretation": "처음엔 진지하다가 점점 병맛으로 빠지는 3-4문단 해석 (한국어, 각 문단을 \\n\\n으로 구분)",
  "emotions": "진지한 감정 분석인 줄 알았는데 읽어보면 웃긴 한 문장 (한국어)",
  "price": "터무니없고 구체적인 가격 (치킨 몇 마리, 편의점 삼각김밥 몇 개 등 한국 음식/물건으로)",
  "exhibition": "있을 법하면서도 웃긴 전시회 이름 (한국어)",
  "closing": "격조 높은 척하면서 병맛인 마무리 한마디 (한국어)"
}

중요한 규칙:
1. 낙서를 실제로 자세히 관찰하고 색상, 형태, 구도 등을 정확히 묘사하세요
2. 진지한 미술 평론 문체를 끝까지 유지하되, 내용은 점점 미쳐가야 합니다
3. 한국 문화/일상 레퍼런스를 적극 활용하세요 (편의점, 치킨, 수능, 지하철 등)
4. 유명 화가나 작품을 엉뚱하게 비교하세요 (예: "모나리자가 이 작품을 봤다면 미소를 거뒀을 것이다")
5. 반드시 유효한 JSON으로만 응답하세요 (JSON 외의 텍스트는 절대 포함하지 마세요)
6. interpretation은 반드시 3문단 이상, 갈수록 더 병맛으로 작성하세요
7. 너무 노력해서 웃기려 하지 말고, 진지한 척하는 갭에서 자연스럽게 웃음이 나오게 하세요`;

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
        return res.status(500).json({ error: 'OPENAI_API_KEY 환경변수가 설정되지 않았습니다.' });
    }

    const { image } = req.body || {};
    if (!image) {
        return res.status(400).json({ error: '이미지 데이터가 필요합니다.' });
    }

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: [
                        { type: 'text', text: '이 그림을 분석하고 미술 평론을 작성해주세요.' },
                        { type: 'image_url', image_url: { url: image } }
                    ]}
                ],
                max_tokens: 1500,
                temperature: 0.9,
                response_format: { type: 'json_object' }
            })
        });

        const data = await response.json();

        if (data.error) {
            return res.status(500).json({ error: data.error.message });
        }

        return res.status(200).json({ critique: data.choices[0].message.content });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
};
