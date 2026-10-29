// Only the packaged desktop origin may cross into a Space API. This never authenticates a request.
import type{IncomingMessage,ServerResponse}from'node:http';
const origins=new Set(['tauri://localhost','http://tauri.localhost','https://tauri.localhost']);
const methods=new Set(['GET','POST','PUT','PATCH','DELETE','HEAD']);
const headers=new Set(['accept','authorization','content-type','idempotency-key','x-vyre-trace']);
export function packagedOrigin(value:string|undefined):value is string{return typeof value==='string'&&origins.has(value);}
export function desktopCors(req:IncomingMessage,res:ServerResponse):boolean{
 const pathname=(req.url??'').split('?')[0]??'';
 if(!pathname.startsWith('/v1/')&&!pathname.startsWith('/sync/')&&!pathname.startsWith('/local/vault/key/'))return false;
 res.setHeader('vary','Origin');const origin=req.headers.origin;
 if(!packagedOrigin(origin))return false;
 if(req.method==='OPTIONS'){
  const method=req.headers['access-control-request-method'];const requested=req.headers['access-control-request-headers'];
  const list=typeof requested==='string'?requested.split(',').map(h=>h.trim().toLowerCase()).filter(Boolean):[];
  if(typeof method!=='string'||!methods.has(method)||Array.isArray(requested)||list.some(h=>!headers.has(h))){res.writeHead(403);res.end();return true;}
  res.setHeader('access-control-allow-origin',origin);res.setHeader('access-control-allow-methods',method);if(list.length)res.setHeader('access-control-allow-headers',list.join(', '));res.setHeader('vary','Origin, Access-Control-Request-Method, Access-Control-Request-Headers');res.writeHead(204);res.end();return true;
 }
 res.setHeader('access-control-allow-origin',origin);res.setHeader('access-control-expose-headers','x-vyre-trace, retry-after');return false;
}
