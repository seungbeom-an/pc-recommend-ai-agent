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
    return res.status(200).json({ query, price: null, error: 'Naver API keys missing' });
  }

  // ── 카테고리별 검색어 정규화 + 가격 범위 ──
  function getSearchConfig(q, cat) {
    const raw = q.trim();

    if (cat === 'GPU') {
      // "NVIDIA GeForce RTX 4080 Super 16GB" → "RTX 4080 Super"
      const m = raw.match(/(RTX|GTX|RX)\s*\d{3,4}(?:\s*\d+)?\s*(?:Ti\s+Super|Ti|Super|XT|XTX|GRE)?/i);
      const sq = m ? m[0].trim() : raw.split(' ').slice(-3).join(' ');
      return { sq: sq + ' 그래픽카드', min: 150000, max: 6000000,
               must: ['rtx','gtx','rx','그래픽','vga','gpu'] };
    }

    if (cat === 'CPU') {
      // "AMD Ryzen 7 9800X3D" → "라이젠 7 9800X3D" or keep english
      const m = raw.match(/(\d{4}[A-Z0-9]*(?:X3D|K|KF|KS|X|F)?)\b/i);
      const modelNum = m ? m[1] : '';
      const sq = modelNum ? modelNum + ' CPU 프로세서' : raw + ' CPU';
      return { sq, min: 80000, max: 2000000,
               must: ['cpu','프로세서','소켓','코어'] };
    }

    if (cat === 'RAM') {
      // "DDR5 32GB 6000MHz CL30 Dual" → "DDR5 32GB 6000"
      const m = raw.match(/(DDR[45])\s*(\d+)\s*GB(?:\s*(\d+)(?:MHz)?)?/i);
      const sq = m ? `${m[1]} ${m[2]}GB${m[3] ? ' '+m[3] : ''} 램` : raw.split(' ').slice(0,3).join(' ') + ' 램';
      return { sq, min: 20000, max: 500000,
               must: ['ddr','gb','ram','램','메모리'] };
    }

    if (cat === 'SSD') {
      // "Samsung 990 Pro 2TB NVMe" → "990 Pro 2TB SSD"
      // "WD SN850X 2TB" → "SN850X 2TB SSD"
      const size = raw.match(/(\d+)\s*TB/i);
      const model = raw.match(/(?:990\s*Pro|980\s*Pro|SN\d+X?|P\d+\s*Pro|T\d+|MP\d+|Fury\s*Renegade)/i);
      const sq = model
        ? `${model[0]} ${size ? size[0] : ''} SSD`.trim()
        : raw.replace(/NVMe|PCIe|Gen\d|M\.2/gi,'').trim() + ' SSD';
      return { sq, min: 30000, max: 700000,
               must: ['ssd','nvme','tb','gb','저장'] };
    }

    if (cat === '케이스') {
      // "Fractal Design North XL" → "Fractal North XL 케이스"
      const sq = raw.replace(/ATX|ITX|mATX/gi,'').trim() + ' PC케이스';
      return { sq, min: 40000, max: 600000,
               must: ['케이스','case','tower','타워'] };
    }

    if (cat === '파워') {
      // "Seasonic Focus GX 1000W 80+ Gold" → "시소닉 Focus GX 1000W 파워"
      const watt = raw.match(/(\d{3,4})\s*W/i);
      const brand = raw.match(/Seasonic|Corsair|EVGA|be quiet|Super Flower|마이크로닉스|FSP|Antec/i);
      const grade = raw.match(/Gold|Platinum|Bronze|Titanium/i);
      const sq = `${brand?brand[0]+' ':''}${watt?watt[0]+' ':''}${grade?grade[0]+' ':''}파워서플라이`;
      return { sq, min: 40000, max: 500000,
               must: ['파워','power','psu','w','watt'] };
    }

    // 기타
    return { sq: raw, min: 10000, max: 5000000, must: [] };
  }

  const { sq, min, max, must } = getSearchConfig(query, category);

  try {
    const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(sq)}&display=20&sort=asc`;
    const r = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': naverId,
        'X-Naver-Client-Secret': naverSecret,
      }
    });

    if (!r.ok) {
      const txt = await r.text();
      return res.status(200).json({ query, sq, price: null, error: `Naver ${r.status}: ${txt.slice(0,100)}` });
    }

    const data = await r.json();
    const items = (data.items || []).map(i => ({
      title: i.title.replace(/<[^>]+>/g, '').toLowerCase(),
      price: parseInt(i.lprice),
      link: i.link,
      rawTitle: i.title.replace(/<[^>]+>/g, ''),
    }));

    // 1단계: 가격 범위 필터
    const inRange = items.filter(i => i.price >= min && i.price <= max);

    // 2단계: 필수 키워드 중 하나 이상 포함
    const withMust = must.length > 0
      ? inRange.filter(i => must.some(k => i.title.includes(k)))
      : inRange;

    // 3단계: 원본 쿼리 핵심 키워드 매칭 점수
    const qWords = query.toLowerCase()
      .replace(/nvidia geforce|amd radeon|intel/gi, '')
      .split(/\s+/)
      .filter(w => w.length > 1 && !/^(pc|the|and|or|for)$/i.test(w));

    const scored = withMust.map(i => {
      const hits = qWords.filter(w => i.title.includes(w.toLowerCase()));
      return { ...i, score: hits.length / Math.max(qWords.length, 1) };
    }).sort((a, b) => b.score - a.score || a.price - b.price);

    // 60% 이상 매칭된 것만
    const good = scored.filter(i => i.score >= 0.6);
    const candidates = good.length > 0 ? good : scored.filter(i => i.score >= 0.4);

    if (candidates.length === 0) {
      return res.status(200).json({
        query, sq, price: null, count: 0,
        message: '정확한 제품 없음 — DB 가격 사용',
        debug: { total: items.length, inRange: inRange.length, withMust: withMust.length }
      });
    }

    const minPrice = candidates[0].price;
    // 이상값 제거: 최저가 2배 이내만 평균에 포함
    const forAvg = candidates.filter(i => i.price <= minPrice * 2);
    const avg = Math.round(forAvg.reduce((a, b) => a + b.price, 0) / forAvg.length);

    return res.status(200).json({
      query, sq,
      price: minPrice,
      avg,
      count: candidates.length,
      source: '네이버쇼핑',
      title: candidates[0].rawTitle.slice(0, 50),
      link: `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(sq)}&sort=price_asc`,
      top3: candidates.slice(0, 3).map(i => ({
        title: i.rawTitle.slice(0, 40),
        price: i.price,
        score: Math.round(i.score * 100)
      }))
    });

  } catch (e) {
    return res.status(200).json({ query, sq, price: null, error: e.message });
  }
}
