# Control de Empaquetamiento – Poliducto Libertad–Pascuales

App web estática basada en el archivo `EL MARIO(1).xlsx`. Calcula cuánto producto permanece en el ducto y representa su ubicación proporcional a lo largo de 127 km.

La recepción se obtiene automáticamente al comparar dos lecturas del tanque. El volumen calculado suma a `RECIBIDO` de la primera partida y a `BOMBEADO` de la última partida.

Cuando el volumen recibido completa la primera partida, esta se retira automáticamente. Cualquier volumen excedente continúa consumiendo la siguiente partida en orden.

El caudal se calcula en BBL/H según el volumen recibido y el tiempo transcurrido. La hora avanza automáticamente una hora después de registrar, pero el operador puede modificarla. El acumulado puede iniciar en cero o en un valor manual.

La estimación operativa toma el saldo de la primera partida y lo divide para el último caudal registrado. Muestra el faltante en BBL, el tiempo adicional en horas y minutos y la hora estimada de finalización. El caudal se obtiene automáticamente con las tablas de aforo, pero puede corregirse manualmente. El panel incluye un botón para reiniciar el cálculo.

## Aforo de tanques

El módulo de tanques utiliza las tablas de calibración de `CONDICIONES POLIDUCTOS (version 3).xlsx` para los TP-09, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 24, 25, 26, 27, 28 y 29. El operador ingresa hora y nivel inicial, hora y nivel actual. Desde el primer registro, la app calcula la diferencia recibida en barriles, el caudal en BBL/H y lo suma al acumulado inicial. Después, el nivel actual se convierte automáticamente en el nivel inicial de la siguiente lectura.

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

- Saldo en ducto = Bombeado − Recibido (sin permitir valores negativos).
- Porcentaje = Saldo en ducto del producto ÷ volumen total en ducto.
- Longitud = Porcentaje × 127 km.
- Los productos se ubican en el orden de las partidas: la primera fila queda más próxima a Pascuales.

La app funciona completamente en el navegador y no envía información a servidores externos.
