import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/core.js';
import worker from '../worker/src/index.js';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const {validateAccount}=PaperCore;
const fresh=()=>({cash:10000,initial:10000,disc:1,pos:{},log:[],hist:[{t:1,eq:10000}],realized:0});
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
