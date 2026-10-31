import '../../public/core.js';
// 台股虛擬帳戶後端:報價轉送、帳戶雲端同步
// GET  /quote?codes=2330,0050       即時報價(證交所 MIS,上市/上櫃皆可)
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
      if (url.pathname==='/quote'&&req.method!=='GET')return json({error:'method'},405);
      if (url.pathname === '/quote') return await quote(url);
      if (url.pathname === '/account') return await account(req, env);
      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 502);
    }
  },
};

async function quote(url) {
  const codes = (url.searchParams.get('codes') || '').split(',').map(s => s.trim().toUpperCase()).filter(c => CODE.test(c)).slice(0, 50);
  if (!codes.length) return json({ error: 'codes required' }, 400);
  const exCh = codes.flatMap(c => [`tse_${c}.tw`, `otc_${c}.tw`]).join('|');
  const r = await fetch(`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0&_=${Date.now()}`, { headers: UA, signal:AbortSignal.timeout(15000) });
  if(!r.ok)throw Error('報價來源 HTTP '+r.status);
  const d = await r.json();
  if(d.rtcode&&d.rtcode!=='0000')throw Error('報價來源拒絕查詢');
  const out = {};
  for (const x of d.msgArray || []) {
    // z = 最近成交價;盤中沒有成交時為 "-",改用最佳買價,再退回昨收
    const bid = num((x.b || '').split('_')[0]);
    const price = num(x.z) ?? bid ?? num(x.y);
    if (!price) continue;
    out[x.c] = { source: num(x.z)?'最近成交價':bid?'最佳買價（非成交）':'昨收參考價', date:x.d||null, tradeTime:x.t||null, name: x.n, price, prev: num(x.y), open: num(x.o), high: num(x.h), low: num(x.l), market: x.ex, time: x.tlong ? +x.tlong : null };
  }
  return json({ quotes: out, fetchedAt:Date.now() });
}

async function account(req, env) {
  if (!env.KV)return json({error:'Worker 尚未綁定 KV'},503);
  if (!env.TOKEN) return json({ error: 'Worker 尚未設定 TOKEN secret' }, 500);
  if (req.headers.get('Authorization') !== `Bearer ${env.TOKEN}`) return json({ error: '密碼錯誤' }, 401);
  if (req.method === 'GET') {
    const v = await env.KV.get('account');
    return json({ account: v ? JSON.parse(v) : null });
  }
  if (req.method === 'PUT') {
    const body = await req.text();
    if (body.length > 5e6) return json({ error: 'too large' }, 413);
    let a;try{a=JSON.parse(body);PaperCore.validateAccount(a)}catch(e){return json({error:'bad account: '+e.message},400)}
    await env.KV.put('account', body);
    return json({ ok: true });
  }
  return json({ error: 'method' }, 405);
}
