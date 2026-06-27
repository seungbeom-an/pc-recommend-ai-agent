export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { query, category } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });

  const naverId = process.env.NAVER_CLIENT_ID;
  const naverSecret = process.env.NAVER_CLIENT_SECRET;

  if (!naverId || !naverSecret) {
    return res.status(500).json({ error: 'Naver API keys not configured' });
  }

  // 카테고리별 가격 범위 및 키워드 필터 (엉뚱한 제품 제거)
  const FILTERS = {
    CPU:     { minPrice: 100000,  maxPrice: 2000000, mustInclude: [], categoryId: '840' },
    GPU:     { minPrice: 200000,  maxPrice: 5000000, mustInclude: [], categoryId: '849' },
    RAM:     { minPrice: 20000,   maxPrice: 500000,  mustInclude: ['ddr','gb'],  categoryId: '841' },
    SSD:     { minPrice: 30000,   maxPrice: 600000,  mustInclude: ['tb','gb','nvme','ssd'], categoryId: '856' },
    케이스:  { minPrice: 30000,   maxPrice: 600000,  mustInclude: [], categoryId: '863' },
    파워:    { minPrice: 30000,   maxPrice: 500000,  mustInclude: ['w','gold','platinum','bronze'], categoryId: '862' },
  };

  const filter = FILTERS[category] || { minPrice: 10000, maxPrice: 10000000, mustInclude: [] };

  // 쿼리 정규화 — 핵심 모델번호만 추출
  function normalizeQuery(q, cat) {
    // GPU: "NVIDIA GeForce RTX 4070 Ti Super 16GB" → "RTX 4070 Ti Super"
    if (cat === 'GPU') {
      const m = q.match(/(?:RTX|GTX|RX|Arc)\s*[\w\s]+(?:Ti|Super|XT|XTX|GRE)?/i);
      return m ? m[0].trim() : q;
    }
    // CPU: "AMD Ryzen 7 9800X3D" → "Ryzen 7 9800X3D"
    if (cat === 'CPU') {
      const m = q.match(/(?:Ryzen\s*\d+\s*\w+|Core\s*(?:i\d|Ultra)\s*[\w-]+)/i);
      return m ? m[0].trim() : q;
    }
    // RAM: "DDR5 32GB 6000MHz CL30 Dual" → "DDR5 32GB 6000"
    if (cat === 'RAM') {
      const m = q.match(/DDR[45]\s*\d+GB(?:\s*\d+MHz)?/i);
      return m ? m[0].trim() : q;
    }
    // SSD: "Samsung 990 Pro 2TB NVMe" → "삼성 990 Pro 2TB" or keep as is
    return q.replace(/\b(NVMe|PCIe|Gen\d)\b/gi, '').trim();
  }

  const searchQuery = normalizeQuery(query, category);

  try {
    const encoded = encodeURIComponent(searchQuery);
    // 카테고리ID 있으면 추가 (더 정확한 결과)
    const catParam = filter.categoryId ? `&categoryId=${filter.categoryId}` : '';
    const url = `https://openapi.naver.com/v1/search/shop.json?query=${encoded}&display=10&sort=asc${catParam}`;

    const naverRes = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': naverId,
        'X-Naver-Client-Secret': naverSecret,
      }
    });

    if (!naverRes.ok) {
      const errText = await naverRes.text();
      return res.status(200).json({ query, searchQuery, price: null, error: `Naver API ${naverRes.status}: ${errText}` });
    }

    const data = await naverRes.json();
    const items = data.items || [];

    // 정확도 필터링
    const qWords = searchQuery.toLowerCase().split(/\s+/).filter(w => w.length > 1);

    const filtered = items.filter(item => {
      const title = item.title.replace(/<[^>]+>/g, '').toLowerCase();
      const price = parseInt(item.lprice);

      // 가격 범위 체크
      if (price < filter.minPrice || price > filter.maxPrice) return false;

      // 쿼리 키워드 매칭 — 70% 이상 포함
      const matches = qWords.filter(w => title.includes(w));
      if (matches.length < Math.ceil(qWords.length * 0.7)) return false;

      // 필수 키워드 체크
      if (filter.mustInclude.length > 0) {
        const hasRequired = filter.mustInclude.some(k => title.includes(k));
        if (!hasRequired) return false;
      }

      return true;
    });

    if (filtered.length === 0) {
      // 필터 완화해서 재시도 (쿼리 키워드 50% 이상)
      const relaxed = items.filter(item => {
        const title = item.title.replace(/<[^>]+>/g, '').toLowerCase();
        const price = parseInt(item.lprice);
        if (price < filter.minPrice || price > filter.maxPrice) return false;
        const matches = qWords.filter(w => title.includes(w));
        return matches.length >= Math.ceil(qWords.length * 0.5);
      });

      if (relaxed.length === 0) {
        return res.status(200).json({
          query, searchQuery, price: null, avg: null, source: null,
          message: '일치하는 제품 없음 — DB 가격 사용'
        });
      }

      const prices = relaxed.map(i => parseInt(i.lprice)).filter(p => p > 0);
      const minPrice = Math.min(...prices);
      const avgPrice = Math.round(prices.reduce((a,b)=>a+b,0)/prices.length);

      return res.status(200).json({
        query, searchQuery,
        price: minPrice,
        avg: avgPrice,
        count: relaxed.length,
        title: relaxed[0].title.replace(/<[^>]+>/g, ''),
        link: `https://search.shopping.naver.com/search/all?query=${encoded}&sort=price_asc`,
        source: '네이버쇼핑 (완화검색)',
        items: relaxed.slice(0,3).map(i => ({
          title: i.title.replace(/<[^>]+>/g,''),
          price: parseInt(i.lprice),
          link: i.link
        }))
      });
    }

    const prices = filtered.map(i => parseInt(i.lprice)).filter(p => p > 0);
    const minPrice = Math.min(...prices);
    // 이상값 제거한 평균 (최저가 2배 이하만)
    const validPrices = prices.filter(p => p <= minPrice * 2.5);
    const avgPrice = Math.round(validPrices.reduce((a,b)=>a+b,0)/validPrices.length);

    return res.status(200).json({
      query, searchQuery,
      price: minPrice,
      avg: avgPrice,
      count: filtered.length,
      title: filtered[0].title.replace(/<[^>]+>/g, ''),
      link: `https://search.shopping.naver.com/search/all?query=${encoded}&sort=price_asc`,
      source: '네이버쇼핑',
      items: filtered.slice(0,3).map(i => ({
        title: i.title.replace(/<[^>]+>/g,''),
        price: parseInt(i.lprice),
        link: i.link
      }))
    });

  } catch(e) {
    return res.status(200).json({ query, searchQuery, price: null, error: e.message });
  }
}
