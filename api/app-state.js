const headers = key => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json"
});

module.exports = async function handler(request, response) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return response.status(503).json({ error: "Sincronización no configurada" });

  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/app_state?id=eq.1`;
  try {
    if (request.method === "GET") {
      const result = await fetch(`${endpoint}&select=state,updated_at`, { headers: headers(key) });
      const data = await result.json();
      if (!result.ok) return response.status(502).json({ error: "No se pudo leer el estado" });
      return response.status(200).json(data[0] || { state: {}, updated_at: null });
    }

    if (request.method === "PUT") {
      const state = request.body?.state;
      if (!state || typeof state !== "object" || Array.isArray(state)) {
        return response.status(400).json({ error: "Estado no válido" });
      }
      if (JSON.stringify(state).length > 750000) {
        return response.status(413).json({ error: "El historial es demasiado grande" });
      }
      const updatedAt = new Date().toISOString();
      const result = await fetch(endpoint, {
        method: "PATCH",
        headers: { ...headers(key), Prefer: "return=representation" },
        body: JSON.stringify({ state, updated_at: updatedAt })
      });
      const data = await result.json();
      if (!result.ok) return response.status(502).json({ error: "No se pudo guardar el estado" });
      return response.status(200).json(data[0] || { state, updated_at: updatedAt });
    }

    response.setHeader("Allow", "GET, PUT");
    return response.status(405).json({ error: "Método no permitido" });
  } catch (error) {
    return response.status(502).json({ error: "No fue posible contactar la base de datos" });
  }
};
