// supabase/functions/flow-retorno/index.ts
//
// ADÓNDE VUELVE EL NAVEGADOR del jugador cuando termina en Flow
// (`urlReturn`). Flow hace un POST del navegador a esta URL con el token.
//
// ESTA PÁGINA NO DECIDE NADA. No confirma, no rechaza, no toca la base. El
// estado de la reserva lo fija el aviso de servidor a servidor
// (`flow-confirmacion`), que es el único que pregunta firmado. Acá lo único
// que pasa es que la persona vuelve a la app, y la app pregunta por su
// cuenta cómo quedó.
//
// Por qué no es un deep link directo: Flow llega con un POST, y un POST del
// navegador a `futfinder://` no existe. Tiene que ser una URL https que
// reciba el POST y después rebote.
//
// Se despliega SIN verificación de JWT: el navegador de un jugador no manda
// el token de Supabase. Como no lee ni escribe nada, no hay qué proteger.

const PAGINA = (destino: string) => `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Volviendo a FutFinder</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0f1115; color: #f4f6f8; text-align: center; padding: 24px;
  }
  .caja { max-width: 340px; }
  h1 { font-size: 20px; margin: 0 0 10px; }
  p { font-size: 14px; line-height: 1.5; color: #a7b0bb; margin: 0 0 22px; }
  a {
    display: inline-block; padding: 13px 22px; border-radius: 14px;
    background: #21c07a; color: #06231a; font-weight: 700; text-decoration: none;
  }
</style>
</head>
<body>
  <div class="caja">
    <h1>Listo, vuelve a la app</h1>
    <p>Estamos confirmando el pago con el banco. En FutFinder vas a ver cómo quedó tu reserva en unos segundos.</p>
    <a href="${destino}">Abrir FutFinder</a>
  </div>
  <script>setTimeout(function () { location.href = ${JSON.stringify(destino)}; }, 700);</script>
</body>
</html>`;

Deno.serve(async (req) => {
  // El cuerpo se consume y se descarta a propósito: si no se lee, algunos
  // clientes tratan la respuesta como conexión cortada.
  try {
    if (req.method === "POST") await req.text();
  } catch {
    // Da lo mismo: esta página se muestra igual.
  }
  const destino = (Deno.env.get("APP_RETORNO_URL") || "futfinder://").trim();
  return new Response(PAGINA(destino), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});
