import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/core.js';
import worker from '../worker/src/index.js';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const {backtest,affordable,validateAccount}=PaperCore;
const opts={strat:'hold',cap:10000,disc:1,short:1,long:2,dca:1000,sl:0,tp:0,slip:0,etf:false};
const bars=(prices)=>prices.map((p,i)=>({date:`2026-01-${String(i+1).padStart(2,'0')}`,open:p,close:p}));
const fresh=()=>({cash:10000,initial:10000,disc:1,pos:{},log:[],hist:[{t:1,eq:10000}],realized:0});
test('minimum fee affordability never borrows',()=>{assert.equal(affordable(1000,100,1),9);assert.equal(affordable(10,100,1),0)});
test('hold equals benchmark including fees and slippage',()=>{const r=backtest(bars([100,110,105]),{...opts,slip:10});assert.deepEqual(r.eq,r.bench);assert.ok(r.cash>=0)});
test('signal trades at next open, never same close',()=>{const rows=bars([100,90,100,110]);rows[3].open=105;const r=backtest(rows,{...opts,strat:'ma'});assert.equal(r.trades[0].date,'2026-01-04');assert.equal(r.trades[0].signalDate,'2026-01-03');assert.equal(r.trades[0].price,105)});
test('final day crossover remains pending',()=>{const r=backtest(bars([100,90,100]),{...opts,strat:'ma'});assert.equal(r.trades.length,0);assert.equal(r.pending.side,'buy')});
test('DCA spends only initial capital; no future contributions used by benchmark',()=>{const rows=Array.from({length:12},(_,i)=>({date:`2026-${String(i+1).padStart(2,'0')}-01`,open:100,close:100}));const r=backtest(rows,{...opts,strat:'dca',cap:2000,dca:1000});assert.equal(r.invested,2000);assert.ok(r.cash>=0);assert.equal(r.trades.length,3);assert.equal(r.eq[0].v,r.bench[0].v)});
test('stop uses next open and sale tax',()=>{const rows=bars([100,90,95]);const r=backtest(rows,{...opts,strat:'dca',dca:10000,sl:.05});assert.equal(r.trades[1].date,'2026-01-03');assert.equal(r.trades[1].tax,Math.floor(95*r.trades[1].qty*.003))});
test('invalid parameters and discontinuous raw prices blocked',()=>{assert.throws(()=>backtest(bars([100,30]),opts));assert.throws(()=>backtest(bars([100,101]),{...opts,cap:NaN}));assert.throws(()=>backtest(bars([100,101]),{...opts,strat:'ma',short:5,long:2}))});
test('malformed imports and code injection blocked',()=>{assert.throws(()=>validateAccount({...fresh(),cash:Infinity}));assert.throws(()=>validateAccount({...fresh(),hist:[]}));assert.throws(()=>validateAccount({...fresh(),pos:{"x');alert(1);//":{qty:1}}}));assert.equal(validateAccount(fresh()).cash,10000)});
test('Worker rejects invalid account and missing auth',async()=>{const env={TOKEN:'test',KV:{get:async()=>null,put:async()=>{throw Error('must not write')}}};assert.equal((await worker.fetch(new Request('https://test/account'),env)).status,401);const r=await worker.fetch(new Request('https://test/account',{method:'PUT',headers:{Authorization:'Bearer test'},body:'{"cash":-1}'}),env);assert.equal(r.status,400)});
function ui(){
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),elements={};
 const el=id=>elements[id]||=( {value:'',textContent:'',innerHTML:'',style:{},classList:{contains:()=>false}} );
 const box=vm.createContext({PaperCore,console,Date,Number,JSON,Math,URL,Blob,location:{protocol:'file:',hostname:'',origin:''},localStorage:{getItem:()=>null,setItem:()=>{}},document:{getElementById:el,querySelectorAll:()=>[]},window:{scrollTo(){}},confirm:()=>true,setTimeout,clearTimeout,setInterval,clearInterval});
 vm.runInContext(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1],box);return {box,el};
}
test('UI buy, partial sale, rejected quantity and tax type preserve accounting',()=>{
 const {box,el}=ui();el('sym').value='2330';el('price').value='100';el('qty').value='10';el('kind').value='stock';el('reason').value='test';
 vm.runInContext("trade('buy')",box);assert.equal(vm.runInContext('S.cash',box),998980);
 el('qty').value='1.5';vm.runInContext("trade('buy')",box);assert.equal(vm.runInContext('S.log.length',box),1);
 el('qty').value='5';el('kind').value='etf';vm.runInContext("trade('sell')",box);assert.equal(vm.runInContext('S.log.length',box),1);
 el('kind').value='stock';el('price').value='110';vm.runInContext("trade('sell')",box);assert.equal(vm.runInContext('S.pos["2330"].qty',box),5);assert.equal(vm.runInContext('S.realized',box),19);assert.equal(vm.runInContext('S.hist[0].eq',box),1000000);
});
const fixture=n=>JSON.parse(readFileSync(new URL('./fixtures/'+n+'.json',import.meta.url),'utf8'));
test('actual 2026-10-31 captured MIS response keeps source date and price',async()=>{
 const original=global.fetch;global.fetch=async()=>Response.json(fixture('quote'));
 try{const r=await worker.fetch(new Request('https://test/quote?codes=2330,6488'),{}),d=await r.json();assert.equal(d.quotes['2330'].price,2370);assert.equal(d.quotes['2330'].date,'20261030');assert.equal(d.quotes['6488'].price,756)}finally{global.fetch=original}
});
test('fallback bid is explicitly identified as not a trade',async()=>{
 const original=global.fetch;global.fetch=async()=>Response.json({msgArray:[{c:'2330',z:'-',b:'100_',y:'99'}]});
 try{const r=await worker.fetch(new Request('https://test/quote?codes=2330'),{}),d=await r.json();assert.equal(d.quotes['2330'].source,'最佳買價（非成交）')}finally{global.fetch=original}
});
test('TWSE and TPEx recorded response formats both parse open and close',async()=>{
 const original=global.fetch;
 try{for(const market of ['twse','tpex']){
  global.fetch=async url=>Response.json(market==='tpex'&&String(url).includes('twse.com')?{stat:'no data'}:fixture(market));
  const r=await worker.fetch(new Request('https://test/history?code=2330&months=1'),{}),d=await r.json();assert.equal(r.status,200);assert.equal(d.rows[0].date,'2026-09-01');assert.equal(d.rows[0].open,market==='twse'?2395:908);assert.equal(d.rows[0].close,market==='twse'?2440:994);
 }}finally{global.fetch=original}
});
test('missing months stop rather than quietly producing partial results',async()=>{
 const original=global.fetch;global.fetch=async()=>Response.json({stat:'no data'});
 try{const r=await worker.fetch(new Request('https://test/history?code=2330&months=1'),{});assert.equal(r.status,404);let calls=0;global.fetch=async()=>Response.json(calls++===0?fixture('twse'):{stat:'no data'});const partial=await worker.fetch(new Request('https://test/history?code=2330&months=2'),{});assert.equal(partial.status,422)}finally{global.fetch=original}
});
