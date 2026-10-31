/* Shared accounting rules: browser and Worker. No network or UI dependencies. */
(function(root){
'use strict';
const CODE=/^[0-9A-Z]{4,6}$/;
const finite=(x,min=0)=>typeof x==='number'&&Number.isFinite(x)&&x>=min;
const fee=(amount,discount=1,minimum=20)=>amount>0?Math.max(minimum,Math.floor(amount*.001425*discount)):0;
function affordable(cash,price,discount,minimum=20){
 let q=Math.floor(cash/price);
 while(q>0&&Math.round(price*q)+fee(Math.round(price*q),discount,minimum)>cash)q--;
 return q;
}
function validateAccount(s){
 if(!s||!finite(s.cash)||!finite(s.initial,1)||!finite(s.disc)||s.disc>1||!Number.isFinite(s.realized)||!s.pos||Array.isArray(s.pos)||!Array.isArray(s.log)||!Array.isArray(s.hist)||!s.hist.length)throw Error('帳戶格式不完整或數值無效');
 if(s.updated!==undefined&&!finite(s.updated))throw Error('帳戶時間無效');
 for(const [code,p] of Object.entries(s.pos)){
  if(!CODE.test(code)||!p||!Number.isSafeInteger(p.qty)||p.qty<=0||!finite(p.cost,.01)||!finite(p.last,.0001)||!['stock','etf'].includes(p.kind)||typeof p.name!=='string')throw Error('持股資料無效');
 }
 for(const h of s.hist)if(!h||!finite(h.t)||!finite(h.eq))throw Error('資產紀錄無效');
 for(const l of s.log)if(!l||!CODE.test(l.sym)||!['buy','sell'].includes(l.side)||!finite(l.t)||!finite(l.price,.0001)||!Number.isSafeInteger(l.qty)||l.qty<=0||!finite(l.fee)||!finite(l.tax)||(l.pnl!==null&&!Number.isFinite(l.pnl)))throw Error('交易紀錄無效');
 return s;
}
function backtest(rows,o){
 if(!Array.isArray(rows)||rows.length<2)throw Error('至少需要兩個交易日');
 if(!['hold','ma','dca'].includes(o.strat)||!finite(o.cap,1000)||!finite(o.disc)||o.disc>1||!finite(o.sl)||o.sl>=1||!finite(o.tp)||!finite(o.slip)||o.slip>100)throw Error('請檢查本金、折扣、停損停利及滑價設定');
 if(o.strat==='ma'&&(!Number.isInteger(o.short)||!Number.isInteger(o.long)||o.short<1||o.long<=o.short||rows.length<=o.long))throw Error('長均線需大於短均線，且資料需長於長均線');
 if(o.strat==='dca'&&!finite(o.dca,1))throw Error('每月投入需大於零');
 for(let i=0;i<rows.length;i++){
  const r=rows[i];if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!finite(r.open,.0001)||!finite(r.close,.0001)||(i&&r.date<=rows[i-1].date))throw Error('日線須按日期遞增且開收盤價有效');
  if(i&&Math.abs(r.open/rows[i-1].close-1)>.25)throw Error('偵測到超過25%的價格斷層，可能涉及分割或減資；需先取得還原資料，暫停回測');
 }
 const fe=a=>fee(a,o.disc),taxR=o.etf?.001:.003,slip=o.slip/10000;
 let cash=o.cap,sh=0,basis=0,lastMonth='',pending=null;
 const eq=[{t:Date.parse(rows[0].date)-1,v:o.cap}],trades=[];
 const ma=(n,i)=>i+1<n?null:rows.slice(i+1-n,i+1).reduce((a,b)=>a+b.close,0)/n;
 const buy=(i,money,why,signalDate)=>{
  const px=rows[i].open*(1+slip),q=affordable(Math.min(cash,money),px,o.disc);if(!q)return;
  const amt=Math.round(px*q),f=fe(amt);cash-=amt+f;sh+=q;basis+=amt+f;
  trades.push({date:rows[i].date,signalDate,side:'buy',price:px,qty:q,why,pnl:null,fee:f,tax:0});
 };
 const sell=(i,why,signalDate)=>{
  if(!sh)return;const px=rows[i].open*(1-slip),amt=Math.round(px*sh),f=fe(amt),tax=Math.floor(amt*taxR),net=amt-f-tax;
  trades.push({date:rows[i].date,signalDate,side:'sell',price:px,qty:sh,why,pnl:net-basis,fee:f,tax});cash+=net;sh=0;basis=0;
 };
 for(let i=0;i<rows.length;i++){
  const r=rows[i],m=r.date.slice(0,7);let exited=false;
  if(pending){if(pending.side==='sell'){sell(i,pending.why,pending.date);exited=true}else buy(i,cash,pending.why,pending.date);pending=null}
  if(o.strat==='hold'&&i===0)buy(i,cash,'買進持有','期初已定規則');
  if(o.strat==='dca'&&m!==lastMonth&&!exited)buy(i,Math.min(cash,o.dca),'每月分批投入','期初已定規則');
  if(sh&&o.strat!=='hold'){
   const ret=r.close*sh/basis-1;
   if(o.sl>0&&ret<=-o.sl)pending={side:'sell',why:'收盤觸發停損',date:r.date};
   else if(o.tp>0&&ret>=o.tp)pending={side:'sell',why:'收盤觸發停利',date:r.date};
  }
  if(o.strat==='ma'&&!pending){
   const s0=ma(o.short,i-1),l0=ma(o.long,i-1),s1=ma(o.short,i),l1=ma(o.long,i);
   if(s0!==null&&l0!==null){
    if(!sh&&s0<=l0&&s1>l1)pending={side:'buy',why:`黃金交叉 MA${o.short}>MA${o.long}`,date:r.date};
    else if(sh&&s0>=l0&&s1<l1)pending={side:'sell',why:'死亡交叉',date:r.date};
   }
  }
  lastMonth=m;eq.push({t:Date.parse(r.date),v:cash+sh*r.close});
 }
 const px0=rows[0].open*(1+slip),q0=affordable(o.cap,px0,o.disc),a0=Math.round(px0*q0),c0=o.cap-a0-fe(a0);
 const bench=[{t:eq[0].t,v:o.cap},...rows.map(r=>({t:Date.parse(r.date),v:c0+q0*r.close}))];
 return {eq,bench,trades,invested:o.cap,pending,settings:{...o},cash,shares:sh};
}
root.PaperCore={CODE,fee,affordable,validateAccount,backtest};
})(globalThis);
