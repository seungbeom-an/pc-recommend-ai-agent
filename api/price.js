export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();
 
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });
 
  const results = {};
 
  // ── 1. 네이버 쇼핑 API ──
  try {
    const naverId = process.env.NAVER_CLIENT_ID;
    const naverSecret = process.env.NAVER_CLIENT_SECRET;
    if (naverId && naverSecret) {
      const encoded = encodeURIComponent(query);
      const naverRes = await fetch(
        `https://openapi.naver.com/v1/search/shop.json?query=${encoded}&display=5&sort=asc`,
        {
          headers: {
            'X-Naver-Client-Id': naverId,
            'X-Naver-Client-Secret': naverSecret,
          }
        }
      );
      if (naverRes.ok) {
        const data = await naverRes.json();
        const items = (data.items || []).filter(i => {
          const title = i.title.replace(/<[^>]+>/g, '').toLowerCase();
          const q = query.toLowerCase();
          // 쿼리 키워드 절반 이상 포함 여부 확인
          const words = q.split(' ').filter(w => w.length > 1);
          const matches = words.filter(w => title.includes(w));
          return matches.length >= Math.ceil(words.length * 0.5);
        });
        if (items.length > 0) {
          const prices = items.map(i => parseInt(i.lprice)).filter(p => p > 0);
          const minPrice = Math.min(...prices);
          const avgPrice = Math.round(prices.reduce((a,b)=>a+b,0)/prices.length);
          results.naver = {
            min: minPrice,
            avg: avgPrice,
            count: items.length,
            title: items[0].title.replace(/<[^>]+>/g, ''),
            link: items[0].link,
            source: '네이버쇼핑',
          };
        }
      }
    }
  } catch(e) {
    results.naver_error = e.message;
  }
 
  // ── 2. 다나와 서버사이드 크롤링 ──
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://search.danawa.com/dsearch.php?query=${encoded}&tab=main&volumeType=allvs&page=1&limit=5&sort=saveprice&depth=1&device=pc&recommend=Y&seniorYN=N&request=Y`;
    const danawaRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Referer': 'https://www.danawa.com/',
      }
    });
    if (danawaRes.ok) {
      const html = await danawaRes.text();
      // 다나와 가격 패턴 추출
      const priceMatches = html.match(/class="[^"]*price_sect[^"]*"[^>]*>[\s\S]*?<strong[^>]*>([\d,]+)<\/strong>/g) || [];
      const prices = priceMatches
        .map(m => { const n = m.match(/<strong[^>]*>([\d,]+)<\/strong>/); return n ? parseInt(n[1].replace(/,/g,'')) : 0; })
        .filter(p => p > 10000 && p < 100000000);
      
      if (prices.length > 0) {
        results.danawa = {
          min: Math.min(...prices),
          avg: Math.round(prices.reduce((a,b)=>a+b,0)/prices.length),
          count: prices.length,
          source: '다나와',
          link: `https://search.danawa.com/dsearch.php?query=${encoded}&sort=saveprice`,
        };
      }
    }
  } catch(e) {
    results.danawa_error = e.message;
  }
 
  // ── 최종 가격 결정 (네이버 우선, 없으면 다나와) ──
  const best = results.naver || results.danawa || null;
  
  return res.status(200).json({
    query,
    price: best ? best.min : null,
    avg: best ? best.avg : null,
    source: best ? best.source : null,
    link: best ? best.link : null,
    details: results,
  });
}
