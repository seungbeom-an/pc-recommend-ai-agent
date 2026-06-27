export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { query, category } = req.body || {};
  if (!query) return res.status(400).json({ error: 'query required' });

  const naverId = process.env.NAVER_CLIENT_ID;
  const naverSecret = process.env.NAVER_CLIENT_SECRET;

  if (!naverId || !naverSecret) {
    return res.status(200).json({ 
      query, price: null, error: 'Naver API keys missing',
      debug: { hasId: !!naverId, hasSecret: !!naverSecret }
    });
  }

  // 핵심 모델명 추출
  function clean(q, cat) {
    if (cat === 'GPU') {
      // "NVIDIA GeForce RTX 4080 Super" → "RTX 4080 Super"
      const m = q.match(/(RTX|GTX|RX|Arc)\s*\d+\s*(?:\d+\s*)?(?:Ti\s*Super|Ti|Super|XT|XTX|GRE)?/i);
      return m ? m[0].replace(/\s+/g,' ').trim() : q;
    }
    if (cat === 'CPU') {
      // "AMD Ryzen 7 9800X3D" → "9800X3D" or "Ryzen 7 9800X3D"
      const m = q.match(/(?:Ryzen\s*[3579]\s*\d+\w*|Core\s*(?:i[3579]|Ultra\s*[579])\s*[-\w]+)/i);
      return m ? m[0].trim() : q;
    }
    if (cat === 'RAM') {
      const m = q.match(/DDR[45]\s*\d+\s*GB/i);
      return m ? m[0].trim() : q.split(' ').slice(0,3).join(' ');
    }
    if (cat === 'SSD') {
      // "Samsung 990 Pro 2TB NVMe" → "삼성 990 Pro 2TB" 
      return q.replace(/\b(NVMe|PCIe Gen\d?|M\.2)\b/gi,'').trim();
    }
    // 케이스/파워는 앞 3단어
    return q.split(' ').slice(0,4).join(' ');
  }

  // 카테고리별 현실 가격 범위 (원)
  const RANGES = {
    'CPU':  { min: 100000,  max: 2000000 },
    'GPU':  { min: 200000,  max: 6000000 },
    'RAM':  { min: 20000,   max: 400000  },
    'SSD':  { min: 30000,   max: 600000  },
    '케이스': { min: 30000, max: 500000  },
    '파워': { min: 30000,   max: 500000  },
  };
  const range = RANGES[category] || { min: 10000, max: 10000000 };
  const searchQ = clean(query, category);

  try {
    const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(searchQ)}&display=10&sort=asc`;
    const r = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': naverId,
        'X-Naver-Client-Secret': naverSecret,
      }
    });

    // 에러 응답 상세 로깅
    if (!r.ok) {
      const txt = await r.text();
      return res.status(200).json({ 
        query, searchQ, price: null, 
        error: `Naver ${r.status}`, detail: txt.slice(0,200)
      });
    }

    const data = await r.json();
    const items = data.items || [];

    if (items.length === 0) {
      return res.status(200).json({ query, searchQ, price: null, message: '검색 결과 없음' });
    }

    // 쿼리 키워드 매칭 필터
    const qWords = searchQ.toLowerCase().split(/\s+/).filter(w => w.length > 1);

    const scoreItem = (item) => {
      const t = item.title.replace(/<[^>]+>/g,'').toLowerCase();
      const p = parseInt(item.lprice);
      if (p < range.min || p > range.max) return -1;
      const hits = qWords.filter(w => t.includes(w));
      return hits.length / qWords.length;
    };

    const scored = items
      .map(i => ({ ...i, score: scoreItem(i), price: parseInt(i.lprice) }))
      .filter(i => i.score >= 0.5)
      .sort((a,b) => a.price - b.price);

    if (scored.length === 0) {
      // 완화: 가격 범위만 체크
      const byPrice = items
        .map(i => ({ ...i, price: parseInt(i.lprice) }))
        .filter(i => i.price >= range.min && i.price <= range.max)
        .sort((a,b) => a.price - b.price);

      if (byPrice.length === 0) {
        return res.status(200).json({ 
          query, searchQ, price: null, message: '가격 범위 내 제품 없음',
          rawPrices: items.slice(0,5).map(i=>({title:i.title.replace(/<[^>]+>/g,'').slice(0,30), p:i.lprice}))
        });
      }

      const min = byPrice[0].price;
      const valid = byPrice.filter(i => i.price <= min * 3);
      const avg = Math.round(valid.reduce((a,b)=>a+b.price,0)/valid.length);
      return res.status(200).json({
        query, searchQ, price: min, avg,
        source: '네이버쇼핑 (범위검색)',
        link: `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(searchQ)}&sort=price_asc`,
        title: byPrice[0].title.replace(/<[^>]+>/g,'').slice(0,50),
        count: valid.length,
      });
    }

    const min = scored[0].price;
    const valid = scored.filter(i => i.price <= min * 2.5);
    const avg = Math.round(valid.reduce((a,b)=>a+b.price,0)/valid.length);

    return res.status(200).json({
      query, searchQ, price: min, avg,
      source: '네이버쇼핑',
      link: `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(searchQ)}&sort=price_asc`,
      title: scored[0].title.replace(/<[^>]+>/g,'').slice(0,50),
      count: valid.length,
      top3: scored.slice(0,3).map(i=>({ 
        title: i.title.replace(/<[^>]+>/g,'').slice(0,40), 
        price: i.price 
      })),
    });

  } catch(e) {
    return res.status(200).json({ query, searchQ, price: null, error: e.message });
  }
}
