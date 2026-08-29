const PIPE_KM = 127;
const COLORS = ["#bdff4a", "#24d6d1", "#ffb84d", "#bda7ff", "#ff7b68", "#62a8ff", "#f279c6", "#85d37d", "#ffd966"];
const initialRows = [
  { batch: "126", product: "JET A1", sent: 7367, received: 1608 },
  { batch: "127", product: "DESTILADO", sent: 101, received: 0 },
  { batch: "128", product: "DIESEL OIL", sent: 36850, received: 0 }
];
let rows = structuredClone(initialRows);
let currentFlow = 0;
let flowRecords = [];
let tankRecords = [];

const $ = (selector) => document.querySelector(selector);
const fmt = (n, digits = 0) => new Intl.NumberFormat("es-EC", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
const safeNumber = (value) => Math.max(0, Number(value) || 0);

function tankCalculation() {
  const tank = $("#tankSelect")?.value;
  const calibration = window.TANK_CALIBRATION?.[tank];
  if (!calibration) return { valid: false, message: "Seleccione un tanque disponible." };

  const meters = Math.floor(safeNumber($("#levelMeters")?.value));
  const centimeters = Math.min(99, Math.floor(safeNumber($("#levelCentimeters")?.value)));
  const millimeters = Math.min(9, Math.floor(safeNumber($("#levelMillimeters")?.value)));
  const wholeCentimeters = meters * 100 + centimeters;
  if (wholeCentimeters > calibration.maxCm) {
    return { valid: false, tank, meters, centimeters, millimeters, message: `El nivel supera el máximo operativo de ${fmt(calibration.maxCm / 100, 2)} m para el TP-${tank}.` };
  }

  const gallons = calibration.volumes[wholeCentimeters] + calibration.mmCorrections[millimeters];
  return {
    valid: Number.isFinite(gallons), tank, meters, centimeters, millimeters,
    levelMm: wholeCentimeters * 10 + millimeters,
    levelM: wholeCentimeters / 100 + millimeters / 1000,
    gallons,
    barrels: gallons / 42,
    message: "Lectura dentro del rango de la tabla de aforo."
  };
}

function renderTankModule() {
  if (!$("#tankSelect")) return;
  const calc = tankCalculation();
  const accumulated = tankRecords.reduce((sum, record) => sum + record.receivedBbl, 0);
  $("#tankAccumulatedDisplay").innerHTML = `${fmt(accumulated, 0)} <small>BBL</small>`;
  $("#tankHistoryEmpty").hidden = tankRecords.length > 0;
  $("#tankHistory").innerHTML = tankRecords.map(record => `
    <tr>
      <td>${record.time.replace(":", "h")}</td>
      <td>TP-${record.tank.padStart(2, "0")}</td>
      <td>${fmt(record.levelM, 3)} m</td>
      <td>${fmt(record.barrels, 0)} BBL</td>
      <td>${fmt(record.receivedBbl, 0)} BBL</td>
      <td>${fmt(record.accumulatedBbl, 0)} BBL</td>
    </tr>`).join("");

  if (!calc.valid) {
    $("#tankLevelDisplay").textContent = "Fuera de rango";
    $("#tankGallonsDisplay").innerHTML = `— <small>GLS</small>`;
    $("#tankBarrelsDisplay").innerHTML = `— <small>BBL</small>`;
    $("#tankMessage").textContent = calc.message;
    $("#tankMessage").className = "transfer-message";
    return;
  }
  $("#tankLevelDisplay").textContent = `${fmt(calc.levelM, 3)} m`;
  $("#tankGallonsDisplay").innerHTML = `${fmt(calc.gallons, 0)} <small>GLS</small>`;
  $("#tankBarrelsDisplay").innerHTML = `${fmt(calc.barrels, 0)} <small>BBL</small>`;
  $("#tankMessage").textContent = calc.message;
}

async function checkTelegramAlert(normalized) {
  const first = normalized.find(row => row.remaining > 0);
  if (!first || first.remaining > 1000) return;

  const alertKey = `telegram-alert-${first.batch || first.product}`;
  if (localStorage.getItem(alertKey)) return;

  // Se marca antes de enviar para impedir llamadas repetidas durante el renderizado.
  localStorage.setItem(alertKey, "pending");
  try {
    const response = await fetch("/api/telegram-alert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        batch: first.batch || "Sin número",
        product: first.product || "Sin producto",
        remaining: Math.round(first.remaining)
      })
    });
    if (!response.ok) throw new Error("No se pudo enviar la alerta");
    localStorage.setItem(alertKey, "sent");
  } catch (error) {
    localStorage.removeItem(alertKey);
    console.warn("Alerta de Telegram pendiente:", error.message);
  }
}

function calculations() {
  const normalized = rows.map((row, index) => ({ ...row, index, remaining: Math.max(0, safeNumber(row.sent) - safeNumber(row.received)) }));
  const total = normalized.reduce((sum, row) => sum + row.remaining, 0);
  let cursor = 0;
  const segments = [...normalized].reverse().map(row => {
    const length = total ? row.remaining / total * PIPE_KM : 0;
    const result = { ...row, start: cursor, end: cursor + length, length, percent: total ? row.remaining / total * 100 : 0 };
    cursor += length;
    return result;
  });
  return { normalized, segments, total };
}

function input(value, field, index, type = "text") {
  return `<input type="${type}" min="0" step="any" value="${String(value).replaceAll('"','&quot;')}" data-index="${index}" data-field="${field}" aria-label="${field} fila ${index + 1}">`;
}

function render() {
  const { normalized, segments, total } = calculations();
  checkTelegramAlert(normalized);
  $("#productRows").innerHTML = normalized.map((row, index) => `
    <tr>
      <td>${input(row.batch, "batch", index)}</td>
      <td>${input(row.product, "product", index)}</td>
      <td>${input(row.sent, "sent", index, "number")}</td>
      <td>${input(row.received, "received", index, "number")}</td>
      <td class="calculated">${fmt(row.remaining)}</td>
      <td><button class="remove" data-remove="${index}" aria-label="Eliminar fila">×</button></td>
    </tr>`).join("");

  $("#totalVolume").innerHTML = `${fmt(total)} <small>u</small>`;
  $("#activeProducts").textContent = normalized.filter(row => row.remaining > 0).length;
  $("#occupancy").innerHTML = `${total > 0 ? "100" : "0"} <small>%</small>`;
  $("#flowDisplay").textContent = fmt(currentFlow, 0);
  const accumulated = flowRecords.reduce((sum, record) => sum + record.flow, 0);
  $("#accumulatedDisplay").textContent = fmt(accumulated, 0);
  $("#recordCount").textContent = `${flowRecords.length} registro${flowRecords.length === 1 ? "" : "s"}`;
  $("#hourlyEmpty").hidden = flowRecords.length > 0;
  $("#hourlyHistory").innerHTML = flowRecords.map((record, index) => `
    <div class="hourly-record">
      <span class="record-number">${String(index + 1).padStart(2, "0")}</span>
      <div><strong>${record.time.replace(":", "h")} </strong><small>Registro horario</small></div>
      <b>${fmt(record.flow, 0)} <small>BBL</small></b>
    </div>`).join("");
  $("#emptyState").hidden = total > 0;

  const active = segments.filter(row => row.remaining > 0);
  $("#pipeline").innerHTML = active.map(row => `
    <div class="pipe-segment" style="width:${row.percent}%;background:${COLORS[row.index % COLORS.length]}" title="${row.product}: km ${fmt(row.start,2)} a ${fmt(row.end,2)}">
      <span>${row.percent >= 8 ? row.product : ""}</span>
    </div>`).join("");

  $("#segmentList").innerHTML = active.length ? [...active].reverse().map(row => `
    <div class="segment-row">
      <span class="dot" style="background:${COLORS[row.index % COLORS.length]}"></span>
      <div class="segment-info"><strong>${row.product || "Sin nombre"}</strong><small>Partida ${row.batch || "—"} · ${fmt(row.percent, 2)}% del ducto</small></div>
      <div class="segment-km">${fmt(row.start, 2)} → ${fmt(row.end, 2)} km<small>Longitud: ${fmt(row.length, 2)} km</small></div>
    </div>`).join("") : "";
  renderTankModule();
}

document.addEventListener("input", event => {
  const el = event.target.closest("[data-field]");
  if (!el) return;
  const { index, field } = el.dataset;
  rows[Number(index)][field] = el.type === "number" ? safeNumber(el.value) : el.value;
  render();
  const replacement = document.querySelector(`[data-index="${index}"][data-field="${field}"]`);
  replacement?.focus();
  if (replacement && el.type !== "number") replacement.setSelectionRange(el.selectionStart, el.selectionStart);
});

document.addEventListener("click", event => {
  const remove = event.target.closest("[data-remove]");
  if (remove) { rows.splice(Number(remove.dataset.remove), 1); render(); }
});

$("#addRow").addEventListener("click", () => { rows.push({ batch: "", product: "NUEVO PRODUCTO", sent: 0, received: 0 }); render(); });
$("#currentFlow").addEventListener("input", event => { currentFlow = safeNumber(event.target.value); $("#flowDisplay").textContent = fmt(currentFlow, 0); });
["#tankSelect", "#levelMeters", "#levelCentimeters", "#levelMillimeters"].forEach(selector => {
  $(selector).addEventListener("input", renderTankModule);
});
$("#registerTankLevel").addEventListener("click", () => {
  const calc = tankCalculation();
  const message = $("#tankMessage");
  const time = $("#tankTime").value;
  if (!calc.valid) {
    message.textContent = calc.message;
    message.className = "transfer-message";
    return;
  }
  if (!time) {
    message.textContent = "Seleccione la hora de la lectura.";
    message.className = "transfer-message";
    return;
  }
  const previous = [...tankRecords].reverse().find(record => record.tank === calc.tank);
  const receivedBbl = previous ? Math.max(0, calc.gallons - previous.gallons) / 42 : 0;
  const accumulatedBbl = tankRecords.reduce((sum, record) => sum + record.receivedBbl, 0) + receivedBbl;
  tankRecords.push({
    time, tank: calc.tank, levelM: calc.levelM, gallons: calc.gallons,
    barrels: calc.barrels, receivedBbl, accumulatedBbl
  });
  message.textContent = previous
    ? `Lectura registrada. Recibido desde la lectura anterior: ${fmt(receivedBbl, 0)} BBL.`
    : "Lectura inicial registrada como referencia; el recibido comienza en la siguiente lectura.";
  message.className = "transfer-message success";
  renderTankModule();
});
$("#applyTransfer").addEventListener("click", () => {
  const volume = Math.round(safeNumber($("#currentFlow").value));
  const recordTime = $("#flowTime").value;
  const message = $("#transferMessage");
  if (!rows.length) {
    message.textContent = "Agregue al menos una partida antes de registrar la transferencia.";
    message.className = "transfer-message";
    return;
  }
  if (volume <= 0) {
    message.textContent = "Ingrese un caudal horario mayor que cero.";
    message.className = "transfer-message";
    return;
  }
  if (!recordTime) {
    message.textContent = "Seleccione la hora correspondiente al caudal.";
    message.className = "transfer-message";
    return;
  }
  const firstProduct = rows[0].product || "la primera partida";
  const lastProduct = rows[rows.length - 1].product || "la última partida";

  // Todo el volumen transferido aumenta el bombeado de la última partida.
  rows[rows.length - 1].sent = safeNumber(rows[rows.length - 1].sent) + volume;

  // El volumen recibido consume las partidas desde el frente. Al completarse
  // una partida, se elimina y el excedente continúa en la siguiente.
  let pending = volume;
  let completed = 0;
  while (pending > 0 && rows.length > 1) {
    const first = rows[0];
    const available = Math.max(0, safeNumber(first.sent) - safeNumber(first.received));
    if (pending >= available) {
      pending -= available;
      rows.shift();
      completed += 1;
    } else {
      first.received = safeNumber(first.received) + pending;
      pending = 0;
    }
  }

  // Si queda una sola partida, registra en ella cualquier volumen pendiente.
  // Como también es la última, su bombeado y recibido crecen por igual.
  if (pending > 0 && rows.length === 1) {
    rows[0].received = safeNumber(rows[0].received) + pending;
  }

  const removedText = completed ? ` ${completed} partida${completed > 1 ? "s" : ""} completada${completed > 1 ? "s" : ""} y retirada${completed > 1 ? "s" : ""}.` : "";
  flowRecords.push({ time: recordTime, flow: volume });
  message.textContent = `${fmt(volume, 0)} BBL registrados a las ${recordTime.replace(":", "h")} desde ${firstProduct} hacia ${lastProduct}.${removedText}`;
  message.className = "transfer-message success";
  $("#currentFlow").value = 0;
  currentFlow = 0;
  render();
});
$("#resetData").addEventListener("click", () => {
  rows = structuredClone(initialRows);
  currentFlow = 0;
  flowRecords = [];
  tankRecords = [];
  $("#currentFlow").value = 0;
  $("#transferMessage").textContent = "Seleccione la hora e ingrese el caudal correspondiente.";
  $("#transferMessage").className = "transfer-message";
  render();
});
$("#saveImage").addEventListener("click", () => window.print());
const now = new Date();
$("#flowTime").value = `${String(now.getHours()).padStart(2, "0")}:00`;
$("#tankTime").value = `${String(now.getHours()).padStart(2, "0")}:00`;
$("#tankSelect").innerHTML = Object.keys(window.TANK_CALIBRATION || {}).map(tank => `<option value="${tank}">TP-${tank.padStart(2, "0")}</option>`).join("");
render();
