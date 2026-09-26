import { env } from '../config/env';
export function ttsProvider(): 'elevenlabs'|'chatterbox'|'browser' {
  if(env.TTS_PROVIDER==='chatterbox' && env.CHATTERBOX_TTS_URL)return 'chatterbox';
  if(env.TTS_PROVIDER==='elevenlabs' && env.ELEVENLABS_API_KEY)return 'elevenlabs';
  if(env.CHATTERBOX_TTS_URL)return 'chatterbox';
  if(env.ELEVENLABS_API_KEY)return 'elevenlabs';
  return 'browser';
}
export async function synthesizeSpeech(text:string):Promise<{provider:string;audio:Buffer|null;contentType?:string}> {
  const preferred=ttsProvider();
  if(preferred==='chatterbox'){
    try{const c=new AbortController();const t=setTimeout(()=>c.abort(),15000);const r=await fetch(env.CHATTERBOX_TTS_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,voice:'female',language:'en'}),signal:c.signal});clearTimeout(t);if(r.ok)return{provider:'chatterbox',audio:Buffer.from(await r.arrayBuffer()),contentType:r.headers.get('content-type')||'audio/wav'}}catch{}
  }
  if(preferred==='elevenlabs'){
    try{const c=new AbortController();const t=setTimeout(()=>c.abort(),15000);const r=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${env.ELEVENLABS_VOICE_ID}`,{method:'POST',headers:{'xi-api-key':env.ELEVENLABS_API_KEY,'Content-Type':'application/json',Accept:'audio/mpeg'},body:JSON.stringify({text,model_id:env.ELEVENLABS_MODEL_ID,voice_settings:{stability:.45,similarity_boost:.85,style:.35,use_speaker_boost:true}}),signal:c.signal});clearTimeout(t);if(r.ok)return{provider:'elevenlabs',audio:Buffer.from(await r.arrayBuffer()),contentType:'audio/mpeg'};clearTimeout(t)}catch{}
  }
  // If the selected cloud/local provider is unavailable, try the other one.
  if(preferred!=='chatterbox' && env.CHATTERBOX_TTS_URL){try{const r=await fetch(env.CHATTERBOX_TTS_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,voice:'female',language:'en'})});if(r.ok)return{provider:'chatterbox',audio:Buffer.from(await r.arrayBuffer()),contentType:r.headers.get('content-type')||'audio/wav'}}catch{}}
  if(preferred!=='elevenlabs' && env.ELEVENLABS_API_KEY){try{const r=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${env.ELEVENLABS_VOICE_ID}`,{method:'POST',headers:{'xi-api-key':env.ELEVENLABS_API_KEY,'Content-Type':'application/json',Accept:'audio/mpeg'},body:JSON.stringify({text,model_id:env.ELEVENLABS_MODEL_ID})});if(r.ok)return{provider:'elevenlabs',audio:Buffer.from(await r.arrayBuffer()),contentType:'audio/mpeg'}}catch{}}
  return{provider:'browser',audio:null};
}
