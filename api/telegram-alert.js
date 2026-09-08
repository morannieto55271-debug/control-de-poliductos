const ALERT_THRESHOLD = 1000;

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Método no permitido" });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    return response.status(503).json({ error: "Telegram todavía no está configurado" });
  }

  const { type = "alert", batch, product, remaining, flow, time, tank, sent, received, timeRemaining, estimatedEnd, status, reason, observation, stoppedDuration } = request.body || {};

  const clean = value => String(value ?? "").replace(/[<>]/g, "").slice(0, 80);

  if (type === "flow") {
    const flowNumber = Number(flow);
    const remainingNumber = Number(remaining);
    if (!Number.isFinite(flowNumber) || flowNumber < 0) {
      return response.status(400).json({ error: "El caudal no es válido" });
    }

    let calculatedRemainingTime = clean(timeRemaining);
    let calculatedEstimatedEnd = clean(estimatedEnd);
    if (flowNumber > 0 && Number.isFinite(remainingNumber) && remainingNumber >= 0) {
      const totalSeconds = Math.round((remainingNumber / flowNumber) * 3600);
      const durationHours = Math.floor(totalSeconds / 3600);
      const durationMinutes = Math.floor((totalSeconds % 3600) / 60);
      const durationSeconds = totalSeconds % 60;
      calculatedRemainingTime = `${durationHours} h ${String(durationMinutes).padStart(2, "0")} min ${String(durationSeconds).padStart(2, "0")} s`;
      const timeMatch = String(time || "").match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      if (timeMatch) {
        const startSeconds = Number(timeMatch[1]) * 3600 + Number(timeMatch[2]) * 60 + Number(timeMatch[3] || 0);
        const finishSeconds = startSeconds + totalSeconds;
        const days = Math.floor(finishSeconds / 86400);
        const secondOfDay = finishSeconds % 86400;
        const finishTime = `${String(Math.floor(secondOfDay / 3600)).padStart(2, "0")}:${String(Math.floor((secondOfDay % 3600) / 60)).padStart(2, "0")}:${String(secondOfDay % 60).padStart(2, "0")}`;
        calculatedEstimatedEnd = `${finishTime}${days === 1 ? " · mañana" : days > 1 ? ` · en ${days} días` : ""}`;
      }
    }

    const flowText = [
      "📊 CAUDAL POLIDUCTO LIBERTAD",
      "",
      `💧 Caudal: ${Math.round(flowNumber).toLocaleString("es-EC")} BBL/H`,
      `🕒 Hora: ${clean(time) || "Sin registrar"}`,
      `📦 Partida: ${clean(batch) || "Sin registrar"}`,
      `📤 Bombeado: ${Math.round(Number(sent) || 0).toLocaleString("es-EC")} BBL`,
      `📥 Recibido: ${Math.round(Number(received) || 0).toLocaleString("es-EC")} BBL`,
      `🛢️ Producto: ${clean(product) || "Sin registrar"}`,
      `🏭 Tanque: ${clean(tank) || "Sin registrar"}`,
      `⏳ Falta por recibir: ${Math.round(Number(remaining) || 0).toLocaleString("es-EC")} BBL`,
      `⌛ Tiempo restante: ${calculatedRemainingTime || "Sin caudal disponible"}`,
      `🏁 Finalización estimada: ${calculatedEstimatedEnd || "Sin caudal disponible"}`
    ].join("\n");

    return sendTelegram(botToken, chatId, flowText, response);
  }

  if (type === "operation") {
    if (!['stopped', 'running'].includes(status)) {
      return response.status(400).json({ error: "Estado operativo no válido" });
    }
    const isStopped = status === "stopped";
    const operationText = [
      isStopped ? "⏸️🚨 POLIDUCTO LIBERTAD PARALIZADO" : "▶️✅ OPERACIÓN REINICIADA",
      "",
      ...(isStopped ? [`📋 Motivo: ${clean(reason) || "Sin especificar"}`] : []),
      `🕐 Hora: ${clean(time) || "Sin registrar"}`,
      ...(!isStopped && stoppedDuration ? [`⏱️ Tiempo paralizado: ${clean(stoppedDuration)}`] : []),
      ...(observation ? [`📝 Observación: ${clean(observation)}`] : []),
      "📍 Estación Reductora Pascuales"
    ].join("\n");
    return sendTelegram(botToken, chatId, operationText, response);
  }

  const remainingNumber = Number(remaining);
  if (!Number.isFinite(remainingNumber) || remainingNumber <= 0 || remainingNumber > ALERT_THRESHOLD) {
    return response.status(400).json({ error: "El saldo no cumple el umbral de alerta" });
  }

  const text = [
    "⚠️ ALERTA – ESTACIÓN REDUCTORA PASCUALES",
    "",
    `Partida: ${clean(batch)}`,
    `Producto: ${clean(product)}`,
    `Volumen restante: ${Math.round(remainingNumber).toLocaleString("es-EC")} BBL`,
    "",
    "La primera partida alcanzó el nivel preventivo de 1.000 BBL."
  ].join("\n");

  return sendTelegram(botToken, chatId, text, response);
};

async function sendTelegram(botToken, chatId, text, response) {
  try {
    const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text })
    });
    const result = await telegramResponse.json();
    if (!telegramResponse.ok || !result.ok) {
      return response.status(502).json({ error: "Telegram rechazó la notificación" });
    }
    return response.status(200).json({ ok: true });
  } catch (error) {
    return response.status(502).json({ error: "No fue posible contactar Telegram" });
  }
}
