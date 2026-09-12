import express from "express";
import { Readable } from "node:stream";

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.FEATHERLESS_API_KEY;
const UPSTREAM = "https://api.featherless.ai/v1";

app.use(express.static(".", { index: "index.html" }));
app.use(express.json({ limit: "4mb" }));

// Health check
app.get("/health", (_req, res) => {
  res.json({ ok: true, proxy: !!API_KEY, upstream: UPSTREAM });
});

// Proxy /v1/* → Featherless (API key never leaves the server)
app.use("/v1", async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({
      error: "FEATHERLESS_API_KEY no configurada en el servidor. Define la variable de entorno.",
    });
  }

  try {
    const target = UPSTREAM + req.url;
    const headers = {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };

    const init = {
      method: req.method,
      headers,
    };

    if (!["GET", "HEAD"].includes(req.method) && req.body) {
      init.body = JSON.stringify(req.body);
    }

    const upstream = await fetch(target, init);

    // Forward status + selected headers
    res.status(upstream.status);
    const pass = ["content-type", "cache-control", "x-request-id"];
    for (const [k, v] of upstream.headers) {
      if (pass.includes(k.toLowerCase())) res.setHeader(k, v);
    }

    // Streaming body (chat completions SSE)
    if (upstream.body) {
      const nodeStream = Readable.fromWeb(upstream.body);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    console.error("Proxy error:", err);
    if (!res.headersSent) {
      res.status(502).json({ error: String(err?.message || err) });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Featherless Chat OLED → http://localhost:${PORT}`);
  if (!API_KEY) {
    console.warn("⚠️  FEATHERLESS_API_KEY no está definida. El proxy /v1 fallará.");
  } else {
    console.log("✓ Proxy /v1 activo (API key oculta en el servidor)");
  }
});
