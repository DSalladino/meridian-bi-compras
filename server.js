#!/usr/bin/env node
/**
 * Servidor estático minimalista para o Meridian BI.
 * Uso: node server.js  (ou npm start)  →  http://localhost:4173
 *
 * Segurança: apenas /app e /data são públicos. O restante do repositório
 * (incluindo .git, etl, sql e docs) nunca é servido.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);

const PUBLIC_PREFIXES = ["/app/", "/data/"];

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
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; " +
    "frame-ancestors 'self'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Resource-Policy": "same-origin",
};

function send(res, status, body, extra = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...extra });
  res.end(body);
}

/** Resolve um caminho público sem permitir traversal, symlinks ou dotfiles. */
function resolvePublic(pathname) {
  if (!PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  if (pathname.split("/").some((seg) => seg.startsWith("."))) return null;

  const abs = path.resolve(ROOT, "." + pathname);
  const rel = path.relative(ROOT, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;

  // A checagem precisa ser feita também após resolver "..":
  // /app/../package.json resolve para a raiz, mas não é público.
  const top = rel.split(path.sep)[0];
  if (top !== "app" && top !== "data") return null;

  // Garante que o caminho real (após symlinks) permanece dentro de uma
  // das pastas públicas.
  if (fs.existsSync(abs)) {
    const real = fs.realpathSync(abs);
    const realRel = path.relative(ROOT, real);
    if (realRel.startsWith("..") || path.isAbsolute(realRel)) return null;
    const realTop = realRel.split(path.sep)[0];
    if (realTop !== "app" && realTop !== "data") return null;
  }
  return abs;
}

const server = http.createServer((req, res) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, 405, "405 — método não permitido", { Allow: "GET, HEAD" });
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return send(res, 400, "400 — caminho inválido");
    }

    if (pathname.includes("\0")) {
      return send(res, 400, "400 — caminho inválido");
    }
    if (pathname === "/" || pathname === "/app") {
      res.writeHead(302, { ...SECURITY_HEADERS, Location: "/app/" });
      return res.end();
    }
    if (pathname.endsWith("/")) pathname += "index.html";

    const abs = resolvePublic(pathname);
    if (!abs) {
      return send(res, 404, "404 — recurso não encontrado");
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return send(res, 404, "404 — arquivo não encontrado");
    }

    const ext = path.extname(abs).toLowerCase();
    const headers = {
      ...SECURITY_HEADERS,
      "Content-Type": MIME[ext] || "application/octet-stream",
      // CSVs podem conter dados importados: nunca cachear.
      "Cache-Control": ext === ".csv" ? "no-store" : "no-cache",
      "X-Robots-Tag": "noindex, nofollow",
    };
    const stat = fs.statSync(abs);
    headers["Content-Length"] = stat.size;
    res.writeHead(200, headers);
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(abs).pipe(res);
  } catch (err) {
    console.error(err);
    send(res, 500, "500 — erro interno");
  }
});

server.listen(PORT, () => {
  console.log(`\n  Meridian BI · Compras & Fornecedores`);
  console.log(`  ▸ http://localhost:${PORT}\n`);
});
