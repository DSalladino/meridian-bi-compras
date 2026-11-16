#!/usr/bin/env node
/**
 * Servidor estático minimalista para o Meridian BI.
 * Uso: node server.js  (ou npm start)  →  http://localhost:4173
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".md": "text/markdown; charset=utf-8",
};

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") {
      res.writeHead(302, { Location: "/app/" });
      return res.end();
    }
    if (pathname === "/app") {
      res.writeHead(302, { Location: "/app/" });
      return res.end();
    }
    if (pathname.endsWith("/")) pathname += "index.html";

    const abs = path.resolve(ROOT, "." + pathname);
    if (!abs.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("404 — arquivo não encontrado: " + pathname);
    }
    const ext = path.extname(abs).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".csv" ? "no-store" : "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    fs.createReadStream(abs).pipe(res);
  } catch (err) {
    res.writeHead(500);
    res.end("500 — " + err.message);
  }
});

server.listen(PORT, () => {
  console.log(`\n  Meridian BI · Compras & Fornecedores`);
  console.log(`  ▸ http://localhost:${PORT}\n`);
});
