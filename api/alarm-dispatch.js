const headers=key=>{const result={apikey:key,"Content-Type":"application/json"};if(!key.startsWith("sb_secret_")&&!key.startsWith("sb_publishable_"))result.Authorization=`Bearer ${key}`;return result};

module.exports=async function handler(request,response){
  if(!["GET","POST"].includes(request.method)){response.setHeader("Allow","GET, POST");return response.status(405).json({error:"Método no permitido"})}
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY,botToken=process.env.TELEGRAM_BOT_TOKEN,chatId=process.env.TELEGRAM_CHAT_ID;
  if(!url||!key||!botToken||!chatId)return response.status(503).json({error:"Alarmas no configuradas"});
  const endpoint=`${url.replace(/\/$/,"")}/rest/v1/app_state?id=eq.1`;
  try{
    const read=await fetch(`${endpoint}&select=state,updated_at`,{headers:headers(key)}),data=await read.json();if(!read.ok)throw new Error("read");const state=data[0]?.state||{},alarms=Array.isArray(state.alarms)?state.alarms:[],now=Date.now();alarms.forEach(alarm=>{if(alarm.status==="processing"&&now-new Date(alarm.processingAt||0).getTime()>120000)alarm.status="pending"});const due=alarms.filter(alarm=>alarm.status==="pending"&&new Date(`${alarm.date}T${alarm.time}:00-05:00`).getTime()<=now);
    let sent=0;
    for(const alarm of due){
      alarm.status="processing";alarm.processingAt=new Date().toISOString();await saveState(endpoint,key,state);
      const text=["⏰ ALARMA OPERATIVA","",`📅 Fecha: ${alarm.date}`,`🕒 Hora: ${alarm.time}`,`📢 ${String(alarm.message||"").replace(/[<>]/g,"").slice(0,1000)}`,"📍 Estación Reductora Pascuales"].join("\n");
      const telegram=await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:chatId,text})}),telegramData=await telegram.json();
      if(telegram.ok&&telegramData.ok){alarm.status="sent";alarm.sentAt=new Date().toISOString();sent++}else alarm.status="pending";
      delete alarm.processingAt;await saveState(endpoint,key,state);
    }
    return response.status(200).json({ok:true,checked:alarms.length,sent});
  }catch(error){return response.status(502).json({error:"No se pudieron verificar las alarmas"})}
};

async function saveState(endpoint,key,state){const result=await fetch(endpoint,{method:"PATCH",headers:{...headers(key),Prefer:"return=minimal"},body:JSON.stringify({state,updated_at:new Date().toISOString()})});if(!result.ok)throw new Error("save")}
