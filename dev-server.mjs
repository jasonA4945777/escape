// Local preview with real Worker routes. Cloud account persists to a local file only.
import http from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import worker from './worker/src/index.js';
const root=path.dirname(new URL(import.meta.url).pathname);
const cache=new Map();
const env={TOKEN:process.env.TOKEN,KV:{
 async get(k,type){let v=cache.get(k);if(k==='account')try{v=await readFile(path.join(root,'.local-account.json'),'utf8')}catch{}return type==='json'&&v?JSON.parse(v):v||null},
 async put(k,v){cache.set(k,v);if(k==='account')await writeFile(path.join(root,'.local-account.json'),v)}
}};
http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://127.0.0.1:8787');
 if(['/quote','/history','/account'].includes(url.pathname)){
  let body='';for await(const c of req)body+=c;
  const r=await worker.fetch(new Request(url,{method:req.method,headers:req.headers,...(body?{body}:{})}),env);
  res.writeHead(r.status,Object.fromEntries(r.headers));res.end(await r.text());return;
 }
 const file={'/':'index.html','/index.html':'index.html','/core.js':'core.js'}[url.pathname];
 if(!file){res.writeHead(404);res.end('Not found');return}
 res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8');
 res.end(await readFile(path.join(root,'public',file)));
 }catch(e){res.writeHead(500);res.end(JSON.stringify({error:e.message}))}
}).listen(8787,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:8787'));
