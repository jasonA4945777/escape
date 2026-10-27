// 台股虛擬帳戶後端:報價轉送、歷史資料、帳戶雲端同步
// GET  /quote?codes=2330,0050       即時報價(證交所 MIS,上市/上櫃皆可)
// GET  /history?code=2330&months=12 日線收盤資料(上市走證交所,上櫃走櫃買中心)
// GET  /account   PUT /account      帳戶資料,需 Authorization: Bearer <TOKEN>

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};
const UA = { 'User-Agent': 'Mozilla/5.0 (tw-paper)', Accept: 'application/json' };
const CODE = /^[0-9A-Z]{4,6}$/;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
const num = s => {
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    try {
      if (url.pathname === '/quote') return await quote(url);
      if (url.pathname === '/history') return await history(url, env);
      if (url.pathname === '/account') return await account(req, env);
      return json({ ok: true, routes: ['/quote', '/history', '/account'] });
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 502);
    }
  },
};

async function quote(url) {
  const codes = (url.searchParams.get('codes') || '').split(',').map(s => s.trim().toUpperCase()).filter(c => CODE.test(c)).slice(0, 50);
  if (!codes.length) return json({ error: 'codes required' }, 400);
  const exCh = codes.flatMap(c => [`tse_${c}.tw`, `otc_${c}.tw`]).join('|');
  const r = await fetch(`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0&_=${Date.now()}`, { headers: UA });
  const d = await r.json();
  const out = {};
  for (const x of d.msgArray || []) {
    // z = 最近成交價;盤中沒有成交時為 "-",改用最佳買價,再退回昨收
    const bid = num((x.b || '').split('_')[0]);
    const price = num(x.z) ?? bid ?? num(x.y);
    if (!price) continue;
    out[x.c] = { name: x.n, price, prev: num(x.y), open: num(x.o), high: num(x.h), low: num(x.l), market: x.ex, time: x.tlong ? +x.tlong : null };
  }
  return json({ quotes: out });
}

async function history(url, env) {
  const code = (url.searchParams.get('code') || '').toUpperCase();
  const months = Math.min(Math.max(parseInt(url.searchParams.get('months') || '12', 10) || 12, 1), 60);
  if (!CODE.test(code)) return json({ error: 'code required' }, 400);
  const now = new Date(Date.now() + 8 * 3600e3); // 台北時間
  const rows = [];
  let market = null;
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const res = await monthData(env, code, ym, i === 0, market);
    if (res) { market = res.market; rows.push(...res.rows); }
  }
  if (!rows.length) return json({ error: '查無資料,請確認代號' }, 404);
  return json({ code, market, rows });
}

// 單月日線,過去月份長期快取,當月快取 1 小時
async function monthData(env, code, ym, current, market) {
  const key = `h:${code}:${ym}`;
  const cached = env.KV && await env.KV.get(key, 'json');
  if (cached) return cached;
  let res = null;
  if (market !== 'otc') res = await twse(code, ym);
  if (!res && market !== 'tse') res = await tpex(code, ym);
  if (res && env.KV) await env.KV.put(key, JSON.stringify(res), current ? { expirationTtl: 3600 } : {});
  return res;
}

const roc = s => {
  const [y, m, d] = s.trim().split('/').map(Number);
  return `${y + 1911}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
const parseRows = data => (data || [])
  .map(r => ({ date: roc(r[0]), open: num(r[3]), high: num(r[4]), low: num(r[5]), close: num(r[6]) }))
  .filter(r => r.close);

async function twse(code, ym) {
  const r = await fetch(`https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${ym}01&stockNo=${code}&response=json`, { headers: UA });
  const d = await r.json().catch(() => null);
  if (!d || d.stat !== 'OK') return null;
  const rows = parseRows(d.data);
  return rows.length ? { market: 'tse', rows } : null;
}

async function tpex(code, ym) {
  const date = `${ym.slice(0, 4)}/${ym.slice(4)}/01`;
  const r = await fetch(`https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=${code}&date=${encodeURIComponent(date)}&response=json`, { headers: UA });
  const d = await r.json().catch(() => null);
  const t = d && d.tables && d.tables[0];
  if (!t) return null;
  const rows = parseRows(t.data);
  return rows.length ? { market: 'otc', rows } : null;
}

async function account(req, env) {
  if (!env.TOKEN) return json({ error: 'Worker 尚未設定 TOKEN secret' }, 500);
  if (req.headers.get('Authorization') !== `Bearer ${env.TOKEN}`) return json({ error: '密碼錯誤' }, 401);
  if (req.method === 'GET') {
    const v = await env.KV.get('account');
    return json({ account: v ? JSON.parse(v) : null });
  }
  if (req.method === 'PUT') {
    const body = await req.text();
    if (body.length > 5e6) return json({ error: 'too large' }, 413);
    const a = JSON.parse(body);
    if (typeof a.cash !== 'number' || !a.pos || !a.log) return json({ error: 'bad account' }, 400);
    await env.KV.put('account', body);
    return json({ ok: true });
  }
  return json({ error: 'method' }, 405);
}
