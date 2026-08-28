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

  const { batch, product, remaining } = request.body || {};
  const remainingNumber = Number(remaining);
  if (!Number.isFinite(remainingNumber) || remainingNumber <= 0 || remainingNumber > ALERT_THRESHOLD) {
    return response.status(400).json({ error: "El saldo no cumple el umbral de alerta" });
  }

  const clean = value => String(value ?? "").replace(/[<>]/g, "").slice(0, 80);
  const text = [
    "⚠️ ALERTA – ESTACIÓN REDUCTORA PASCUALES",
    "",
    `Partida: ${clean(batch)}`,
    `Producto: ${clean(product)}`,
    `Volumen restante: ${Math.round(remainingNumber).toLocaleString("es-EC")} BBL`,
    "",
    "La primera partida alcanzó el nivel preventivo de 1.000 BBL."
  ].join("\n");

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
};
