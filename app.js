const APP_VERSION="09-10-2026.FIN-PARTIDA-MANUAL1",PIPE_KM=127,COLORS=["#bdff4a","#24d6d1","#ffb84d","#bda7ff","#ff7b68","#62a8ff","#f279c6","#85d37d","#ffd966"],RESET_PASSWORD_HASH="5ac7aedbdae6f169cc882722963e3d3f29fe6b3aaa6e1303064f06bacc23b7af";
const initialRows=[{batch:"126",product:"JET A1",sent:7367,received:1608},{batch:"127",product:"DESTILADO",sent:101,received:0},{batch:"128",product:"DIESEL OIL",sent:36850,received:0}];
const PRODUCTS=["JET A1","DIESEL OIL","DIESEL PREMIUM","DESTILADO","GASOLINA EXTRA","GASOLINA ECOPAÍS","GASOLINA SÚPER","NAFTA RON 80","NAFTA RON 95","PREMIUM IMP","PREMEZCLA","GASOLINA BASE LIB","GASOLINA BASE ESM"];
let rows=structuredClone(initialRows),tankRecords=[],forecastFlow=0,flowManuallyEdited=false,accumulationResetIndex=0,editingTankRecordIndex=null;
let operationStatus={status:"running",since:null,reason:""},operationHistory=[],telegramAlertsSent=[],syncReady=false,syncSaveTimer=null,lastRemoteUpdate=null,localChangesPending=false;
let alarms=[],editingAlarmId=null;
const $=s=>document.querySelector(s),parseNumber=v=>{if(typeof v==="number")return v;const text=String(v??"").trim().replace(/\s/g,"");if(!text)return 0;if(text.includes(","))return Number(text.replace(/\./g,"").replace(",","."));if(/^\d{1,3}(\.\d{3})+$/.test(text))return Number(text.replace(/\./g,""));return Number(text)},safeNumber=v=>Math.max(0,parseNumber(v)||0),optionalNumber=v=>String(v??"").trim()===""?null:safeNumber(v),fmt=(n,d=0)=>new Intl.NumberFormat("es-EC",{maximumFractionDigits:d,minimumFractionDigits:d}).format(n);
const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const formatRecordDate=value=>{const match=String(value||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);return match?`${match[3]}/${match[2]}/${match[1]}`:"—"};
async function verifyResetPassword(){const password=window.prompt("Ingrese la contraseña para restablecer todos los valores:");if(password===null)return false;try{const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(password)),hash=[...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,"0")).join("");if(hash===RESET_PASSWORD_HASH)return true}catch(error){console.warn("No se pudo verificar la contraseña",error)}window.alert("Contraseña incorrecta. No se borró ningún dato.");return false}
const productForRecord=record=>record.product||rows.find(row=>String(row.batch||"").trim().toLowerCase()===String(record.batchEquivalent||"").trim().toLowerCase())?.product||"—";

function elapsedHours(a,b){const m=v=>{const[h,x]=v.split(":").map(Number);return h*60+x};let d=m(b)-m(a);if(d<=0)d+=1440;return d/60}
function addOneHour(t){const[h,m]=t.split(":").map(Number);return`${String((h+1)%24).padStart(2,"0")}:${String(m).padStart(2,"0")}`}
function estimatedFinish(startTime,hours){
  if(!startTime||!Number.isFinite(hours)||hours<=0)return{time:"—",label:"Sin caudal disponible"};
  const parts=startTime.split(":").map(Number),h=parts[0]||0,m=parts[1]||0,s=parts[2]||0,added=Math.round(hours*3600),total=h*3600+m*60+s+added,days=Math.floor(total/86400),seconds=total%86400,time=`${String(Math.floor(seconds/3600)).padStart(2,"0")}:${String(Math.floor((seconds%3600)/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`;
  return{time,label:`${time}${days===1?" · mañana":days>1?` · en ${days} días`:""}`};
}
function durationText(hours){const totalSeconds=Math.round(hours*3600),h=Math.floor(totalSeconds/3600),m=Math.floor((totalSeconds%3600)/60),s=totalSeconds%60;return`${h} h ${String(m).padStart(2,"0")} min ${String(s).padStart(2,"0")} s`}
function applyTransferredVolume(volume,batchEquivalent=""){
  if(volume<=0||!rows.length)return 0;
  rows.at(-1).sent=safeNumber(rows.at(-1).sent)+volume;
  let targetIndex=rows.findIndex(row=>String(row.batch||"").trim().toLowerCase()===String(batchEquivalent||"").trim().toLowerCase());if(targetIndex<0)targetIndex=0;
  rows[targetIndex].received=safeNumber(rows[targetIndex].received)+volume;
  return 0;
}

function tankCalculation(prefix=""){
  const tank=$("#tankSelect")?.value,c=window.TANK_CALIBRATION?.[tank];
  if(!c)return{valid:false,message:"Seleccione un tanque disponible."};
  const id=part=>`#${prefix?`${prefix}Level${part}`:`level${part}`}`,meters=Math.floor(safeNumber($(id("Meters"))?.value)),centimeters=Math.min(99,Math.floor(safeNumber($(id("Centimeters"))?.value))),millimeters=Math.min(9,Math.floor(safeNumber($(id("Millimeters"))?.value))),cm=meters*100+centimeters;
  if(cm>c.maxCm)return{valid:false,message:`El nivel supera el máximo operativo de ${fmt(c.maxCm/100,2)} m para el TP-${tank}.`};
  const gallons=c.volumes[cm]+c.mmCorrections[millimeters];
  return{valid:Number.isFinite(gallons),tank,levelM:cm/100+millimeters/1000,gallons,barrels:gallons/42,message:"Lectura dentro del rango de la tabla de aforo."};
}

function renderTankModule(){
  if(!$("#tankSelect"))return;
  const selectedBatch=$("#batchEquivalentInput")?.value.trim().toLowerCase(),selectedProduct=rows.find(row=>String(row.batch||"").trim().toLowerCase()===selectedBatch)?.product||"—",calc=tankCalculation(),base=tankCalculation("initial"),initial=safeNumber($("#initialTankAccumulated")?.value),accumulated=initial+tankRecords.filter(record=>String(record.batchEquivalent||"").trim().toLowerCase()===selectedBatch).reduce((s,r)=>s+safeNumber(r.receivedBbl),0),last=[...tankRecords].reverse().find(r=>r.tank===$("#tankSelect").value),received=calc.valid&&base.valid?Math.round(Math.max(0,calc.gallons-base.gallons)/42):0,flow=received,shownReceived=received>0?received:(last?.receivedBbl||0);
  $("#tankProductDisplay").textContent=selectedProduct;
  $("#tankAccumulatedDisplay").innerHTML=`${fmt(accumulated)} <small>BBL</small>`;$("#tankReceivedDisplay").innerHTML=`${fmt(shownReceived)} <small>BBL</small>`;$("#tankFlowDisplay").innerHTML=`${fmt(flow)} <small>BBL/H</small>`;$("#currentCalculatedFlow").innerHTML=`${fmt(last?.receivedBbl||0)} <small>BBL/H</small>`;$("#tankHistoryEmpty").hidden=tankRecords.length>0;
  $("#tankHistory").innerHTML=tankRecords.map((r,index)=>editingTankRecordIndex===index?`<tr class="tank-edit-row"><td><input data-tank-edit="time" type="time" value="${r.time||""}"></td><td><input data-tank-edit="suctionPsi" inputmode="numeric" value="${Math.round(r.suctionPsi??0)}"></td><td><input data-tank-edit="apiDegree" inputmode="decimal" value="${r.apiDegree??""}"></td><td><input data-tank-edit="temperature" inputmode="decimal" value="${r.temperature??""}"></td><td><input data-tank-edit="batchEquivalent" value="${r.batchEquivalent||""}"></td><td><input data-tank-edit="product" value="${escapeHtml(productForRecord(r))}"></td><td><input data-tank-edit="tank" value="${r.tank||""}"></td><td><input data-tank-edit="levelM" inputmode="decimal" value="${r.levelM}"></td><td><input data-tank-edit="gallons" inputmode="decimal" value="${r.gallons}"></td><td><input data-tank-edit="receivedBbl" inputmode="decimal" value="${r.receivedBbl}"></td><td><input value="${r.receivedBbl}" readonly title="El caudal siempre es igual al recibido BBL"></td><td><input data-tank-edit="accumulatedBbl" inputmode="decimal" value="${r.accumulatedBbl}"></td><td><textarea data-tank-edit="observation" rows="2">${escapeHtml(r.observation||"")}</textarea></td><td class="tank-row-actions"><button class="history-action save" data-save-tank-record="${index}" type="button">Guardar</button><button class="history-action" data-cancel-tank-edit type="button">Cancelar</button></td></tr>`:`<tr><td>${String(r.time||"").replace(":","h")}</td><td>${r.suctionPsi==null?"—":`${fmt(Math.round(r.suctionPsi))} PSI`}</td><td>${r.apiDegree==null||r.apiDegree===""?"—":fmt(r.apiDegree,1)}</td><td>${r.temperature==null||r.temperature===""?"—":`${fmt(r.temperature,1)} °F`}</td><td>${r.batchEquivalent||"—"}</td><td>${escapeHtml(productForRecord(r))}</td><td>TP-${String(r.tank||"").padStart(2,"0")}</td><td>${fmt(r.levelM,3)} m</td><td>${fmt(r.gallons)} GLS</td><td>${fmt(r.receivedBbl)} BBL</td><td>${fmt(r.receivedBbl)} BBL/H</td><td>${fmt(r.accumulatedBbl)} BBL</td><td class="tank-observation-cell">${escapeHtml(r.observation||"—")}</td><td class="tank-row-actions"><button class="history-action" data-edit-tank-record="${index}" type="button">Editar</button><button class="history-action delete" data-delete-tank-record="${index}" type="button">Eliminar</button></td></tr>`).join("");
  $("#tankHistory").querySelectorAll("tr").forEach((row,index)=>{const record=tankRecords[index],cell=document.createElement("td");if(editingTankRecordIndex===index)cell.innerHTML=`<input data-tank-edit="date" type="date" value="${record.date||""}">`;else cell.textContent=formatRecordDate(record.date);row.prepend(cell)});
  if(!calc.valid){$("#tankLevelDisplay").textContent="Fuera de rango";$("#tankGallonsDisplay").innerHTML="— <small>GLS</small>";$("#tankReceivedDisplay").innerHTML="— <small>BBL</small>";$("#tankFlowDisplay").innerHTML="— <small>BBL/H</small>";$("#tankMessage").textContent=calc.message;$("#tankMessage").className="transfer-message";return}
  $("#tankLevelDisplay").textContent=`${fmt(calc.levelM,3)} m`;$("#tankGallonsDisplay").innerHTML=`${fmt(calc.gallons)} <small>GLS</small>`;$("#tankMessage").textContent=calc.message;
}

function recalculateTankAccumulated(){
  let accumulated=safeNumber($("#initialTankAccumulated")?.value);
  tankRecords.forEach((record,index)=>{record.flowBph=safeNumber(record.receivedBbl);if(index>=accumulationResetIndex){accumulated+=safeNumber(record.receivedBbl);record.accumulatedBbl=accumulated}});
}
function recalculateTankAccumulatedForBatch(batchEquivalent){
  const selected=String(batchEquivalent||"").trim().toLowerCase();if(!selected)return;
  let accumulated=safeNumber($("#initialTankAccumulated")?.value);
  tankRecords.forEach(record=>{if(String(record.batchEquivalent||"").trim().toLowerCase()!==selected)return;record.flowBph=safeNumber(record.receivedBbl);accumulated+=safeNumber(record.receivedBbl);record.accumulatedBbl=accumulated});
}

async function checkTelegramAlert(normalized){
  const first=normalized.find(r=>r.remaining>0);if(!first||first.remaining>1000)return;
  const key=`telegram-alert-${first.batch||first.product}`;if(telegramAlertsSent.includes(key))return;telegramAlertsSent.push(key);
  try{const response=await fetch("/api/telegram-alert",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({batch:first.batch||"Sin número",product:first.product||"Sin producto",remaining:Math.round(first.remaining)})});if(!response.ok)throw new Error("No se pudo enviar la alerta");scheduleStateSave()}catch(error){telegramAlertsSent=telegramAlertsSent.filter(item=>item!==key);console.warn("Alerta de Telegram pendiente:",error.message)}
}

async function publishTelegramFlow({flowBph,time,batchEquivalent,tank,product,sent,received,accumulated,remaining}){
  try{
    const hours=flowBph>0?remaining/flowBph:0,finish=estimatedFinish(time,hours),timeRemaining=flowBph>0?durationText(hours):"Sin caudal disponible";
    const response=await fetch("/api/telegram-alert",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"flow",flow:Math.round(flowBph),time,batch:batchEquivalent||"Sin número",tank:`TP-${String(tank).padStart(2,"0")}`,product,sent,received,accumulated,remaining,timeRemaining,estimatedEnd:finish.label})});
    if(!response.ok)throw new Error("No se pudo publicar el caudal");
  }catch(error){console.warn("Publicación de caudal en Telegram pendiente:",error.message)}
}

async function publishOperationStatus(payload){
  try{const response=await fetch("/api/telegram-alert",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"operation",...payload})});if(!response.ok)throw new Error("No se pudo publicar el estado")}
  catch(error){console.warn("Publicación del estado operativo pendiente:",error.message)}
}

const persistedFieldIds=["tankSelect","batchEquivalentInput","apiDegreeInput","temperatureInput","initialTankAccumulated","initialTankTime","tankDate","tankTime","suctionPsiInput","tankObservationInput","initialLevelMeters","initialLevelCentimeters","initialLevelMillimeters","levelMeters","levelCentimeters","levelMillimeters","stopReason","operationTime","operationObservation"];
function captureState(){const fields={};persistedFieldIds.forEach(id=>{const element=document.getElementById(id);if(element)fields[id]=element.value});return{version:1,rows,tankRecords,forecastFlow,flowManuallyEdited,accumulationResetIndex,operationStatus,operationHistory,telegramAlertsSent,alarms,fields}}
function applySharedState(state){
  if(!state||typeof state!=="object"||!Object.keys(state).length)return false;
  if(Array.isArray(state.rows))rows=state.rows.slice(0,100);if(Array.isArray(state.tankRecords))tankRecords=state.tankRecords.slice(-2000).map(record=>({...record,flowBph:safeNumber(record.receivedBbl)}));flowManuallyEdited=Boolean(state.flowManuallyEdited);forecastFlow=flowManuallyEdited?safeNumber(state.forecastFlow):safeNumber(tankRecords.at(-1)?.receivedBbl);accumulationResetIndex=Math.min(tankRecords.length,Math.max(0,Number(state.accumulationResetIndex)||0));
  if(state.operationStatus&&typeof state.operationStatus==="object")operationStatus=state.operationStatus;if(Array.isArray(state.operationHistory))operationHistory=state.operationHistory.slice(-500);if(Array.isArray(state.telegramAlertsSent))telegramAlertsSent=state.telegramAlertsSent.slice(-500);
  if(Array.isArray(state.alarms))alarms=state.alarms.slice(-500);
  Object.entries(state.fields||{}).forEach(([id,value])=>{const element=document.getElementById(id);if(element)element.value=value});return true;
}
function setSyncStatus(text){const element=$("#syncStatus");if(element){element.textContent=text;element.title=`Versión ${APP_VERSION}`}}
function scheduleStateSave(){if(!syncReady)return;localChangesPending=true;clearTimeout(syncSaveTimer);syncSaveTimer=setTimeout(saveSharedState,700)}
async function saveSharedState(){
  syncSaveTimer=null;
  setSyncStatus("Guardando…");
  try{const response=await fetch(`/api/app-state?t=${Date.now()}`,{method:"PUT",cache:"no-store",headers:{"Content-Type":"application/json","Cache-Control":"no-cache"},body:JSON.stringify({state:captureState()})});if(!response.ok)throw new Error();const data=await response.json();lastRemoteUpdate=data.updated_at;localChangesPending=false;setSyncStatus("Datos sincronizados")}
  catch(error){setSyncStatus("Sin conexión para guardar · reintentando");if(!syncSaveTimer)syncSaveTimer=setTimeout(saveSharedState,5000)}
}
async function loadSharedState(showStatus=true){
  if(showStatus)setSyncStatus("Cargando datos…");
  try{const response=await fetch(`/api/app-state?t=${Date.now()}`,{cache:"no-store",headers:{"Cache-Control":"no-cache"}});if(!response.ok)throw new Error();const data=await response.json();const changed=data.updated_at&&data.updated_at!==lastRemoteUpdate;if(changed&&applySharedState(data.state)){lastRemoteUpdate=data.updated_at;render()}if(showStatus)setSyncStatus("Datos sincronizados");return Boolean(data.updated_at)}
  catch(error){if(showStatus)setSyncStatus("Modo local");return false}
}

function calculations(){const normalized=rows.map((r,index)=>({...r,index,remaining:Math.max(0,safeNumber(r.sent)-safeNumber(r.received))})),total=normalized.reduce((s,r)=>s+r.remaining,0);let cursor=0;const segments=[...normalized].reverse().map(r=>{const length=total?r.remaining/total*PIPE_KM:0,result={...r,start:cursor,end:cursor+length,length,percent:total?r.remaining/total*100:0};cursor+=length;return result});return{normalized,segments,total}}
function input(value,field,index,type="text"){const numeric=type==="number",shown=numeric?fmt(safeNumber(value)):String(value);return`<input type="text" ${numeric?'inputmode="numeric" data-numeric="true"':''} value="${shown.replaceAll('"','&quot;')}" data-index="${index}" data-field="${field}" aria-label="${field} fila ${index+1}">`}
function productSelect(value,index){const current=String(value||"").toUpperCase(),options=PRODUCTS.includes(current)?PRODUCTS:[current,...PRODUCTS].filter(Boolean);return`<select class="product-select" data-index="${index}" data-field="product" aria-label="Producto fila ${index+1}">${options.map(product=>`<option value="${product}"${product===current?" selected":""}>${product}</option>`).join("")}</select>`}

function renderForecast(){
  const first=calculations().normalized[0],remaining=first?.remaining||0,hours=forecastFlow>0?remaining/forecastFlow:0,selectedTank=$("#tankSelect")?.value,lastTankRecord=[...tankRecords].reverse().find(record=>record.tank===selectedTank),startTime=lastTankRecord?.time||$("#tankTime")?.value||new Date().toTimeString().slice(0,8),finish=estimatedFinish(startTime,hours);
  $("#firstBatchName").textContent=first?`Partida ${first.batch||"—"} · ${first.product||"Sin producto"}`:"No existen partidas";
  if(document.activeElement!==$("#firstBatchRemainingInput"))$("#firstBatchRemainingInput").value=Math.round(remaining);
  if(document.activeElement!==$("#forecastFlowInput"))$("#forecastFlowInput").value=Math.round(forecastFlow);
  if(document.activeElement!==$("#forecastHoursInput"))$("#forecastHoursInput").value=hours?hours.toFixed(3):0;
  $("#forecastTimeDisplay").textContent=forecastFlow>0?durationText(hours):"Sin caudal disponible";
  $("#forecastFinishDisplay").textContent=forecastFlow>0?finish.label:"Sin caudal disponible";
  $("#currentCalculatedFlow").innerHTML=`${fmt(forecastFlow)} <small>BBL/H</small>`;
}

function renderOperationStatus(){
  const stopped=operationStatus.status==="stopped",badge=$("#operationStatusBadge");
  $("#operationStatusText").textContent=stopped?`Paralizado · ${operationStatus.reason||"Sin motivo"}`:"Operación normal";badge.textContent=stopped?"PARALIZADO":"EN OPERACIÓN";badge.className=`operation-badge ${stopped?"stopped":"running"}`;
  $("#stopOperation").disabled=stopped;$("#resumeOperation").disabled=!stopped;$("#operationHistoryEmpty").hidden=operationHistory.length>0;
  $("#operationHistory").innerHTML=[...operationHistory].reverse().map(event=>`<div class="operation-event"><strong>${event.status==="stopped"?"⏸ Paralización":"▶ Reinicio"}</strong><span>${event.time?.replace(":","h")||"—"}</span><div>${event.status==="stopped"?(event.reason||"Sin motivo"):(event.duration?`Tiempo detenido: ${event.duration}`:"Operación restablecida")}${event.observation?`<small>${event.observation}</small>`:""}</div></div>`).join("");
  const printReport=$("#printStopReport"),printHistory=$("#printOperationHistory");
  if(printReport&&printHistory){printReport.hidden=operationHistory.length===0;printHistory.innerHTML=operationHistory.map(event=>`<tr><td>${event.status==="stopped"?"PARALIZACIÓN":"REINICIO"}</td><td>${escapeHtml(event.time?.replace(":","h")||"—")}</td><td>${escapeHtml(event.status==="stopped"?(event.reason||"Sin motivo"):(event.duration?`Tiempo detenido: ${event.duration}`:"Operación restablecida"))}</td><td>${escapeHtml(event.observation||"—")}</td></tr>`).join("")}
}

function renderAlarms(){
  const list=$("#alarmList"),empty=$("#alarmEmpty");if(!list||!empty)return;empty.hidden=alarms.length>0;
  list.innerHTML=[...alarms].sort((a,b)=>`${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`)).map(alarm=>`<div class="alarm-item"><div class="alarm-icon">⏰</div><div><strong>${escapeHtml(alarm.date||"—")} · ${escapeHtml(alarm.time||"—")}</strong><p>${escapeHtml(alarm.message||"SIN MENSAJE")}</p><small class="alarm-${alarm.status||"pending"}">${alarm.status==="sent"?"ENVIADA":alarm.status==="cancelled"?"CANCELADA":"PENDIENTE"}</small></div><div class="alarm-actions">${alarm.status==="pending"?`<button class="history-action" data-edit-alarm="${escapeHtml(alarm.id)}" type="button">Editar</button><button class="history-action alarm-cancel" data-cancel-alarm="${escapeHtml(alarm.id)}" type="button">Cancelar</button>`:""}</div></div>`).join("");
}

function render(){
  const{normalized,segments,total}=calculations();checkTelegramAlert(normalized);
  $("#productRows").innerHTML=normalized.map((r,i)=>`<tr><td>${input(r.batch,"batch",i)}</td><td>${productSelect(r.product,i)}</td><td>${input(r.sent,"sent",i,"number")}</td><td>${input(r.received,"received",i,"number")}</td><td class="calculated">${fmt(r.remaining)}</td><td><button class="remove" data-remove="${i}" aria-label="Eliminar fila">×</button></td></tr>`).join("");
  $("#totalVolume").innerHTML=`${fmt(total)} <small>u</small>`;$("#activeProducts").textContent=normalized.filter(r=>r.remaining>0).length;$("#occupancy").innerHTML=`${total>0?"100":"0"} <small>%</small>`;$("#emptyState").hidden=total>0;
  const active=segments.filter(r=>r.remaining>0);$("#pipeline").innerHTML=active.map(r=>`<div class="pipe-segment" style="width:${r.percent}%;background:${COLORS[r.index%COLORS.length]}" title="${r.product}: km ${fmt(r.start,2)} a ${fmt(r.end,2)}"><span>${r.percent>=8?r.product:""}</span></div>`).join("");
  $("#segmentList").innerHTML=active.length?[...active].reverse().map(r=>`<div class="segment-row"><span class="dot" style="background:${COLORS[r.index%COLORS.length]}"></span><div class="segment-info"><strong>${r.product||"Sin nombre"}</strong><small>Partida ${r.batch||"—"} · ${fmt(r.percent,2)}% del ducto</small></div><div class="segment-km">${fmt(r.start,2)} → ${fmt(r.end,2)} km<small>Longitud: ${fmt(r.length,2)} km</small></div></div>`).join(""):"";renderTankModule();renderForecast();renderOperationStatus();renderAlarms();
}

document.addEventListener("input",e=>{if(e.target.matches('input[type="text"],textarea')&&!e.target.hasAttribute("data-numeric"))e.target.value=e.target.value.toUpperCase();scheduleStateSave();const el=e.target.closest("[data-field]");if(!el)return;const{index,field}=el.dataset,position=el.selectionStart;rows[Number(index)][field]=field==="product"?el.value.toUpperCase():el.value;if(el.hasAttribute("data-numeric"))return;render();const replacement=document.querySelector(`[data-index="${index}"][data-field="${field}"]`);replacement?.focus();if(typeof position==="number")replacement?.setSelectionRange(position,position)});
document.addEventListener("change",e=>{const el=e.target.closest("[data-field]");if(el){const{index,field}=el.dataset;rows[Number(index)][field]=field==="product"?el.value.toUpperCase():el.value;render()}scheduleStateSave()});
document.addEventListener("click",e=>{
  const remove=e.target.closest("[data-remove]");if(remove){rows.splice(Number(remove.dataset.remove),1);render()}
  const deleteTank=e.target.closest("[data-delete-tank-record]");
  if(deleteTank){
    const index=Number(deleteTank.dataset.deleteTankRecord),record=tankRecords[index];if(!record)return;
    if(!window.confirm(`¿Eliminar el caudal de ${String(record.time||"—").replace(":","h")} por ${fmt(record.receivedBbl)} BBL/H?`))return;
    const batch=String(record.batchEquivalent||"").trim().toLowerCase(),row=rows.find(item=>String(item.batch||"").trim().toLowerCase()===batch);if(row)row.received=Math.max(0,safeNumber(row.received)-safeNumber(record.receivedBbl));
    tankRecords.splice(index,1);if(index<accumulationResetIndex)accumulationResetIndex=Math.max(0,accumulationResetIndex-1);editingTankRecordIndex=null;recalculateTankAccumulated();forecastFlow=safeNumber(tankRecords.at(-1)?.receivedBbl);flowManuallyEdited=false;render();$("#tankMessage").textContent="Caudal eliminado. El acumulado y los registros posteriores fueron recalculados; no se envió mensaje a Telegram.";$("#tankMessage").className="transfer-message success";scheduleStateSave();return;
  }
  const edit=e.target.closest("[data-edit-tank-record]");if(edit){editingTankRecordIndex=Number(edit.dataset.editTankRecord);renderTankModule()}
  if(e.target.closest("[data-cancel-tank-edit]")){editingTankRecordIndex=null;renderTankModule()}
  const save=e.target.closest("[data-save-tank-record]");
  if(save){
    const index=Number(save.dataset.saveTankRecord),record=tankRecords[index],read=field=>document.querySelector(`[data-tank-edit="${field}"]`)?.value??"",number=field=>safeNumber(read(field)),tank=String(read("tank")).replace(/[^0-9]/g,"");
    if(record){const receivedBbl=number("receivedBbl");Object.assign(record,{time:read("time")||record.time,suctionPsi:Math.round(number("suctionPsi")),apiDegree:optionalNumber(read("apiDegree")),temperature:optionalNumber(read("temperature")),batchEquivalent:read("batchEquivalent").trim().toUpperCase(),product:read("product").trim().toUpperCase(),tank:tank||record.tank,levelM:number("levelM"),gallons:number("gallons"),receivedBbl,flowBph:receivedBbl,accumulatedBbl:number("accumulatedBbl"),observation:read("observation").trim().toUpperCase()});record.barrels=record.gallons/42;if(index===tankRecords.length-1){forecastFlow=receivedBbl;flowManuallyEdited=false}}
    if(record)record.date=read("date")||record.date;editingTankRecordIndex=null;render();$("#tankMessage").textContent="Registro corregido y guardado. No se envió un nuevo mensaje a Telegram.";$("#tankMessage").className="transfer-message success";
  }
  const editAlarm=e.target.closest("[data-edit-alarm]");if(editAlarm){const alarm=alarms.find(item=>item.id===editAlarm.dataset.editAlarm);if(alarm){editingAlarmId=alarm.id;$("#alarmDate").value=alarm.date;$("#alarmTime").value=alarm.time;$("#alarmMessage").value=alarm.message;$("#scheduleAlarm").textContent="Guardar cambios";$("#alarmMessageStatus").textContent="Editando alarma seleccionada."}}
  const cancelAlarm=e.target.closest("[data-cancel-alarm]");if(cancelAlarm){const alarm=alarms.find(item=>item.id===cancelAlarm.dataset.cancelAlarm);if(alarm){alarm.status="cancelled";alarm.cancelledAt=new Date().toISOString();renderAlarms();$("#alarmMessageStatus").textContent="Alarma cancelada."}}
  setTimeout(scheduleStateSave);
});
$("#addRow").addEventListener("click",()=>{rows.push({batch:"",product:PRODUCTS[0],sent:0,received:0});render()});
function resetLevelFields(prefix){["Meters","Centimeters","Millimeters"].forEach(part=>{$(`#${prefix?`${prefix}Level${part}`:`level${part}`}`).value=0});renderTankModule()}
$("#resetInitialLevel").addEventListener("click",()=>{resetLevelFields("initial");$("#tankMessage").textContent="Nivel inicial reiniciado. El historial y el acumulado se conservaron.";$("#tankMessage").className="transfer-message success"});
$("#resetCurrentLevel").addEventListener("click",()=>{resetLevelFields("");$("#tankMessage").textContent="Nivel actual reiniciado. El historial y el acumulado se conservaron.";$("#tankMessage").className="transfer-message success"});
$("#finishBatch").addEventListener("click",()=>{const current=$("#batchEquivalentInput").value.trim().toLowerCase(),currentIndex=rows.findIndex(row=>String(row.batch||"").trim().toLowerCase()===current),finished=currentIndex>=0?rows[currentIndex]:null;if(currentIndex>=0&&rows.length>1)rows.splice(currentIndex,1);const next=rows[Math.min(Math.max(currentIndex,0),rows.length-1)]||rows[0];accumulationResetIndex=tankRecords.length;$("#initialTankAccumulated").value=0;["Meters","Centimeters","Millimeters"].forEach(part=>{$(`#initialLevel${part}`).value=$(`#level${part}`).value});const start=$("#tankTime").value;$("#initialTankTime").value=start;$("#tankTime").value=addOneHour(start);$("#batchEquivalentInput").value=next?.batch||"";forecastFlow=0;flowManuallyEdited=false;render();$("#tankMessage").textContent=finished&&next&&finished!==next?`Fin manual de la partida ${finished.batch}. Ahora continúa la partida ${next.batch}; el acumulado inició en cero y el histórico anterior se conserva.`:"Fin de partida registrado. No existe otra partida pendiente para seleccionar.";$("#tankMessage").className="transfer-message success";scheduleStateSave()});
function setLevelFields(prefix,levelM){const totalMm=Math.max(0,Math.round(safeNumber(levelM)*1000)),meters=Math.floor(totalMm/1000),centimeters=Math.floor((totalMm%1000)/10),millimeters=totalMm%10;$("#"+(prefix?`${prefix}LevelMeters`:"levelMeters")).value=meters;$("#"+(prefix?`${prefix}LevelCentimeters`:"levelCentimeters")).value=centimeters;$("#"+(prefix?`${prefix}LevelMillimeters`:"levelMillimeters")).value=millimeters}
$("#tankSelect").addEventListener("change",()=>{
  const tank=$("#tankSelect").value,lastForTank=[...tankRecords].reverse().find(record=>record.tank===tank);forecastFlow=0;flowManuallyEdited=false;
  if(lastForTank){setLevelFields("initial",lastForTank.levelM);setLevelFields("",lastForTank.levelM);$("#initialTankTime").value=lastForTank.time;$("#tankTime").value=addOneHour(lastForTank.time);$("#tankMessage").textContent=`TP-${tank.padStart(2,"0")} seleccionado. Se tomó su propia última lectura como nivel inicial.`}
  else{["#initialLevelMeters","#initialLevelCentimeters","#initialLevelMillimeters","#levelMeters","#levelCentimeters","#levelMillimeters"].forEach(id=>$(id).value=0);$("#tankMessage").textContent=`TP-${tank.padStart(2,"0")} seleccionado sin lecturas previas. Ingrese el nivel inicial y luego el nivel actual.`}
  $("#tankMessage").className="transfer-message success";render();
});
["#firstBatchRemainingInput","#forecastFlowInput","#forecastHoursInput"].forEach(id=>$(id).addEventListener("focus",event=>event.target.select()));
$("#firstBatchRemainingInput").addEventListener("input",event=>{if(!rows.length)return;const remaining=safeNumber(event.target.value),received=safeNumber(rows[0].received);rows[0].sent=received+remaining;render()});
$("#forecastFlowInput").addEventListener("input",event=>{forecastFlow=safeNumber(event.target.value);flowManuallyEdited=true;renderForecast()});
$("#forecastHoursInput").addEventListener("input",event=>{const hours=safeNumber(event.target.value),remaining=calculations().normalized[0]?.remaining||0;forecastFlow=hours>0?remaining/hours:0;renderForecast()});
$("#resetForecast").addEventListener("click",()=>{forecastFlow=tankRecords.at(-1)?.receivedBbl||0;flowManuallyEdited=false;renderForecast()});
$("#stopOperation").addEventListener("click",()=>{
  const time=$("#operationTime").value,reason=$("#stopReason").value,observation=$("#operationObservation").value.trim(),message=$("#operationMessage");if(!time){message.textContent="Seleccione la hora de paralización.";return}
  operationStatus={status:"stopped",since:time,reason};operationHistory.push({status:"stopped",time,reason,observation,createdAt:new Date().toISOString()});renderOperationStatus();publishOperationStatus({status:"stopped",time,reason,observation});message.textContent="Paralización registrada y enviada a Telegram.";message.className="transfer-message success";
});
$("#resumeOperation").addEventListener("click",()=>{
  const time=$("#operationTime").value,observation=$("#operationObservation").value.trim(),message=$("#operationMessage");if(!time){message.textContent="Seleccione la hora de reinicio.";return}if(operationStatus.status!=="stopped"){message.textContent="El poliducto ya consta en operación.";return}
  const hours=elapsedHours(operationStatus.since,time),minutes=Math.round(hours*60),duration=`${Math.floor(minutes/60)} h ${String(minutes%60).padStart(2,"0")} min`;operationStatus={status:"running",since:time,reason:""};operationHistory.push({status:"running",time,duration,observation,createdAt:new Date().toISOString()});renderOperationStatus();publishOperationStatus({status:"running",time,stoppedDuration:duration,observation});message.textContent="Reinicio de operación registrado y enviado a Telegram.";message.className="transfer-message success";
});
$("#clearOperationHistory").addEventListener("click",()=>{
  if(!operationHistory.length){$("#operationMessage").textContent="El historial del poliducto ya está vacío.";return}
  if(!window.confirm("¿Desea borrar todo el historial de paralizaciones y reinicios?"))return;
  operationHistory=[];renderOperationStatus();$("#operationMessage").textContent="Historial del poliducto eliminado.";$("#operationMessage").className="transfer-message success";scheduleStateSave();
});
$("#scheduleAlarm").addEventListener("click",()=>{const date=$("#alarmDate").value,time=$("#alarmTime").value,message=$("#alarmMessage").value.trim().toUpperCase(),status=$("#alarmMessageStatus");if(!date||!time||!message){status.textContent="Ingrese la fecha, la hora y el mensaje.";return}const timestamp=new Date(`${date}T${time}:00-05:00`);if(!Number.isFinite(timestamp.getTime())){status.textContent="La fecha o la hora no son válidas.";return}if(editingAlarmId){const alarm=alarms.find(item=>item.id===editingAlarmId);if(alarm)Object.assign(alarm,{date,time,message,status:"pending",updatedAt:new Date().toISOString()})}else alarms.push({id:`alarm-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,date,time,message,status:"pending",createdAt:new Date().toISOString()});editingAlarmId=null;$("#scheduleAlarm").textContent="Programar alarma";$("#alarmMessage").value="";renderAlarms();status.textContent="Alarma programada para enviarse a Telegram.";status.className="transfer-message success";scheduleStateSave();setTimeout(checkScheduledAlarms,1800)});
$("#clearAlarmForm").addEventListener("click",()=>{editingAlarmId=null;$("#alarmDate").value="";$("#alarmTime").value="";$("#alarmMessage").value="";$("#scheduleAlarm").textContent="Programar alarma";$("#alarmMessageStatus").textContent=""});
$("#clearAlarmHistory").addEventListener("click",()=>{
  if(!alarms.length){$("#alarmMessageStatus").textContent="El historial de alarmas ya está vacío.";return}
  if(!window.confirm("¿Desea borrar todo el historial de alarmas, incluidas las pendientes?"))return;
  alarms=[];editingAlarmId=null;$("#scheduleAlarm").textContent="Programar alarma";renderAlarms();$("#alarmMessageStatus").textContent="Historial de alarmas eliminado.";$("#alarmMessageStatus").className="transfer-message success";scheduleStateSave();
});
async function checkScheduledAlarms(){try{await fetch("/api/alarm-dispatch",{method:"POST"});await loadSharedState(false)}catch(error){console.warn("Verificación de alarmas pendiente")}}
["#tankSelect","#batchEquivalentInput","#initialLevelMeters","#initialLevelCentimeters","#initialLevelMillimeters","#levelMeters","#levelCentimeters","#levelMillimeters","#initialTankTime","#tankTime"].forEach(s=>$(s).addEventListener("input",renderTankModule));
$("#initialTankAccumulated").addEventListener("input",()=>{recalculateTankAccumulatedForBatch($("#batchEquivalentInput").value);renderTankModule()});
$("#suctionPsiInput").addEventListener("change",event=>{event.target.value=Math.round(safeNumber(event.target.value));scheduleStateSave()});
$("#registerTankLevel").addEventListener("click",()=>{
  const calc=tankCalculation(),base=tankCalculation("initial"),message=$("#tankMessage"),date=$("#tankDate").value,initialTime=$("#initialTankTime").value,time=$("#tankTime").value;if(!calc.valid||!base.valid||!date||!initialTime||!time){message.textContent=!base.valid?`Nivel inicial: ${base.message}`:!calc.valid?`Nivel actual: ${calc.message}`:!date?"Seleccione la fecha del caudal.":"Seleccione la hora inicial y la hora actual.";message.className="transfer-message";return}
  const receivedBbl=Math.round(Math.max(0,calc.gallons-base.gallons)/42),hours=elapsedHours(initialTime,time),flowBph=receivedBbl,suctionPsi=Math.round(safeNumber($("#suctionPsiInput").value)),apiDegree=optionalNumber($("#apiDegreeInput").value),temperature=optionalNumber($("#temperatureInput").value),observation=$("#tankObservationInput").value.trim().toUpperCase(),batchEquivalent=$("#batchEquivalentInput").value.trim(),normalizedBatch=batchEquivalent.toLowerCase(),noticeRow=rows.find(r=>String(r.batch).trim().toLowerCase()===normalizedBatch)||rows[0],noticeSent=safeNumber(noticeRow?.sent),noticePreviousReceived=safeNumber(noticeRow?.received),noticeReceived=noticePreviousReceived+receivedBbl,noticeRemaining=Math.max(0,noticeSent-noticeReceived),noticeProduct=noticeRow?.product||"Sin producto",accumulatedBbl=safeNumber($("#initialTankAccumulated").value)+tankRecords.filter(record=>String(record.batchEquivalent||"").trim().toLowerCase()===normalizedBatch).reduce((sum,record)=>sum+safeNumber(record.receivedBbl),0)+receivedBbl;forecastFlow=flowBph;flowManuallyEdited=false;applyTransferredVolume(receivedBbl,batchEquivalent);
  tankRecords.push({date,time,suctionPsi,apiDegree,temperature,tank:calc.tank,batchEquivalent,product:noticeProduct,levelM:calc.levelM,gallons:calc.gallons,barrels:calc.barrels,receivedBbl,flowBph,elapsedHours:hours,accumulatedBbl,observation});publishTelegramFlow({flowBph:receivedBbl,time,batchEquivalent:batchEquivalent||noticeRow?.batch,tank:calc.tank,product:noticeProduct,sent:noticeSent,received:noticeReceived,accumulated:accumulatedBbl,remaining:noticeRemaining});
  const confirmation=`Lectura registrada en la partida ${batchEquivalent||noticeRow?.batch||"actual"}: ${fmt(receivedBbl)} BBL recibidos. La partida permanecerá activa hasta presionar Fin de partida.`;
  $("#initialTankTime").value=time;$("#tankTime").value=addOneHour(time);$("#tankObservationInput").value="";["Meters","Centimeters","Millimeters"].forEach(part=>{$(`#initialLevel${part}`).value=$(`#level${part}`).value});render();message.textContent=confirmation;message.className="transfer-message success";scheduleStateSave();
});
$("#resetData").addEventListener("click",async()=>{if(!await verifyResetPassword())return;if(!window.confirm("La contraseña es correcta. ¿Confirma que desea restablecer todos los valores?"))return;rows=structuredClone(initialRows);tankRecords=[];forecastFlow=0;flowManuallyEdited=false;accumulationResetIndex=0;$("#initialTankAccumulated").value=0;["#initialLevelMeters","#initialLevelCentimeters","#initialLevelMillimeters","#levelMeters","#levelCentimeters","#levelMillimeters"].forEach(id=>$(id).value=0);$("#tankMessage").textContent="Valores restablecidos con autorización.";$("#tankMessage").className="transfer-message success";render();scheduleStateSave()});
$("#saveImage").addEventListener("click",()=>window.print());
async function initializeApp(){
  const now=new Date(),start=`${String(now.getHours()).padStart(2,"0")}:00`,current=`${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`,today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;$("#initialTankTime").value=start;$("#tankDate").value=today;$("#tankTime").value=addOneHour(start);$("#operationTime").value=current;$("#alarmDate").value=today;$("#alarmTime").value=current;$("#tankSelect").innerHTML=Object.keys(window.TANK_CALIBRATION||{}).map(t=>`<option value="${t}">TP-${t.padStart(2,"0")}</option>`).join("");$("#batchEquivalentInput").value=rows[0]?.batch||"";
  const found=await loadSharedState();syncReady=true;render();if(!found)scheduleStateSave();
  setInterval(()=>{if(!localChangesPending)loadSharedState(false)},3000);
  window.addEventListener("focus",()=>{if(!localChangesPending)loadSharedState(false)});
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&!localChangesPending)loadSharedState(false)});
  window.addEventListener("online",()=>{if(localChangesPending)saveSharedState();else loadSharedState(true)});
  setInterval(checkScheduledAlarms,30000);checkScheduledAlarms();
}
initializeApp();
