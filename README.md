# Control de Empaquetamiento – Poliducto Libertad–Pascuales

App web estática basada en el archivo `EL MARIO(1).xlsx`. Calcula cuánto producto permanece en el ducto y representa su ubicación proporcional a lo largo de 127 km.

La pantalla de transferencia muestra el caudal actual en BBL/H y permite registrar manualmente un volumen en BBL. Cada registro suma el volumen a `RECIBE` de la primera partida y a `BOMBEADO` de la última partida.

Cuando el volumen recibido completa la primera partida, esta se retira automáticamente. Cualquier volumen excedente continúa consumiendo la siguiente partida en orden.

Cada caudal se registra con su hora, sin decimales. La aplicación conserva durante la sesión un historial horario y muestra la suma acumulada de todos los caudales registrados.

## Aforo de tanques

El módulo de tanques utiliza las tablas de calibración de `CONDICIONES POLIDUCTOS (version 3).xlsx` para los TP-09, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 24, 25, 26, 27, 28 y 29. El operador selecciona tanque, hora y nivel en metros, centímetros y milímetros. La app muestra el volumen calculado del tanque en galones; desde la segunda lectura obtiene la diferencia recibida y el acumulado en barriles.

## Alerta de Telegram

Cuando la primera partida queda entre 1 y 1.000 BBL, la aplicación envía una sola alerta preventiva. La función utiliza estas variables protegidas en Vercel:

- `TELEGRAM_BOT_TOKEN`: token entregado por BotFather.
- `TELEGRAM_CHAT_ID`: identificador del chat o grupo receptor.

Estas claves deben configurarse en **Vercel → Settings → Environment Variables** y nunca deben escribirse en `app.js` ni subirse a GitHub.

## Publicar en Vercel

1. Descomprima el archivo del proyecto.
2. Entre a [vercel.com](https://vercel.com) y seleccione **Add New → Project**.
3. Importe la carpeta desde GitHub o use Vercel CLI.
4. No requiere comando de compilación. El directorio raíz es la misma carpeta del proyecto.
5. Presione **Deploy**.

También puede probarla localmente abriendo `index.html` en un navegador.

## Cálculo

- En ducto = Enviado − Recibido (sin permitir valores negativos).
- Porcentaje = En ducto del producto ÷ volumen total en ducto.
- Longitud = Porcentaje × 127 km.
- Los productos se ubican en el orden de las partidas: la primera fila queda más próxima a Pascuales.

La app funciona completamente en el navegador y no envía información a servidores externos.
