const PIPE_KM=127,COLORS=["#bdff4a","#24d6d1","#ffb84d","#bda7ff","#ff7b68","#62a8ff","#f279c6","#85d37d","#ffd966"];
const initialRows=[{batch:"126",product:"JET A1",sent:7367,received:1608},{batch:"127",product:"DESTILADO",sent:101,received:0},{batch:"128",product:"DIESEL OIL",sent:36850,received:0}];
let rows=structuredClone(initialRows),tankRecords=[];
const $=s=>document.querySelector(s),safeNumber=v=>Math.max(0,Number(v)||0),fmt=(n,d=0)=>new Intl.NumberFormat("es-EC",{maximumFractionDigits:d,minimumFractionDigits:d}).format(n);

function elapsedHours(a,b){const m=v=>{const[h,x]=v.split(":").map(Number);return h*60+x};let d=m(b)-m(a);if(d<=0)d+=1440;return d/60}
function addOneHour(t){const[h,m]=t.split(":").map(Number);return`${String((h+1)%24).padStart(2,"0")}:${String(m).padStart(2,"0")}`}
function applyTransferredVolume(volume){
  if(volume<=0||!rows.length)return 0;
  rows.at(-1).sent=safeNumber(rows.at(-1).sent)+volume;
  let pending=volume,completed=0;
  while(pending>0&&rows.length>1){const first=rows[0],available=Math.max(0,safeNumber(first.sent)-safeNumber(first.received));if(available===0||pending>=available){pending-=available;rows.shift();completed++}else{first.received=safeNumber(first.received)+pending;pending=0}}
  if(pending>0&&rows.length===1)rows[0].received=safeNumber(rows[0].received)+pending;
  return completed;
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
  const calc=tankCalculation(),base=tankCalculation("initial"),initial=safeNumber($("#initialTankAccumulated")?.value),accumulated=initial+tankRecords.reduce((s,r)=>s+r.receivedBbl,0),last=tankRecords.at(-1),received=calc.valid&&base.valid?Math.round(Math.max(0,calc.gallons-base.gallons)/42):0,hours=$("#initialTankTime")?.value&&$("#tankTime")?.value?elapsedHours($("#initialTankTime").value,$("#tankTime").value):0,flow=hours?Math.round(received/hours):0,shownReceived=received>0?received:(last?.receivedBbl||0);
  $("#tankAccumulatedDisplay").innerHTML=`${fmt(accumulated)} <small>BBL</small>`;$("#tankReceivedDisplay").innerHTML=`${fmt(shownReceived)} <small>BBL</small>`;$("#tankFlowDisplay").innerHTML=`${fmt(flow)} <small>BBL/H</small>`;$("#currentCalculatedFlow").innerHTML=`${fmt(last?.flowBph||0)} <small>BBL/H</small>`;$("#tankHistoryEmpty").hidden=tankRecords.length>0;
  let running=initial;
  $("#tankHistory").innerHTML=tankRecords.map(r=>{running+=r.receivedBbl;return`<tr><td>${r.time.replace(":","h")}</td><td>TP-${r.tank.padStart(2,"0")}</td><td>${fmt(r.levelM,3)} m</td><td>${fmt(r.gallons)} GLS</td><td>${fmt(r.receivedBbl)} BBL</td><td>${fmt(r.flowBph)} BBL/H</td><td>${fmt(running)} BBL</td></tr>`}).join("");
  if(!calc.valid){$("#tankLevelDisplay").textContent="Fuera de rango";$("#tankGallonsDisplay").innerHTML="— <small>GLS</small>";$("#tankReceivedDisplay").innerHTML="— <small>BBL</small>";$("#tankFlowDisplay").innerHTML="— <small>BBL/H</small>";$("#tankMessage").textContent=calc.message;$("#tankMessage").className="transfer-message";return}
  $("#tankLevelDisplay").textContent=`${fmt(calc.levelM,3)} m`;$("#tankGallonsDisplay").innerHTML=`${fmt(calc.gallons)} <small>GLS</small>`;$("#tankMessage").textContent=calc.message;
}

async function checkTelegramAlert(normalized){
  const first=normalized.find(r=>r.remaining>0);if(!first||first.remaining>1000)return;
  const key=`telegram-alert-${first.batch||first.product}`;if(localStorage.getItem(key))return;localStorage.setItem(key,"pending");
  try{const response=await fetch("/api/telegram-alert",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({batch:first.batch||"Sin número",product:first.product||"Sin producto",remaining:Math.round(first.remaining)})});if(!response.ok)throw new Error("No se pudo enviar la alerta");localStorage.setItem(key,"sent")}catch(error){localStorage.removeItem(key);console.warn("Alerta de Telegram pendiente:",error.message)}
}

function calculations(){const normalized=rows.map((r,index)=>({...r,index,remaining:Math.max(0,safeNumber(r.sent)-safeNumber(r.received))})),total=normalized.reduce((s,r)=>s+r.remaining,0);let cursor=0;const segments=[...normalized].reverse().map(r=>{const length=total?r.remaining/total*PIPE_KM:0,result={...r,start:cursor,end:cursor+length,length,percent:total?r.remaining/total*100:0};cursor+=length;return result});return{normalized,segments,total}}
function input(value,field,index,type="text"){const numeric=type==="number";return`<input type="text" ${numeric?'inputmode="decimal" data-numeric="true"':''} value="${String(value).replaceAll('"','&quot;')}" data-index="${index}" data-field="${field}" aria-label="${field} fila ${index+1}">`}

function render(){
  const{normalized,segments,total}=calculations();checkTelegramAlert(normalized);
  $("#productRows").innerHTML=normalized.map((r,i)=>`<tr><td>${input(r.batch,"batch",i)}</td><td>${input(r.product,"product",i)}</td><td>${input(r.sent,"sent",i,"number")}</td><td>${input(r.received,"received",i,"number")}</td><td class="calculated">${fmt(r.remaining)}</td><td><button class="remove" data-remove="${i}" aria-label="Eliminar fila">×</button></td></tr>`).join("");
  $("#totalVolume").innerHTML=`${fmt(total)} <small>u</small>`;$("#activeProducts").textContent=normalized.filter(r=>r.remaining>0).length;$("#occupancy").innerHTML=`${total>0?"100":"0"} <small>%</small>`;$("#emptyState").hidden=total>0;
  const active=segments.filter(r=>r.remaining>0);$("#pipeline").innerHTML=active.map(r=>`<div class="pipe-segment" style="width:${r.percent}%;background:${COLORS[r.index%COLORS.length]}" title="${r.product}: km ${fmt(r.start,2)} a ${fmt(r.end,2)}"><span>${r.percent>=8?r.product:""}</span></div>`).join("");
  $("#segmentList").innerHTML=active.length?[...active].reverse().map(r=>`<div class="segment-row"><span class="dot" style="background:${COLORS[r.index%COLORS.length]}"></span><div class="segment-info"><strong>${r.product||"Sin nombre"}</strong><small>Partida ${r.batch||"—"} · ${fmt(r.percent,2)}% del ducto</small></div><div class="segment-km">${fmt(r.start,2)} → ${fmt(r.end,2)} km<small>Longitud: ${fmt(r.length,2)} km</small></div></div>`).join(""):"";renderTankModule();
}

document.addEventListener("input",e=>{const el=e.target.closest("[data-field]");if(!el)return;const{index,field}=el.dataset,position=el.selectionStart;rows[Number(index)][field]=el.value;render();const replacement=document.querySelector(`[data-index="${index}"][data-field="${field}"]`);replacement?.focus();replacement?.setSelectionRange(position,position)});
document.addEventListener("click",e=>{const remove=e.target.closest("[data-remove]");if(remove){rows.splice(Number(remove.dataset.remove),1);render()}});
$("#addRow").addEventListener("click",()=>{rows.push({batch:"",product:"NUEVO PRODUCTO",sent:0,received:0});render()});
function resetLevelFields(prefix){["Meters","Centimeters","Millimeters"].forEach(part=>{$(`#${prefix?`${prefix}Level${part}`:`level${part}`}`).value=0});renderTankModule()}
$("#resetInitialLevel").addEventListener("click",()=>{resetLevelFields("initial");$("#tankMessage").textContent="Nivel inicial reiniciado. El historial y el acumulado se conservaron.";$("#tankMessage").className="transfer-message success"});
$("#resetCurrentLevel").addEventListener("click",()=>{resetLevelFields("");$("#tankMessage").textContent="Nivel actual reiniciado. El historial y el acumulado se conservaron.";$("#tankMessage").className="transfer-message success"});
["#tankSelect","#initialLevelMeters","#initialLevelCentimeters","#initialLevelMillimeters","#levelMeters","#levelCentimeters","#levelMillimeters","#initialTankTime","#tankTime","#initialTankAccumulated"].forEach(s=>$(s).addEventListener("input",renderTankModule));
$("#registerTankLevel").addEventListener("click",()=>{
  const calc=tankCalculation(),base=tankCalculation("initial"),message=$("#tankMessage"),initialTime=$("#initialTankTime").value,time=$("#tankTime").value;if(!calc.valid||!base.valid||!initialTime||!time){message.textContent=!base.valid?`Nivel inicial: ${base.message}`:!calc.valid?`Nivel actual: ${calc.message}`:"Seleccione la hora inicial y la hora actual.";message.className="transfer-message";return}
  const receivedBbl=Math.round(Math.max(0,calc.gallons-base.gallons)/42),hours=elapsedHours(initialTime,time),flowBph=hours?Math.round(receivedBbl/hours):0,completed=applyTransferredVolume(receivedBbl);
  tankRecords.push({time,tank:calc.tank,levelM:calc.levelM,gallons:calc.gallons,barrels:calc.barrels,receivedBbl,flowBph,elapsedHours:hours});const removed=completed?` ${completed} partida${completed>1?"s":""} completada${completed>1?"s":""} y retirada${completed>1?"s":""}.`:"";
  const confirmation=`Lectura registrada: ${fmt(receivedBbl)} BBL recibidos en ${fmt(hours,2)} h; caudal calculado ${fmt(flowBph)} BBL/H y sumado al acumulado.${removed}`;
  $("#initialTankTime").value=time;$("#tankTime").value=addOneHour(time);["Meters","Centimeters","Millimeters"].forEach(part=>{$(`#initialLevel${part}`).value=$(`#level${part}`).value});render();message.textContent=confirmation;message.className="transfer-message success";
});
$("#resetData").addEventListener("click",()=>{rows=structuredClone(initialRows);tankRecords=[];$("#initialTankAccumulated").value=0;["#initialLevelMeters","#initialLevelCentimeters","#initialLevelMillimeters","#levelMeters","#levelCentimeters","#levelMillimeters"].forEach(id=>$(id).value=0);$("#tankMessage").textContent="Ingrese el nivel inicial y el nivel actual para calcular el primer caudal.";$("#tankMessage").className="transfer-message";render()});
$("#saveImage").addEventListener("click",()=>window.print());
const now=new Date(),start=`${String(now.getHours()).padStart(2,"0")}:00`;$("#initialTankTime").value=start;$("#tankTime").value=addOneHour(start);$("#tankSelect").innerHTML=Object.keys(window.TANK_CALIBRATION||{}).map(t=>`<option value="${t}">TP-${t.padStart(2,"0")}</option>`).join("");render();
