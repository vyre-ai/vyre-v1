/** Sync advertises an origin. The client appends the canonical live-socket path. */
export function syncEndpointOrigin(address:string):string|null{
 try{
  const url=new URL(address.includes('://')?address:`https://${address}`);
  const local=url.hostname==='localhost'||url.hostname==='127.0.0.1'||url.hostname==='[::1]';
  if(!url.host||url.username||url.password||!(url.protocol==='https:'||(url.protocol==='http:'&&local)))return null;
  url.protocol=url.protocol==='https:'?'wss:':'ws:';
  return url.origin;
 }catch{return null;}
}
