const PIPE_KM = 127;
const COLORS = ["#bdff4a", "#24d6d1", "#ffb84d", "#bda7ff", "#ff7b68", "#62a8ff", "#f279c6", "#85d37d", "#ffd966"];
const initialRows = [
  { batch: "126", product: "JET A1", sent: 7367, received: 1608 },
  { batch: "127", product: "DESTILADO", sent: 101, received: 0 },
  { batch: "128", product: "DIESEL OIL", sent: 36850, received: 0 }
];
let rows = structuredClone(initialRows);
let currentFlow = 0;

const $ = (selector) => document.querySelector(selector);
const fmt = (n, digits = 0) => new Intl.NumberFormat("es-EC", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
const safeNumber = (value) => Math.max(0, Number(value) || 0);

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
  $("#flowDisplay").textContent = fmt(currentFlow, 2);
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
$("#currentFlow").addEventListener("input", event => { currentFlow = safeNumber(event.target.value); $("#flowDisplay").textContent = fmt(currentFlow, 2); });
$("#applyTransfer").addEventListener("click", () => {
  const volume = safeNumber($("#transferVolume").value);
  const message = $("#transferMessage");
  if (!rows.length) {
    message.textContent = "Agregue al menos una partida antes de registrar la transferencia.";
    message.className = "transfer-message";
    return;
  }
  if (volume <= 0) {
    message.textContent = "Ingrese un volumen transferido mayor que cero.";
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
  message.textContent = `${fmt(volume, 2)} BBL registrados desde ${firstProduct} hacia ${lastProduct}.${removedText}`;
  message.className = "transfer-message success";
  $("#transferVolume").value = 0;
  render();
});
$("#resetData").addEventListener("click", () => {
  rows = structuredClone(initialRows);
  currentFlow = 0;
  $("#currentFlow").value = 0;
  $("#transferVolume").value = 0;
  $("#transferMessage").textContent = "Ingrese el caudal actual y el volumen que desea registrar.";
  $("#transferMessage").className = "transfer-message";
  render();
});
$("#saveImage").addEventListener("click", () => window.print());
render();
