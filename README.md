# Consulta Diaria BOE

Aplicación independiente basada en Bocmi. Incluye consulta diaria, búsqueda literal por periodo, calendario, filtro opcional por municipio, clasificación con Gemini, resultados principales y complementarios, progreso, reintentos y caché separada.

## Vercel
- Project Name: `consulta-boe`
- Preset: `Other`
- Root Directory: `./`
- Añadir `GEMINI_API_KEY` como variable del servidor y volver a desplegar. Los modelos opcionales `GEMINI_MODEL` y `GEMINI_FALLBACK_MODEL` pueden configurarse como en Bocmi.
- No introducir claves en archivos públicos ni en el navegador.

## Fuente
Sumario oficial JSON: `https://www.boe.es/datosabiertos/api/boe/sumario/AAAAMMDD`. Textos XML: `https://www.boe.es/diario_boe/xml.php?id=IDENTIFICADOR`.
Se admiten BOE-A y BOE-B; se comprueba la pertenencia al sumario del día. No se incluye BORME ni los tablones de notificaciones o edictos judiciales.

## Criterios
Se conserva el criterio editorial actual de Bocmi: urbanismo, gestión y tramitación territorial y ambiental, excluyendo empleo y contratación rutinaria. Se conserva Madrid y sus municipios, incluyendo normativa estatal aplicable. Los resultados se deciden leyendo el texto completo, sin trasladar las secciones autonómicas del BOCM al BOE.

## Comprobaciones
`npm ci` y `node --test test/*.test.js`.
La conexión a Gemini requiere una clave y debe validarse en el despliegue. No se han habilitado envíos de correo ni tareas programadas.

Los nombres internos de algunos módulos conservan “bocm” para mantener los contratos de la base reutilizada. Todas las descargas de boletines se dirigen al BOE y la caché usa un espacio propio.
