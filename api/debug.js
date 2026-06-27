export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const naverId = process.env.NAVER_CLIENT_ID;
  const naverSecret = process.env.NAVER_CLIENT_SECRET;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  const result = {
    env: {
      ANTHROPIC_API_KEY: anthropicKey ? `설정됨 (${anthropicKey.slice(0,10)}...)` : '❌ 없음',
      NAVER_CLIENT_ID: naverId ? `설정됨 (${naverId.slice(0,6)}...)` : '❌ 없음',
      NAVER_CLIENT_SECRET: naverSecret ? `설정됨 (${naverSecret.slice(0,6)}...)` : '❌ 없음',
    }
  };

  // Test Naver API live
  if (naverId && naverSecret) {
    try {
      const r = await fetch(
        'https://openapi.naver.com/v1/search/shop.json?query=RTX+4070&display=3&sort=asc',
        { headers: { 'X-Naver-Client-Id': naverId, 'X-Naver-Client-Secret': naverSecret } }
      );
      const data = await r.json();
      result.naver_test = {
        status: r.status,
        ok: r.ok,
        items: (data.items || []).slice(0,2).map(i=>({
          title: i.title.replace(/<[^>]+>/g,'').slice(0,40),
          price: i.lprice
        })),
        error: data.errorMessage
      };
    } catch(e) {
      result.naver_test = { error: e.message };
    }
  }

  res.status(200).json(result);
}
