// The signer's page of built-in signing (contract SIGN-CONTRACT-R33, sections 3.2 and 7). Lane r33-sign-ui owns this file: it exports the HTML shell and the page's files, nothing else.
// The shell is the same for every link, so opening it reads and changes nothing; the page asks for its session with a POST to ./view. No cookie, no storage, relative addresses only.
// Whatever the server sent is put on the page as text, never as markup.

const CSS = `:root{color-scheme:light dark;--bg:#fff;--fg:#1d1d1f;--mute:#6e6e73;--line:#d2d2d7;--acc:#0071e3}
@media(prefers-color-scheme:dark){:root{--bg:#1c1c1e;--fg:#f5f5f7;--mute:#98989d;--line:#38383a;--acc:#2997ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:34rem;margin:0 auto;padding:2rem 1rem 4rem}h1{font-size:1.4rem;margin:0 0 .25rem}p{margin:.5rem 0}.mute{color:var(--mute)}
label{display:block;margin:1rem 0 .25rem;font-weight:600}input[type=text]{width:100%;font:inherit;padding:.6rem;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit}
button{font:inherit;padding:.65rem 1.1rem;border-radius:8px;border:1px solid var(--line);background:transparent;color:inherit;cursor:pointer}
button.go{background:var(--acc);border-color:var(--acc);color:#fff}button[disabled]{opacity:.5;cursor:default}.row{display:flex;gap:.75rem;flex-wrap:wrap;margin-top:1.25rem}
canvas{width:100%;height:140px;border:1px solid var(--line);border-radius:8px;touch-action:none;background:#fff}.tabs{display:flex;gap:.5rem;margin:.5rem 0}.tabs button[aria-pressed=true]{border-color:var(--acc)}
.err{color:#d70015;margin-top:.75rem}.note{border:1px solid var(--line);border-radius:8px;padding:.75rem 1rem;margin:1rem 0}a.dl{color:var(--acc)}`;

const SHELL = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>Sign a document</title><link rel="stylesheet" href="./assets/sign.css"><body><main id="app"><p class="mute">Opening the document...</p></main><script src="./assets/sign.js"></script></html>`;

// the page: plain script, no framework; every server string goes through textContent
const JS = `(function(){
var app=document.getElementById("app");
function el(tag,props,kids){var e=document.createElement(tag);if(props)for(var k in props){if(k==="text")e.textContent=props[k];else if(k==="class")e.className=props[k];else e.setAttribute(k,props[k]);}(kids||[]).forEach(function(c){if(c)e.appendChild(typeof c==="string"?document.createTextNode(c):c);});return e;}
function show(){app.textContent="";for(var i=0;i<arguments.length;i++)if(arguments[i])app.appendChild(arguments[i]);}
function post(op,body){return fetch("./"+op,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body||{})}).then(function(r){return r.json().then(function(j){return {status:r.status,json:j};});});}
function fail(t){show(el("h1",{text:"This link did not work"}),el("p",{class:"err",text:t}));}
post("view").then(function(r){
 if(r.status!==200||!r.json.data){fail((r.json.error&&r.json.error.message)||"This link is not valid. Ask the person who sent it for a new one.");return;}
 var s=r.json.data;
 if(s.state==="waiting"){show(el("h1",{text:s.title}),el("p",{text:s.sender.name+" asked you to sign. Waiting for the person before you. Try this link again later."}));return;}
 var mode="typed",drawn=false,err=el("p",{class:"err"});
 var name=el("input",{type:"text",maxlength:"200",autocomplete:"name"});name.value=s.signer.name;
 var typed=el("input",{type:"text",maxlength:"200"});typed.value=s.signer.name;
 var cv=el("canvas",{width:"600",height:"140"});var ctx=cv.getContext("2d");ctx.lineWidth=3;ctx.lineCap="round";ctx.strokeStyle="#0a2a8a";
 var down=false;function pt(e){var b=cv.getBoundingClientRect();return [(e.clientX-b.left)*cv.width/b.width,(e.clientY-b.top)*cv.height/b.height];}
 cv.addEventListener("pointerdown",function(e){down=true;drawn=true;var p=pt(e);ctx.beginPath();ctx.moveTo(p[0],p[1]);cv.setPointerCapture(e.pointerId);});
 cv.addEventListener("pointermove",function(e){if(!down)return;var p=pt(e);ctx.lineTo(p[0],p[1]);ctx.stroke();});
 cv.addEventListener("pointerup",function(){down=false;});
 var tabT=el("button",{type:"button","aria-pressed":"true",text:"Type"}),tabD=el("button",{type:"button","aria-pressed":"false",text:"Draw"});
 var typedBox=el("div",null,[typed]),drawBox=el("div",null,[cv,el("button",{type:"button",text:"Clear"})]);drawBox.style.display="none";
 drawBox.lastChild.addEventListener("click",function(){ctx.clearRect(0,0,cv.width,cv.height);drawn=false;});
 function pick(m){mode=m;tabT.setAttribute("aria-pressed",m==="typed");tabD.setAttribute("aria-pressed",m==="drawn");typedBox.style.display=m==="typed"?"":"none";drawBox.style.display=m==="drawn"?"":"none";}
 tabT.addEventListener("click",function(){pick("typed");});tabD.addEventListener("click",function(){pick("drawn");});
 var agree=el("input",{type:"checkbox",id:"agree"});
 var go=el("button",{class:"go",type:"button",text:"Finish and sign"}),no=el("button",{type:"button",text:"Decline to sign"});
 var doc=el("a",{class:"dl",href:"./doc",target:"_blank",rel:"noopener",text:"Open the document"});
 go.addEventListener("click",function(){err.textContent="";
  var sig=mode==="typed"?{kind:"typed",text:typed.value}:{kind:"drawn",png:cv.toDataURL("image/png").split(",")[1]};
  if(mode==="drawn"&&!drawn){err.textContent="Draw your signature first.";return;}
  go.disabled=true;
  post("sign",{name:name.value,consent:agree.checked,signature:sig}).then(function(r){go.disabled=false;
   if(r.status!==200){err.textContent=(r.json.error&&r.json.error.message)||"That did not work. Try again.";return;}
   done(s,r.json.data);});});
 no.addEventListener("click",function(){if(!confirm("Decline to sign this document?"))return;post("decline",{}).then(function(r){show(el("h1",{text:"You declined to sign"}),el("p",{text:s.sender.name+" has been told."}));});});
 show(el("h1",{text:s.title}),el("p",{class:"mute",text:s.sender.name+" at "+s.spaceName+" asked you to sign."}),s.message?el("div",{class:"note",text:s.message}):null,doc,
  el("label",{text:"Your name"}),name,el("label",{text:"Your signature"}),el("div",{class:"tabs"},[tabT,tabD]),typedBox,drawBox,
  el("label",null,[agree," "+s.consent]),err,el("div",{class:"row"},[go,no]));
});
function done(s,r){
 if(!r.completed){show(el("h1",{text:"Thank you"}),el("p",{text:"You signed "+s.title+". "+s.sender.name+" will have the signed copy when everyone has signed."}));return;}
 var msg=el("p",{text:"Preparing your copy..."}),n=0;show(el("h1",{text:"Thank you"}),el("p",{text:"You signed "+s.title+"."}),msg);
 (function ask(){fetch("./copy",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}).then(function(x){if(x.headers.get("content-type").indexOf("application/pdf")===0){return x.blob().then(function(b){var a=el("a",{class:"dl",href:URL.createObjectURL(b),download:"signed.pdf",text:"Download your signed copy"});msg.textContent="";msg.appendChild(a);});}
  if(++n<20)setTimeout(ask,3000);else msg.textContent="Your signed copy is ready with "+s.sender.name+".";});})();
}
})();`;

const ASSETS: Record<string, { mime: string; bytes: Uint8Array }> = {
  "sign.css": { mime: "text/css; charset=utf-8", bytes: new TextEncoder().encode(CSS) },
  "sign.js": { mime: "text/javascript; charset=utf-8", bytes: new TextEncoder().encode(JS) },
};

/** The HTML of the page; the same for every link. */
export function signShell(): string {
  return SHELL;
}

/** One file of the page (`assets/<name>`), or null. */
export function signAsset(name: string): { mime: string; bytes: Uint8Array } | null {
  return Object.prototype.hasOwnProperty.call(ASSETS, name) ? (ASSETS[name] as { mime: string; bytes: Uint8Array }) : null;
}
