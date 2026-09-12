const MODELS=[
 ["DeepSeek V4 Flash 0731","deepseek-ai/DeepSeek-V4-Flash-0731"],
 ["Huihui Qwen3.8 27B","huihui-ai/Huihui-Qwen3.8-27B-abliterated"],
 ["Qwen 3.5 397B A17B","Qwen/Qwen3.5-397B-A17B"],
 ["Qwen 3.5 122B A10B","Qwen/Qwen3.5-122B-A10B"]
];
const DEFAULT_SYSTEM="You are a helpful, intelligent and conversational AI assistant. Answer clearly, naturally and accurately.";
const K="fc_epic_";
const S={
 model:localStorage.getItem(K+"model")||MODELS[0][1],max:+localStorage.getItem(K+"max")||1200,temp:+localStorage.getItem(K+"temp")||.8,
 thinking:localStorage.getItem(K+"think")==="1",key:localStorage.getItem(K+"key")||"",
 system:localStorage.getItem(K+"system")||DEFAULT_SYSTEM,messages:JSON.parse(localStorage.getItem(K+"messages")||"null")||[],
 stats:JSON.parse(localStorage.getItem(K+"stats")||'{"requests":0,"prompt":0,"completion":0,"total":0}'),last:null,controller:null
};
const $=x=>document.getElementById(x);
MODELS.forEach(([n,v])=>{
  let o=document.createElement("option");
  o.value=v; o.label=n;
  $("modelList").appendChild(o);
});
$("model").value=S.model;$("maxTokens").value=S.max;$("temperature").value=S.temp;$("thinking").checked=S.thinking;$("apiKey").value=S.key;

// ── Attachments (pending before send) ──
const MAX_IMAGES=4;
const MAX_IMAGE_SIDE=1280;
const MAX_IMAGE_BYTES=1.6e6; // ~1.6 MB after compress
const MAX_TEXT_FILE=120000; // chars extracted
let pending=[]; // {id, kind:'image'|'video'|'file', name, size, mime, dataUrl?, text?, note?}

function fmtSize(n){return n<1024?n+" B":n<1048576?(n/1024).toFixed(1)+" KB":(n/1048576).toFixed(1)+" MB"}
function uid(){return Math.random().toString(36).slice(2,10)}

// Heuristic: model likely supports vision (Featherless catalog uses VL / Vision tags)
function modelLikelyVision(id){
  const s=(id||"").toLowerCase();
  return /vl|vision|gemma-3|gemma-4|qwen2\.5-vl|qwen3-vl|qwen3\.5|llava|minicpm-v|internvl|kimi-k3|mimo-v|ui-tars|ovis|florence|pixtral|molmo|phi-4|phi-3\.5-vision|claude-3|gpt-4o|gpt-4\.1|gemini/.test(s)
    || /qwen3\.8|qwen3\.6|huihui.*qwen|abliterat/.test(s); // many Qwen3.x abliterated variants on Featherless are vision-capable
}

// Heuristic: model family supports controllable thinking / reasoning (Featherless chat_template_kwargs)
function modelLikelyThinking(id){
  const s=(id||"").toLowerCase();
  // Qwen3 / 3.5 / 3.6 / 3.8, GLM 4.7+, Gemma 4, DeepSeek V3.1+/V4, Kimi K2 thinking, R1-style, many "thinking" / "reasoning" named models
  return /qwen3|qwen-3|qwen3\.5|qwen3\.6|qwen3\.8|glm-4\.7|glm-5|glm4\.7|gemma-4|gemma4|deepseek-v3\.|deepseek-v4|deepseek.?r1|kimi-k2|kimi.?thinking|thinking|reasoning|r1-|o1-|o3-|qwq|sky-t1|trinity.*think|cogito|am-thinking|cat-thinking/.test(s)
    || /huihui.*qwen|abliterat.*qwen3|qwen3.*abliterat/.test(s);
}

function thinkingToggleLabel(){
  const ok=modelLikelyThinking(S.model);
  const el=$("thinking");
  if(!el)return;
  const row=el.closest(".toggle-row");
  if(row){
    row.title=ok
      ?"Este modelo suele soportar thinking/reasoning (chat_template_kwargs)."
      :"El modelo actual probablemente no expone toggle de thinking. Si no ves razonamiento, prueba un modelo Qwen3 / GLM / DeepSeek V4 / Gemma 4.";
    row.style.opacity=ok?"":"0.72";
  }
}

function estimate(s){
  if(s==null)return 1;
  if(typeof s!=="string"){
    // Multimodal stored content or legacy
    if(Array.isArray(s)){
      return s.reduce((n,p)=>{
        if(p?.type==="text")return n+estimate(p.text||"");
        if(p?.type==="image_url")return n+850; // rough vision tokens
        return n;
      },0);
    }
    return estimate(String(s));
  }
  const t=s;
  const denser=/```|function |const |let |import |export |class |\{|\[/.test(t);
  return Math.max(1,Math.ceil(t.length/(denser?2.85:3.05))+4);
}
function msgTokens(m){
  let n=estimate(m.content)+8;
  if(m.images?.length)n+=m.images.length*850;
  if(m.files?.length)n+=m.files.reduce((a,f)=>a+estimate(f.text||""),0);
  return n;
}
function tokens(){return S.messages.reduce((n,m)=>n+msgTokens(m),0)}
function systemTokens(){return estimate(S.system)+8}
function contextBudget(){
  return Math.max(1500,32768-S.max-systemTokens()-1100);
}
function trim(){
  const budget=contextBudget();
  const trigger=Math.floor(budget*0.92);
  const target=Math.floor(budget*0.85);
  if(tokens()<=trigger)return 0;
  const before=S.messages.length;
  while(tokens()>target&&S.messages.length>2){
    const a=S.messages[0],b=S.messages[1];
    if(a?.role==="user"&&b?.role==="assistant"){
      S.messages.splice(0,2);
    }else if(a?.role==="assistant"){
      S.messages.shift();
    }else{
      S.messages.shift();
    }
  }
  while(tokens()>target&&S.messages.length>1)S.messages.shift();
  const removed=before-S.messages.length;
  if(removed>0)notifyTrim(removed);
  return removed;
}

let _trimTimer=null;
function notifyTrim(n){
  const el=$("trimToast");
  if(!el)return;
  el.textContent=n===1
    ?"Contexto reducido · 1 mensaje antiguo"
    :`Contexto reducido · ${n} mensajes antiguos`;
  el.classList.add("show");
  clearTimeout(_trimTimer);
  _trimTimer=setTimeout(()=>el.classList.remove("show"),3200);
}
function save(){localStorage.setItem(K+"model",S.model);localStorage.setItem(K+"max",S.max);localStorage.setItem(K+"temp",S.temp);localStorage.setItem(K+"think",S.thinking?"1":"0");localStorage.setItem(K+"key",S.key);localStorage.setItem(K+"system",S.system);localStorage.setItem(K+"messages",JSON.stringify(S.messages));localStorage.setItem(K+"stats",JSON.stringify(S.stats))}

function renderAttachmentsHtml(m){
  let h="";
  if(m.images?.length){
    h+='<div class="att-gallery">'+m.images.map(im=>`<img src="${im.dataUrl||im.url||""}" alt="${esc(im.name||"img")}" loading="lazy">`).join("")+"</div>";
  }
  if(m.files?.length){
    h+='<div class="att-files">'+m.files.map(f=>`<span class="att-file-tag">📄 ${esc(f.name||"file")}${f.size?` · ${fmtSize(f.size)}`:""}</span>`).join("")+"</div>";
  }
  return h;
}

function renderReasoningHtml(m){
  if(!m.reasoning&&!m.thinking)return"";
  const text=m.reasoning||m.thinking||"";
  const sec=m.reasoningSec;
  const open=m._streamThinking?" open":"";
  const label=sec!=null
    ?`Razonó · ${Number(sec).toFixed(1)}s`
    :(m._streamThinking?"Pensando…":"Razonamiento");
  // Collapsible; while streaming stays open so user can watch live
  return `<details class="think-block"${open}><summary><span class="think-ico">◈</span> ${esc(label)}</summary><div class="think-body">${markdown(text)}</div></details>`;
}

function render(){
 let box=$("messages"),vis=S.messages;
 if(!vis.length){box.innerHTML='<div class="empty"><div><div class="empty-logo">✦</div><h1>Featherless</h1><p>32K context · streaming · OLED</p></div></div>';update();return}
 box.innerHTML="";
 vis.forEach((m,i)=>{
  if(m.role==="system")return;
  let d=document.createElement("article");d.className="message "+m.role;
  const textPart=typeof m.content==="string"?m.content:(Array.isArray(m.content)?(m.content.find(p=>p.type==="text")?.text||""):"");
  let content=markdown(textPart||"");
  const att=renderAttachmentsHtml(m);
  const thinkHtml=m.role==="assistant"?renderReasoningHtml(m):"";
  // While still streaming thinking and no final content yet, show only thinking + placeholder
  const showContent=!(m._streamThinking&&!textPart);
  d.innerHTML=`<div class="bubble"><div class="role">${m.role==="user"?"Tú":"Featherless"}</div>${att}${thinkHtml}${showContent?`<div class="content">${content||(att||thinkHtml?"":"…")}</div>`:`<div class="content thinking-wait"><span class="tw-dot"></span> Respuesta tras razonar…</div>`}${m.meta?`<div class="meta">${m.meta}</div>`:""}</div>`;
  box.appendChild(d);
 });
 box.scrollTop=box.scrollHeight;update();
 document.querySelectorAll(".copy").forEach(b=>b.onclick=()=>navigator.clipboard?.writeText(b.dataset.code||""));
}
function markdown(s){
 let out=esc(s);
 out=out.replace(/```(?:[\w+-]+)?\n?([\s\S]*?)```/g,(_,x)=>`<div class="code-wrap"><button class="copy" data-code="${esc(x.trim()).replaceAll('"','&quot;')}">Copiar</button><pre class="code">${x.trim()}</pre></div>`);
 out=out.replace(/`([^`]+)`/g,"<code>$1</code>").replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>").replace(/\n/g,"<br>");
 return out;
}
function esc(s){return String(s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
function update(){
 let n=tokens()+systemTokens(),p=Math.min(100,n/32768*100);$("ctxLabel").textContent=`${n.toLocaleString()} / 32,768`;$("ctxPct").textContent=Math.round(p)+"%";$("ctxFill").style.width=p+"%";
 let m=MODELS.find(x=>x[1]===S.model);$("modelLabel").textContent=(m?m[0]:S.model.split("/").pop())+" · 32K";
}
function drawer(open){$("drawer").classList.toggle("open",open);$("scrim").classList.toggle("open",open)}
function fresh(){S.messages=[];pending=[];renderPending();save();render();drawer(false);$("chatName").textContent="New conversation"}
function importJSON(file){
  const r=new FileReader();
  r.onload=()=>{
    try{
      const data=JSON.parse(r.result);
      const msgs=Array.isArray(data)?data:data.messages;
      if(!Array.isArray(msgs))throw Error("El JSON no contiene un array de messages.");
      const clean=msgs.filter(m=>m&&["user","assistant"].includes(m.role))
        .map(m=>{
          const o={role:m.role,content:typeof m.content==="string"?m.content:(Array.isArray(m.content)?(m.content.find(p=>p?.type==="text")?.text||""):String(m.content||""))};
          if(m.images?.length)o.images=m.images;
          if(m.files?.length)o.files=m.files;
          if(m.meta)o.meta=m.meta;
          return o;
        });
      if(!clean.length)throw Error("No encontré mensajes válidos en el JSON.");
      S.messages=clean;
      if(typeof data.system==="string"&&data.system.trim())S.system=data.system.trim();
      if(typeof data.model==="string"&&data.model.trim())S.model=data.model.trim();
      if(Number.isFinite(+data.max_output))S.max=Math.max(1,Math.min(32767,+data.max_output));
      if(Number.isFinite(+data.temperature))S.temp=Math.max(0,Math.min(2,+data.temperature));
      $("model").value=S.model;$("maxTokens").value=S.max;$("temperature").value=S.temp;
      trim();
      save();render();drawer(false);
      $("chatName").textContent=(S.messages.find(x=>x.role==="user")?.content||"Imported conversation").slice(0,35);
    }catch(e){alert("No se pudo importar: "+e.message)}
  };
  r.readAsText(file);
}
$("menu").onclick=()=>drawer(true);$("close").onclick=()=>drawer(false);$("scrim").onclick=()=>drawer(false);$("newChat").onclick=fresh;$("drawerNew").onclick=fresh;
$("model").onchange=e=>{S.model=e.target.value.trim()||MODELS[0][1];e.target.value=S.model;save();update();thinkingToggleLabel()};
$("model").onblur=e=>{S.model=e.target.value.trim()||MODELS[0][1];e.target.value=S.model;save();update();thinkingToggleLabel()};$("maxTokens").onchange=e=>{S.max=Math.max(1,Math.min(32767,+e.target.value||1200));e.target.value=S.max;trim();save();update()};$("temperature").onchange=e=>{S.temp=Math.max(0,Math.min(2,+e.target.value||0));save()};$("thinking").onchange=e=>{S.thinking=e.target.checked;save()};$("apiKey").onchange=e=>{S.key=e.target.value.trim();save()};
thinkingToggleLabel();
$("input").addEventListener("input",e=>{e.target.style.height="auto";e.target.style.height=Math.min(150,e.target.scrollHeight)+"px"});
$("input").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("composer").requestSubmit()}});
$("composer").onsubmit=e=>{e.preventDefault();let x=$("input").value.trim();if(x||pending.length){$("input").value="";$("input").style.height="auto";ask(x)}};
$("send").onclick=()=>{if(S.controller)S.controller.abort()};

// ── File attach UI ──
$("attach").onclick=()=>$("fileInput").click();
$("fileInput").onchange=async e=>{
  const files=[...e.target.files||[]];
  e.target.value="";
  for(const f of files){
    if(pending.length>=8){alert("Máximo 8 adjuntos por mensaje.");break}
    await addPending(f);
  }
  renderPending();
};

async function addPending(file){
  const mime=file.type||"";
  const name=file.name||"file";
  const size=file.size||0;
  if(mime.startsWith("image/")){
    if(pending.filter(p=>p.kind==="image").length>=MAX_IMAGES){alert("Máximo "+MAX_IMAGES+" imágenes.");return}
    try{
      const dataUrl=await compressImage(file);
      pending.push({id:uid(),kind:"image",name,size,mime,dataUrl});
    }catch(err){alert("No se pudo procesar la imagen: "+(err.message||err))}
    return;
  }
  if(mime.startsWith("video/")){
    pending.push({id:uid(),kind:"video",name,size,mime,note:"El video no se envía a la API (sin soporte nativo de video en chat completions). Queda registrado en el mensaje."});
    return;
  }
  // Text-like files
  const textLike=/text\/|\.txt$|\.md$|\.json$|\.csv$|\.js$|\.ts$|\.py$|\.html$|\.css$|\.xml$|\.ya?ml$|\.log$|\.sh$|\.sql$/i.test(mime+" "+name);
  if(textLike){
    try{
      let text=await file.text();
      if(text.length>MAX_TEXT_FILE)text=text.slice(0,MAX_TEXT_FILE)+"\n\n…[truncado]";
      pending.push({id:uid(),kind:"file",name,size,mime,text});
    }catch{pending.push({id:uid(),kind:"file",name,size,mime,note:"No se pudo leer el contenido."})}
    return;
  }
  if(/\.pdf$/i.test(name)||mime==="application/pdf"){
    pending.push({id:uid(),kind:"file",name,size,mime,note:"PDF adjunto (contenido no extraído automáticamente; describe lo que necesites del documento)."});
    return;
  }
  if(/\.docx?$/i.test(name)){
    pending.push({id:uid(),kind:"file",name,size,mime,note:"Documento Word adjunto (sin extracción automática)."});
    return;
  }
  pending.push({id:uid(),kind:"file",name,size,mime,note:"Archivo binario no procesado."});
}

function compressImage(file){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file);
    const img=new Image();
    img.onload=()=>{
      URL.revokeObjectURL(url);
      let w=img.naturalWidth,h=img.naturalHeight;
      const scale=Math.min(1,MAX_IMAGE_SIDE/Math.max(w,h));
      w=Math.round(w*scale);h=Math.round(h*scale);
      const c=document.createElement("canvas");
      c.width=w;c.height=h;
      const ctx=c.getContext("2d");
      ctx.drawImage(img,0,0,w,h);
      let q=0.85;
      let dataUrl=c.toDataURL("image/jpeg",q);
      while(dataUrl.length>MAX_IMAGE_BYTES*1.37&&q>0.45){ // base64 overhead
        q-=0.1;
        dataUrl=c.toDataURL("image/jpeg",q);
      }
      if(dataUrl.length>MAX_IMAGE_BYTES*1.5){
        reject(Error("Imagen demasiado grande incluso tras comprimir."));
        return;
      }
      resolve(dataUrl);
    };
    img.onerror=()=>{URL.revokeObjectURL(url);reject(Error("Formato de imagen no soportado"))};
    img.src=url;
  });
}

function renderPending(){
  const box=$("attachPreview");
  if(!pending.length){box.classList.add("hidden");box.innerHTML="";return}
  box.classList.remove("hidden");
  box.innerHTML=pending.map(p=>{
    if(p.kind==="image"){
      return `<div class="att-chip" data-id="${p.id}"><img src="${p.dataUrl}" alt=""><div class="att-meta"><b>${esc(p.name)}</b><span>${fmtSize(p.size)}</span></div><button type="button" class="att-rm" data-rm="${p.id}">×</button></div>`;
    }
    if(p.kind==="video"){
      return `<div class="att-chip video" data-id="${p.id}"><div class="att-ico">🎥</div><div class="att-meta"><b>${esc(p.name)}</b><span>${fmtSize(p.size)} · no enviado a API</span></div><button type="button" class="att-rm" data-rm="${p.id}">×</button></div>`;
    }
    return `<div class="att-chip file" data-id="${p.id}"><div class="att-ico">📄</div><div class="att-meta"><b>${esc(p.name)}</b><span>${fmtSize(p.size)}${p.note?" · "+esc(p.note.slice(0,40)):""}</span></div><button type="button" class="att-rm" data-rm="${p.id}">×</button></div>`;
  }).join("");
  box.querySelectorAll("[data-rm]").forEach(b=>b.onclick=()=>{
    pending=pending.filter(x=>x.id!==b.dataset.rm);
    renderPending();
  });
}

function buildUserMessage(text){
  const images=pending.filter(p=>p.kind==="image").map(p=>({name:p.name,dataUrl:p.dataUrl,size:p.size}));
  const files=pending.filter(p=>p.kind==="file"||p.kind==="video").map(p=>({
    name:p.name,size:p.size,mime:p.mime,
    text:p.text||null,
    note:p.note||null,
    kind:p.kind
  }));
  // Text body: user text + extracted file contents
  let body=text||"";
  for(const f of files){
    if(f.text){
      body+=(body?"\n\n":"")+`[Archivo: ${f.name}]\n\`\`\`\n${f.text}\n\`\`\``;
    }else if(f.note){
      body+=(body?"\n\n":"")+`[${f.kind==="video"?"Video":"Archivo"}: ${f.name}${f.size?" · "+fmtSize(f.size):""}]\n${f.note}`;
    }
  }
  if(!body&&images.length)body="(imagen adjunta)";
  const msg={role:"user",content:body};
  if(images.length)msg.images=images;
  if(files.length)msg.files=files.map(f=>({name:f.name,size:f.size,mime:f.mime,note:f.note,kind:f.kind})); // don't persist full text twice if already in content
  return msg;
}

function toApiMessages(){
  // Featherless/OpenAI multimodal wire format.
  // IMPORTANT: ask() adds an empty assistant placeholder before this
  // function runs, so checking "last array item" would never find the
  // user's image. Keep image parts on every user message that has them.
  return S.messages.filter(x=>x.role!=="system").map(m=>{
    if(m.role==="user"&&m.images?.length&&modelLikelyVision(S.model)){
      // Featherless recommends text first, then each image separately.
      const parts=[{type:"text",text:m.content||"(imagen adjunta)"}];
      for(const im of m.images){
        if(im?.dataUrl){
          parts.push({
            type:"image_url",
            image_url:{url:im.dataUrl}
          });
        }
      }
      return {role:"user",content:parts};
    }

    // Text-only message, or an image attached to a non-Vision model.
    return {
      role:m.role,
      content:typeof m.content==="string"?m.content:String(m.content||"")
    };
  });
}

async function ask(text){
 if(S.controller)return;
 const hasAtt=pending.length>0;
 if(!text&&!hasAtt)return;

 // Vision guard: images on non-vision model → clear warning
 const imgs=pending.filter(p=>p.kind==="image");
 if(imgs.length&&!modelLikelyVision(S.model)){
   const ok=confirm(
     "El modelo actual probablemente no soporta Vision.\n\n"+
     "Modelo: "+S.model+"\n\n"+
     "Si continúas, las imágenes NO se enviarán como vision (solo se mencionará el nombre). "+
     "Cambia a un modelo con etiqueta Vision (p.ej. Qwen-VL, Gemma-3, Kimi-K3) para analizar imágenes.\n\n"+
     "¿Continuar de todos modos?"
   );
   if(!ok)return;
 }

 const userMsg=buildUserMessage(text);
 pending=[];renderPending();
 S.messages.push(userMsg);trim();
 let a={role:"assistant",content:"",reasoning:"",_streamThinking:false};S.messages.push(a);render();
 $("typing").classList.remove("hidden");$("send").classList.add("stop");$("send").textContent="■";$("input").disabled=true;
 const started=performance.now();S.controller=new AbortController();
 let thinkStarted=null,thinkEnded=null;
 try{
  trim();
  const inputTokens=tokens()+systemTokens();
  const available=Math.max(256,32768-inputTokens-1000);
  const apiMsgs=toApiMessages();
  // Featherless: use chat_template_kwargs for thinking (docs). Synonyms: enable_thinking / thinking / do_reasoning
  const body={model:S.model,messages:[{role:"system",content:S.system},...apiMsgs],max_tokens:Math.min(S.max,available),temperature:S.temp,stream:true};
  if(S.thinking){
    body.chat_template_kwargs={enable_thinking:true};
    // Also set extra_body for clients that only forward extra_body; harmless if ignored
    body.extra_body={chat_template_kwargs:{enable_thinking:true},enable_thinking:true};
  }else if(modelLikelyThinking(S.model)){
    // Explicitly disable when user turns Thinking off on controllable models
    body.chat_template_kwargs={enable_thinking:false};
    body.extra_body={chat_template_kwargs:{enable_thinking:false},enable_thinking:false};
  }
  const base = (typeof window !== "undefined" && window.FEATHERLESS_BASE) || "https://api.featherless.ai/v1";
  if (!S.key && !base.startsWith("/")) {
    throw Error("Pon tu API key de Featherless en el menú (☰ → API key). Se guarda solo en este iPhone.");
  }
  const headers = {
    "Content-Type": "application/json",
    "HTTP-Referer": location.origin || "https://featherless-chat.local",
    "X-Title": "Featherless Chat OLED"
  };
  if (S.key) headers["Authorization"] = "Bearer " + S.key;
  const r=await fetch(base + "/chat/completions",{method:"POST",headers,body:JSON.stringify(body),signal:S.controller.signal});
  if(!r.ok){
    const errText=await r.text();
    let friendly=errText;
    try{const j=JSON.parse(errText);friendly=j.error?.message||j.message||errText}catch{}
    if(/vision|image|multimodal|modalit/i.test(friendly)&&userMsg.images?.length){
      throw Error("Este modelo no acepta imágenes. Elige un modelo Vision en el catálogo de Featherless. Detalle: "+friendly.slice(0,180));
    }
    throw Error(friendly.slice(0,400));
  }
  const reader=r.body.getReader(),dec=new TextDecoder();let buf="",usage=null;
  // Streaming state for <think> tags when reasoning comes inside content
  let inThinkTag=false, rawContentAccum="";
  function appendReasoning(piece){
    if(!piece)return;
    if(!thinkStarted)thinkStarted=performance.now();
    a.reasoning=(a.reasoning||"")+piece;
    a._streamThinking=true;
    render();
  }
  function appendAnswer(piece){
    if(!piece)return;
    if(a._streamThinking){
      a._streamThinking=false;
      if(thinkStarted&&thinkEnded==null)thinkEnded=performance.now();
    }
    a.content+=piece;
    render();
  }
  function processContentDelta(c){
    // Some models emit reasoning as <think>...</think> inside content; split live
    rawContentAccum+=c;
    let safety=0;
    while(safety++<50){
      if(!inThinkTag){
        const open=rawContentAccum.search(/<\s*think\s*>/i);
        if(open===-1){
          // no open tag; if we already finished thinking, rest is answer; else hold if partial tag possible
          const partial=/<\s*t?h?i?n?k?\s*$/i.test(rawContentAccum);
          if(partial)break;
          appendAnswer(rawContentAccum);
          rawContentAccum="";
          break;
        }
        const before=rawContentAccum.slice(0,open);
        if(before)appendAnswer(before);
        rawContentAccum=rawContentAccum.slice(open).replace(/^<\s*think\s*>/i,"");
        inThinkTag=true;
        a._streamThinking=true;
        if(!thinkStarted)thinkStarted=performance.now();
      }else{
        const close=rawContentAccum.search(/<\s*\/\s*think\s*>/i);
        if(close===-1){
          const partial=/<\s*\/?\s*t?h?i?n?k?\s*$/i.test(rawContentAccum);
          if(partial){
            // flush safe prefix before possible partial close tag
            const m=rawContentAccum.match(/^(.*)(<\s*\/?\s*t?h?i?n?k?\s*)$/i);
            if(m&&m[1]){appendReasoning(m[1]);rawContentAccum=m[2]}
            break;
          }
          appendReasoning(rawContentAccum);
          rawContentAccum="";
          break;
        }
        appendReasoning(rawContentAccum.slice(0,close));
        rawContentAccum=rawContentAccum.slice(close).replace(/^<\s*\/\s*think\s*>/i,"");
        inThinkTag=false;
        a._streamThinking=false;
        if(thinkStarted&&thinkEnded==null)thinkEnded=performance.now();
      }
    }
  }
  while(1){let {value,done}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});let lines=buf.split("\n");buf=lines.pop();
   for(let line of lines){if(!line.startsWith("data:"))continue;let raw=line.slice(5).trim();if(raw==="[DONE]")continue;try{
     let d=JSON.parse(raw);
     const delta=d.choices?.[0]?.delta||{};
     // Prefer dedicated reasoning fields (OpenAI-like / Featherless normalized)
     const rPiece=delta.reasoning_content||delta.reasoning||delta.reasoning_text||d.choices?.[0]?.message?.reasoning_content||"";
     if(rPiece)appendReasoning(rPiece);
     if(delta.content)processContentDelta(delta.content);
     if(d.usage)usage=d.usage;
   }catch{}}
  }
  // Flush any leftover content buffer
  if(rawContentAccum){
    if(inThinkTag)appendReasoning(rawContentAccum);
    else appendAnswer(rawContentAccum);
    rawContentAccum="";
  }
  a._streamThinking=false;
  if(thinkStarted&&thinkEnded==null)thinkEnded=performance.now();
  if(thinkStarted)a.reasoningSec=((thinkEnded||performance.now())-thinkStarted)/1000;
  // Strip accidental leftover think tags from final content
  if(a.content)a.content=a.content.replace(/<\s*think\s*>[\s\S]*?<\s*\/\s*think\s*>/gi,"").replace(/<\s*\/?\s*think\s*>/gi,"").trim();
  let sec=(performance.now()-started)/1000,p=usage?.prompt_tokens||estimate(S.messages.slice(0,-1).map(x=>x.content).join("\n")),c=usage?.completion_tokens||estimate(a.content)+(a.reasoning?estimate(a.reasoning):0),t=usage?.total_tokens||p+c;
  const thinkNote=a.reasoningSec!=null?` · razonó ${a.reasoningSec.toFixed(1)}s`:"";
  a.meta=`${sec.toFixed(2)}s${thinkNote} · ${p.toLocaleString()} prompt · ${c.toLocaleString()} respuesta · ${(c/Math.max(sec,.001)).toFixed(1)} tok/s`;
  S.stats.requests++;S.stats.prompt+=p;S.stats.completion+=c;S.stats.total+=t;S.last={sec,p,c,t,tps:c/Math.max(sec,.001),reasoningSec:a.reasoningSec};
  if(S.messages.filter(x=>x.role==="user").length===1)$("chatName").textContent=(text||userMsg.content||"Adjuntos").slice(0,35)+((text||userMsg.content||"").length>35?"…":"");
  trim();save();render();
 }catch(e){S.messages.pop();if(e.name!=="AbortError")S.messages.push({role:"assistant",content:"⚠️ "+e.message});save();render()}
 finally{S.controller=null;$("typing").classList.add("hidden");$("send").classList.remove("stop");$("send").textContent="↑";$("input").disabled=false;$("input").focus()}
}
function modal(title,html){$("dialogTitle").textContent=title;$("dialogBody").innerHTML=html;$("dialog").showModal()}
document.querySelector("[data-close]").onclick=()=>$("dialog").close();
$("system").onclick=()=>{drawer(false);modal("System prompt",`<textarea id="sysEdit" class="dialog-textarea"></textarea><div class="dialog-actions"><button class="secondary" id="cancel">Cancelar</button><button class="primary" id="saveSys">Guardar</button></div>`);$("sysEdit").value=S.system;$("cancel").onclick=()=>$("dialog").close();$("saveSys").onclick=()=>{S.system=$("sysEdit").value.trim()||DEFAULT_SYSTEM;save();$("dialog").close()}};
$("stats").onclick=()=>{drawer(false);let x=S.last;modal("Estadísticas",`<div class="statgrid"><div class="stat"><b>${S.stats.requests}</b><span>Peticiones</span></div><div class="stat"><b>${S.stats.total.toLocaleString()}</b><span>Tokens totales</span></div><div class="stat"><b>${S.stats.prompt.toLocaleString()}</b><span>Prompt</span></div><div class="stat"><b>${S.stats.completion.toLocaleString()}</b><span>Completion</span></div>${x?`<div class="stat"><b>${x.tps.toFixed(1)}</b><span>tok/s última</span></div><div class="stat"><b>${x.sec.toFixed(2)}s</b><span>latencia</span></div>`:""}</div>`)};
$("importJSON").onclick=()=>$("jsonFile").click();
$("jsonFile").onchange=e=>{if(e.target.files[0]){importJSON(e.target.files[0]);e.target.value=""}};
$("saveConversation").onclick=()=>{let all=JSON.parse(localStorage.getItem(K+"saved")||"[]"),name=$("chatName").textContent==="New conversation"?(S.messages.find(x=>x.role==="user")?.content||"Conversation").slice(0,45):$("chatName").textContent;all.unshift({name,date:Date.now(),messages:S.messages});localStorage.setItem(K+"saved",JSON.stringify(all));refreshSaved();alert("Guardada")};
function refreshSaved(){let all=JSON.parse(localStorage.getItem(K+"saved")||"[]");$("conversationList").innerHTML=all.slice(0,15).map((x,i)=>`<button class="conv" data-i="${i}">${esc(x.name)}<small>${new Date(x.date).toLocaleString()}</small></button>`).join("");document.querySelectorAll(".conv").forEach(b=>b.onclick=()=>{S.messages=all[+b.dataset.i].messages;save();$("chatName").textContent=all[+b.dataset.i].name;render();drawer(false)})}
$("export").onclick=()=>{let blob=new Blob([JSON.stringify({model:S.model,context:32768,max_output:S.max,temperature:S.temp,thinking:S.thinking,system:S.system,messages:S.messages},null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="featherless-chat.json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)};
render();refreshSaved();
