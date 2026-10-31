/* Shared accounting rules: browser and Worker. No network or UI dependencies. */
(function(root){
'use strict';
const CODE=/^[0-9A-Z]{4,6}$/;
const finite=(x,min=0)=>typeof x==='number'&&Number.isFinite(x)&&x>=min;
const fee=(amount,discount=1,minimum=20)=>amount>0?Math.max(minimum,Math.floor(amount*.001425*discount)):0;
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
root.PaperCore={CODE,fee,validateAccount};
})(globalThis);
