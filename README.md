# Featherless Chat — OLED Edition (iPhone-ready)

PWA pensada para usarse **solo con el iPhone** (Safari → Añadir a pantalla de inicio).  
No necesitas Termux, PC, ni servidor.

## Uso en el iPhone (recomendado)

1. Sube los archivos a cualquier hosting estático gratuito:
   - GitHub Pages
   - Netlify Drop (arrastra la carpeta)
   - Cloudflare Pages
   - Vercel (static)
   - o cualquier sitio que sirva HTML/CSS/JS

2. Abre la URL en **Safari** del iPhone.

3. Toca el botón Compartir → **Añadir a pantalla de inicio**.

4. Abre la app desde el icono.

5. Entra al menú ☰ → pega tu **API key de Featherless** → se guarda solo en ese iPhone.

Listo. El chat llama directamente a `https://api.featherless.ai/v1`.  
Streaming, 32K de contexto, thinking, temperatura, conversaciones, estadísticas… todo funciona.

## Características

- OLED negro real + glass/blur
- Animaciones de mensajes
- Diseño optimizado para iPhone (safe-area)
- Menú lateral
- Conversaciones guardables
- 32 768 tokens + ventana deslizante (recorta al ~92 %→85 % del presupuesto seguro, por pares user/assistant)
- Barra de contexto en tiempo real
- Streaming + botón detener
- Thinking ON/OFF (`chat_template_kwargs.enable_thinking` según docs Featherless)
- Razonamiento visible en vivo (bloque colapsable tipo GPT: “Pensando…” → “Razonó · Xs”)
- Detección heurística de modelos con thinking (Qwen3/3.5/3.6, GLM, DeepSeek V4, Gemma 4, Kimi, etc.)
- Temperature / Max output
- Selector de modelos
- System prompt
- Estadísticas
- Copiar código + Markdown básico
- Persistencia local (localStorage)
- Exportar JSON
- Manifest PWA

## Opcional: proxy (solo si quieres ocultar la key)

Si más adelante quieres publicar la app y que **nadie** vea la API key:

```bash
npm install
FEATHERLESS_API_KEY=tu_clave npm start
```

Y en el HTML (antes de app.js) pon:

```html
<script>window.FEATHERLESS_BASE = "/v1";</script>
```

Sin esa línea la app sigue funcionando en modo directo (clave en el iPhone).

## Notas

- El contador de tokens del navegador es una estimación. Cuando Featherless devuelve `usage`, esas cifras se usan para las estadísticas.
- La API key nunca sale de tu dispositivo salvo hacia Featherless.
- Funciona offline la interfaz; solo necesita internet para las respuestas del modelo.

## Archivos

| Archivo        | Uso                          |
|----------------|------------------------------|
| index.html     | UI                           |
| style.css      | Estilos OLED                 |
| app.js         | Lógica + streaming           |
| manifest.json  | PWA                          |
| server.js      | Proxy opcional (Node)        |
| package.json   | Solo si usas el proxy        |

Hecho para abrir en Safari del iPhone y usarlo como app real.
