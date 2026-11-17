/* Servidor de produção: login, RBAC, importação persistida e auditoria.
 *
 * Uso: MERIDIAN_PRODUCAO=1 npm start  (ou npm run start:prod)
 *
 * O servidor de demonstração continua em server.js. Este arquivo existe para
 * empresas que precisam de acesso controlado, importações compartilhadas entre
 * usuários e trilha de auditoria — sem exigir banco de dados para o painel
 * (o PostgreSQL continua sendo a camada analítica para Power BI/SQL).
 */
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PAPEIS, podeAdministrar, podeImportar, carregarUsuarios, salvarUsuarios,
  carregarSegredo, assinarSessao, lerSessao, parseCookies, cookieSessao, cookieLogout,
  criarRateLimit, verifyPassword, hashPassword,
} from "./auth.mjs";
import { parseDelimited, TABLES, toCSV } from "../scripts/lib/erp.mjs";
import { normalizeImport, TEMPLATE_HEADER } from "../app/js/import-core.js";
import {
  createOidcClient, oidcConfigFromEnv, roleFromClaims, upsertOidcUser,
} from "./oidc.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
};

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Robots-Tag": "noindex, nofollow",
};

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function send(res, status, body, extra = {}, method = "GET") {
  const headers = { ...SECURITY_HEADERS, ...extra };
  res.writeHead(status, headers);
  res.end(method === "HEAD" ? undefined : body);
}

function sendJSON(res, status, obj, method = "GET", extra = {}) {
  return send(res, status, JSON.stringify(obj), { ...JSON_HEADERS, ...extra }, method);
}

function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Corpo da requisição grande demais."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseBody(req, raw) {
  const type = String(req.headers["content-type"] || "");
  if (type.includes("application/json")) {
    try { return JSON.parse(raw || "{}"); } catch { throw Object.assign(new Error("JSON inválido."), { status: 400 }); }
  }
  return Object.fromEntries(new URLSearchParams(raw || ""));
}

function ipDe(req, trustProxy) {
  if (trustProxy) {
    const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || "—";
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = req.headers.host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Resolve caminho estático sem traversal, symlink ou dotfile. */
function resolvePublic(root, pathname) {
  if (!["app", "data"].includes(pathname.split("/")[1])) return null;
  if (pathname.split("/").some((seg) => seg.startsWith("."))) return null;
  const abs = path.resolve(root, `.${pathname}`);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  if (fs.existsSync(abs)) {
    const real = fs.realpathSync(abs);
    const realRel = path.relative(root, real);
    if (realRel.startsWith("..") || path.isAbsolute(realRel)) return null;
    if (!["app", "data"].includes(realRel.split(path.sep)[0])) return null;
  }
  return abs;
}

function csvRows(file) {
  if (!fs.existsSync(file)) return { header: [], rows: [] };
  return parseDelimited(fs.readFileSync(file, "utf8"), ";");
}

function objectsFromCSV(file) {
  const { header, rows } = csvRows(file);
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

/** Aplica escopo por unidade/categoria do usuário na leitura de fatos. */
function filtrarCSV(file, text, usuario, root) {
  const escopo = usuario?.escopo;
  if (!escopo || (!escopo.unidades?.length && !escopo.categorias?.length)) return text;
  const base = path.basename(file);
  const unidades = new Set(escopo.unidades || []);
  const categorias = new Set(escopo.categorias || []);
  const fornecedores = new Set(escopo.fornecedores || []);
  const { header, rows } = parseDelimited(text, ";");
  const iu = header.indexOf("id_unidade");
  const ic = header.indexOf("id_categoria");
  const iforn = header.indexOf("id_fornecedor");

  let permitidos = rows;
  if (base === "fato_pedidos.csv" || base === "pedidos.csv" || base === "fato_orcamento.csv") {
    permitidos = rows.filter((r) =>
      (!unidades.size || iu < 0 || unidades.has(r[iu])) &&
      (!categorias.size || ic < 0 || categorias.has(r[ic])) &&
      (!fornecedores.size || iforn < 0 || fornecedores.has(r[iforn]))
    );
  } else if (base === "fato_cotacoes.csv") {
    // Cotações herdam o escopo da requisição aprovada.
    const pedidos = [
      ...objectsFromCSV(path.join(root, "data", "fato_pedidos.csv")),
      ...objectsFromCSV(path.join(root, "data", "imported", "pedidos.csv")),
    ].filter((p) =>
      (!unidades.size || unidades.has(p.id_unidade)) &&
      (!categorias.size || categorias.has(p.id_categoria)) &&
      (!fornecedores.size || fornecedores.has(p.id_fornecedor))
    );
    const reqs = new Set(pedidos.map((p) => p.id_requisicao).filter(Boolean));
    permitidos = rows.filter((r) => {
      const req = header.indexOf("id_requisicao");
      const cat = header.indexOf("id_categoria");
      const forn = header.indexOf("id_fornecedor");
      if (req >= 0) return reqs.has(r[req]);
      return (!categorias.size || cat < 0 || categorias.has(r[cat]))
        && (!escopo.fornecedores?.length || forn < 0 || new Set(escopo.fornecedores).has(r[forn]));
    });
  } else if (base === "dim_contratos.csv") {
    permitidos = rows.filter((r) =>
      (!categorias.size || ic < 0 || categorias.has(r[ic])) &&
      (!fornecedores.size || iforn < 0 || fornecedores.has(r[iforn]))
    );
  } else if (base === "fato_precos.csv") {
    permitidos = rows.filter((r) => !categorias.size || ic < 0 || categorias.has(r[ic]));
  } else if (base === "dim_fornecedores.csv") {
    permitidos = rows.filter((r) => !fornecedores.size || iforn < 0 || fornecedores.has(r[iforn]));
  } else if (iforn >= 0 && fornecedores.size) {
    permitidos = rows.filter((r) => fornecedores.has(r[iforn]));
  }
  return toCSV(header, permitidos.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]]))));
}

function audit(logDir, entry) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
    fs.appendFileSync(path.join(logDir, "auditoria.jsonl"), `${line}\n`, { mode: 0o600 });
  } catch (err) {
    console.error("auditoria:", err.message);
  }
}

function auditTail(logDir, limit = 100) {
  const file = path.join(logDir, "auditoria.jsonl");
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  return lines.slice(-Math.max(1, Math.min(limit, 500))).reverse().map((l) => {
    try { return JSON.parse(l); } catch { return { ts: "", acao: "corrompido", detalhe: l }; }
  });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function loginHTML(marca, empresa, erro, sso) {
  const msg = {
    credenciais: "Usuário ou senha inválidos.",
    limite: "Muitas tentativas. Aguarde alguns minutos.",
    sessao: "Sua sessão expirou. Entre novamente.",
    oidc: "Não foi possível concluir o login SSO. Tente novamente.",
    oidc_provider: "O provedor de identidade está indisponível. Tente novamente ou use o login local.",
    oidc_estado: "A sessão de login expirou. Inicie o SSO novamente.",
    oidc_sem_acesso: "Sua conta não tem acesso a esta instalação. Peça liberação ao administrador.",
  }[erro] || "";
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Entrar · ${esc(marca)}</title>
  <link rel="icon" href="/app/assets/favicon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="/app/css/theme.css" />
</head>
<body class="login-body">
  <main class="login-card">
    <div class="login-brand"><span class="login-mark">▥</span> ${esc(marca)}</div>
    <h1>Entrar</h1>
    <p class="muted tiny">${esc(empresa)} · acesso restrito e auditado</p>
    ${msg ? `<div class="notice bad" role="alert">${esc(msg)}</div>` : ""}
    ${sso ? `<a class="btn btn-ghost login-sso" href="/auth/oidc/start">${esc(sso.buttonLabel || "Entrar com SSO")}</a><div class="login-divider"><span>ou entre com usuário local</span></div>` : ""}
    <form method="post" action="/api/login">
      <label for="usuario">Usuário</label>
      <input id="usuario" name="usuario" autocomplete="username" required autofocus />
      <label for="senha">Senha</label>
      <input id="senha" name="senha" type="password" autocomplete="current-password" required />
      <button class="btn btn-primary" type="submit">Entrar</button>
    </form>
    <p class="tiny muted" style="margin-top:18px">Sessão expira automaticamente. Exportações e importações ficam registradas na auditoria.</p>
  </main>
</body>
</html>`;
}

function erroLoginHTML(marca, empresa, motivo, sso) {
  return loginHTML(marca, empresa, motivo, sso);
}

function configDaEmpresa(root) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, "data", "config.json"), "utf8"));
    return { marca: cfg.empresa?.marca || "Meridian BI", empresa: cfg.empresa?.nome || "Meridian" };
  } catch {
    return { marca: "Meridian BI", empresa: "Meridian" };
  }
}

export function createProdServer(options = {}) {
  const root = path.resolve(options.root || ROOT);
  const env = options.env || process.env;
  const dataDir = path.join(root, "data");
  const importedFile = path.join(dataDir, "imported", "pedidos.csv");
  const usersFile = path.resolve(root, options.usersFile || env.MERIDIAN_USERS || "config/usuarios.json");
  const logDir = path.resolve(root, options.logDir || env.MERIDIAN_AUDIT_DIR || "logs");
  const sessionSecret = options.sessionSecret || carregarSegredo(root, env);
  const sessionMs = Number(options.sessionHours || env.MERIDIAN_SESSION_HOURS || 8) * 3600 * 1000;
  const secureCookie = String(env.MERIDIAN_SECURE_COOKIE || "") === "1";
  const oidc = options.oidcClient === null
    ? null
    : options.oidcClient || createOidcClient(oidcConfigFromEnv(env), { fetchImpl: options.fetchImpl || fetch });
  const trustProxy = String(env.MERIDIAN_TRUST_PROXY || "") === "1";
  const maxImported = Number(env.MERIDIAN_MAX_IMPORT_ROWS || 200000);
  const limite = criarRateLimit({ limite: Number(env.MERIDIAN_LOGIN_LIMIT || 8) });
  const configLimites = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(dataDir, "config.json"), "utf8")).limites || {}; } catch { return {}; }
  })();
  const maxUploadRows = Number(env.MERIDIAN_MAX_UPLOAD_ROWS || configLimites.linhasUpload || 5000);

  let usuarios = carregarUsuarios(usersFile);
  let usuariosMtime = fs.existsSync(usersFile) ? fs.statSync(usersFile).mtimeMs : 0;
  function recarregarUsuarios() {
    try {
      if (!fs.existsSync(usersFile)) return;
      const mtime = fs.statSync(usersFile).mtimeMs;
      if (mtime === usuariosMtime) return;
      usuarios = carregarUsuarios(usersFile);
      usuariosMtime = mtime;
    } catch (err) {
      console.error(`usuarios: ${err.message}`);
    }
  }
  if (!usuarios.length) {
    const bootstrap = env.MERIDIAN_BOOTSTRAP_ADMIN;
    if (!bootstrap) {
      throw new Error(
        `Nenhum usuário em ${usersFile}. Crie com: node scripts/usuarios.mjs criar --usuario admin --nome "Admin" --papel admin --senha "..."\n` +
        "Ou defina MERIDIAN_BOOTSTRAP_ADMIN apenas no primeiro boot do container."
      );
    }
    const { salt, hash } = hashPassword(bootstrap);
    usuarios = [{ usuario: "admin", nome: "Administrador", papel: "admin", ativo: true, salt, hash, criadoEm: new Date().toISOString() }];
    salvarUsuarios(usersFile, usuarios);
    console.log("  ▸ usuário admin inicial criado a partir de MERIDIAN_BOOTSTRAP_ADMIN (troque a senha).");
  }

  const porNome = () => {
    recarregarUsuarios();
    return new Map(usuarios.map((u) => [u.usuario, u]));
  };
  const publico = (u) => ({
    usuario: u.usuario,
    nome: u.nome || u.usuario,
    papel: u.papel,
    papelLabel: PAPEIS[u.papel]?.label || u.papel,
    email: u.email || null,
    escopo: u.escopo || null,
  });

  const adminsAtivos = (lista) => lista.filter((u) => u.papel === "admin" && u.ativo !== false);
  const garantirAdmin = (lista) => adminsAtivos(lista).length > 0;
  const normalizarEscopo = (escopo) => {
    if (!escopo || typeof escopo !== "object") return undefined;
    const lista = (v) => (Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : []);
    const out = { unidades: lista(escopo.unidades), categorias: lista(escopo.categorias), fornecedores: lista(escopo.fornecedores) };
    return out.unidades.length || out.categorias.length || out.fornecedores.length ? out : undefined;
  };
  const descricaoUsuario = (u) => ({
    usuario: u.usuario, nome: u.nome, papel: u.papel, ativo: u.ativo !== false, escopo: u.escopo || null,
  });

  function sessaoDe(req) {
    const token = parseCookies(req.headers.cookie || "").meridian_sessao;
    const payload = lerSessao(token, sessionSecret);
    if (!payload) return null;
    const user = porNome().get(payload.usuario);
    if (!user || user.ativo === false) return null;
    if (Number(payload.v || 0) !== Number(user.sessionVersion || 0)) return null;
    return { user, payload };
  }

  function redirectUriOidc(req) {
    if (oidc?.config.redirectUri) return oidc.config.redirectUri;
    if (oidc?.config.publicUrl) return `${oidc.config.publicUrl}/auth/oidc/callback`;
    const proto = (trustProxy && String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim())
      || (req.socket.encrypted ? "https" : "http");
    return `${proto}://${req.headers.host || "localhost"}/auth/oidc/callback`;
  }

  function marcarSessao(req, res, user, extraHeaders = {}) {
    const exp = Date.now() + sessionMs;
    const token = assinarSessao({ usuario: user.usuario, papel: user.papel, v: user.sessionVersion || 0, exp }, sessionSecret);
    const headers = {
      ...extraHeaders,
      "Set-Cookie": cookieSessao(token, { secure: secureCookie, maxAgeSeconds: Math.floor(sessionMs / 1000) }),
    };
    return { exp, headers };
  }

  function dims() {
    const ler = (file, key) => objectsFromCSV(path.join(dataDir, file));
    return {
      fornecedores: ler("dim_fornecedores.csv"),
      categorias: ler("dim_categorias.csv"),
      itens: ler("dim_itens.csv"),
      unidades: ler("dim_unidades.csv"),
      compradores: ler("dim_compradores.csv"),
      contratos: ler("dim_contratos.csv"),
    };
  }

  function proximaData() {
    const todas = [
      ...objectsFromCSV(path.join(dataDir, "fato_pedidos.csv")),
      ...objectsFromCSV(importedFile),
    ].map((p) => p.data_emissao).filter(Boolean).sort();
    return todas[todas.length - 1] || new Date().toISOString().slice(0, 10);
  }

  function importar(rows) {
    const dimensoes = dims();
    const header = TEMPLATE_HEADER;
    const csv = toCSV(header, rows.map((r) => Object.fromEntries(header.map((h) => [h, r[h] ?? ""]))));
    const result = normalizeImport({
      text: csv,
      filename: "api",
      dims: dimensoes,
      minDate: "2000-01-01",
      maxDate: proximaData(),
      maxRows: maxUploadRows,
    });
    if (result.errors.length) return { status: 422, body: { erro: "Validação falhou.", errors: result.errors, warnings: result.warnings } };

    const existentes = objectsFromCSV(importedFile);
    const mapa = new Map(existentes.map((r) => [r.id_pedido, r]));
    let novos = 0;
    let atualizados = 0;
    for (const row of result.rows) {
      const atual = { ...row };
      for (const [k, v] of Object.entries(atual)) {
        if (typeof v === "number" && !Number.isFinite(v)) atual[k] = "";
        if (v == null) atual[k] = "";
      }
      const persist = Object.fromEntries(TABLES.fato_pedidos.cols.map((c) => [c, atual[c] ?? ""]));
      if (mapa.has(row.id_pedido)) atualizados++;
      else novos++;
      mapa.set(row.id_pedido, persist);
    }
    if (mapa.size > maxImported) {
      return { status: 413, body: { erro: `Limite de ${maxImported} pedidos importados excedido.` } };
    }

    fs.mkdirSync(path.dirname(importedFile), { recursive: true });
    if (fs.existsSync(importedFile)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupDir = path.join(dataDir, "backups");
      fs.mkdirSync(backupDir, { recursive: true });
      fs.copyFileSync(importedFile, path.join(backupDir, `pedidos-${stamp}.csv`));
    }
    const sorted = [...mapa.values()].sort((a, b) => String(a.id_pedido).localeCompare(String(b.id_pedido)));
    const tmp = `${importedFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, toCSV(TABLES.fato_pedidos.cols, sorted), "utf8");
    fs.renameSync(tmp, importedFile);
    return { status: 200, body: { ok: true, novos, atualizados, total: mapa.size, warnings: result.warnings } };
  }

  const server = http.createServer(async (req, res) => {
    const method = req.method === "HEAD" ? "HEAD" : req.method;
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { return send(res, 400, "400", {}, method); }
      if (pathname.includes("\0")) return send(res, 400, "400", {}, method);
      const ip = ipDe(req, trustProxy);
      const { marca, empresa } = configDaEmpresa(root);

      /* ------------------------------- APIs -------------------------------- */
      if (pathname === "/api/health") {
        return sendJSON(res, 200, { ok: true, modo: "producao", versao: 1 }, method);
      }

      if (pathname === "/auth/oidc/start" && method === "GET") {
        if (!oidc) return send(res, 404, "404 — SSO não configurado");
        try {
          const url = await oidc.authorizationUrl({ redirectUri: redirectUriOidc(req) });
          return send(res, 303, "", { Location: url, "Cache-Control": "no-store" });
        } catch (err) {
          console.error("oidc start:", err.message);
          audit(logDir, { ip, acao: "login_oidc_falha", detalhe: `provider: ${err.message}` });
          return send(res, 303, "", { Location: "/login.html?erro=oidc_provider" });
        }
      }

      if (pathname === "/auth/oidc/callback" && method === "GET") {
        if (!oidc) return send(res, 404, "404 — SSO não configurado");
        const erroProvider = url.searchParams.get("error");
        const state = url.searchParams.get("state") || "";
        const saved = oidc.estados.consumir(state);
        if (erroProvider) {
          audit(logDir, { ip, acao: "login_oidc_falha", detalhe: `provider retornou ${erroProvider}` });
          return send(res, 303, "", { Location: "/login.html?erro=oidc" });
        }
        if (!saved) {
          audit(logDir, { ip, acao: "login_oidc_falha", detalhe: "state inválido ou expirado" });
          return send(res, 303, "", { Location: "/login.html?erro=oidc_estado" });
        }
        const code = url.searchParams.get("code");
        if (!code) {
          audit(logDir, { ip, acao: "login_oidc_falha", detalhe: "authorization code ausente" });
          return send(res, 303, "", { Location: "/login.html?erro=oidc" });
        }
        try {
          const tokens = await oidc.trocarCodigo({ code, codeVerifier: saved.verifier, redirectUri: saved.redirectUri });
          const claims = await oidc.verificarIdToken(tokens.id_token, saved.nonce);
          if (!claims.sub) throw new Error("claim sub ausente");
          const role = roleFromClaims(claims, oidc.config);
          const { user, criado } = upsertOidcUser(usuarios, claims, oidc.config, role);
          if (user.ativo === false) {
            audit(logDir, { ip, usuario: user.usuario, acao: "login_oidc_falha", detalhe: "usuário inativo" });
            return send(res, 303, "", { Location: "/login.html?erro=oidc_sem_acesso" });
          }
          salvarUsuarios(usersFile, usuarios);
          usuariosMtime = fs.statSync(usersFile).mtimeMs;
          const { headers } = marcarSessao(req, res, user);
          audit(logDir, {
            ip, usuario: user.usuario, papel: user.papel, acao: "login_oidc",
            detalhe: criado ? `usuário provisionado via ${oidc.config.issuer}` : `login via ${oidc.config.issuer}`,
          });
          return send(res, 303, "", { Location: "/app/", ...headers });
        } catch (err) {
          console.error("oidc callback:", err.message);
          audit(logDir, { ip, acao: "login_oidc_falha", detalhe: err.message.slice(0, 300) });
          return send(res, 303, "", { Location: err.code === "sem_acesso" ? "/login.html?erro=oidc_sem_acesso" : "/login.html?erro=oidc" });
        }
      }

      if (pathname === "/api/login" && method === "POST") {
        if (!sameOrigin(req)) return sendJSON(res, 403, { erro: "Origem inválida." }, method);
        if (!limite.permitir(ip)) {
          audit(logDir, { ip, acao: "login_bloqueado", detalhe: "rate limit" });
          if (String(req.headers["content-type"] || "").includes("application/json")) {
            return sendJSON(res, 429, { erro: "Muitas tentativas. Aguarde." }, method);
          }
          return send(res, 303, "", { Location: "/login.html?erro=limite" }, method);
        }
        const body = parseBody(req, await readBody(req, 64 * 1024));
        const usuario = String(body.usuario || "").trim();
        const senha = String(body.senha || "");
        const user = porNome().get(usuario);
        if (!user || user.ativo === false || !verifyPassword(senha, user)) {
          audit(logDir, { ip, usuario, acao: "login_falha", detalhe: "credenciais inválidas" });
          if (String(req.headers["content-type"] || "").includes("application/json")) {
            return sendJSON(res, 401, { erro: "Usuário ou senha inválidos." }, method);
          }
          return send(res, 303, "", { Location: "/login.html?erro=credenciais" }, method);
        }
        limite.limpar(ip);
        const { exp, headers: sessionHeaders } = marcarSessao(req, res, user);
        audit(logDir, { ip, usuario: user.usuario, papel: user.papel, acao: "login", detalhe: "sessão iniciada" });
        if (String(req.headers["content-type"] || "").includes("application/json")) {
          return sendJSON(res, 200, { ok: true, usuario: publico(user), expiraEm: new Date(exp).toISOString() }, method, sessionHeaders);
        }
        return send(res, 303, "", { Location: "/app/", ...sessionHeaders }, method);
      }

      if (pathname === "/api/logout" && method === "POST") {
        const sess = sessaoDe(req);
        if (sess) audit(logDir, { ip, usuario: sess.user.usuario, papel: sess.user.papel, acao: "logout", detalhe: "sessão encerrada" });
        return send(res, 303, "", { Location: "/login.html", "Set-Cookie": cookieLogout() }, method);
      }

      if (pathname === "/api/session") {
        const sess = sessaoDe(req);
        if (!sess) return sendJSON(res, 401, { autenticado: false }, method);
        return sendJSON(res, 200, { autenticado: true, usuario: publico(sess.user), expiraEm: new Date(sess.payload.exp).toISOString() }, method);
      }

      if (pathname === "/api/login" && method === "GET") {
        return send(res, 303, "", { Location: "/login.html" }, method);
      }

      const sess = sessaoDe(req);
      const autenticado = Boolean(sess);

      if (pathname === "/login.html") {
        if (autenticado) return send(res, 303, "", { Location: "/app/" }, method);
        return send(res, 200, erroLoginHTML(marca, empresa, url.searchParams.get("erro"), oidc?.config), { "Content-Type": MIME[".html"], "Cache-Control": "no-store" }, method);
      }

      if (pathname === "/" || pathname === "/app" || pathname === "/app/") {
        if (!autenticado) return send(res, 303, "", { Location: "/login.html" }, method);
        if (pathname !== "/app/") return send(res, 303, "", { Location: "/app/" }, method);
      }

      const arquivoPublico = pathname.startsWith("/app/") || pathname.startsWith("/data/");
      const loginAsset = pathname.startsWith("/app/css/") || pathname.startsWith("/app/assets/");
      if (arquivoPublico && !autenticado && !loginAsset) {
        if (pathname.startsWith("/data/")) return sendJSON(res, 401, { erro: "Não autenticado." }, method);
        return send(res, 303, "", { Location: "/login.html?erro=sessao" }, method);
      }

      if (pathname === "/api/import") {
        if (!autenticado) return sendJSON(res, 401, { erro: "Não autenticado." }, method);
        if (!sameOrigin(req)) return sendJSON(res, 403, { erro: "Origem inválida." }, method);
        if (method === "DELETE") {
          if (!podeAdministrar(sess.user.papel)) return sendJSON(res, 403, { erro: "Apenas administradores podem remover importações." }, method);
          let removidos = 0;
          if (fs.existsSync(importedFile)) {
            removidos = objectsFromCSV(importedFile).length;
            const stamp = new Date().toISOString().replace(/[:.]/g, "-");
            const backupDir = path.join(dataDir, "backups");
            fs.mkdirSync(backupDir, { recursive: true });
            fs.copyFileSync(importedFile, path.join(backupDir, `pedidos-removidos-${stamp}.csv`));
            fs.rmSync(importedFile);
          }
          audit(logDir, { ip, usuario: sess.user.usuario, papel: sess.user.papel, acao: "importacao_removida", detalhe: `${removidos} pedidos` });
          return sendJSON(res, 200, { ok: true, removidos }, method);
        }
        if (method === "POST") {
          if (!podeImportar(sess.user.papel)) return sendJSON(res, 403, { erro: "Seu papel não permite importar." }, method);
          const body = parseBody(req, await readBody(req));
          let rows;
          if (typeof body.text === "string") {
            const v = normalizeImport({
              text: body.text, filename: body.filename || "upload.csv", dims: dims(),
              minDate: "2000-01-01", maxDate: proximaData(), maxRows: maxUploadRows,
            });
            if (v.errors.length) {
              audit(logDir, { ip, usuario: sess.user.usuario, papel: sess.user.papel, acao: "importacao_rejeitada", detalhe: v.errors[0] || "validação" });
              return sendJSON(res, 422, { erro: "Validação falhou.", errors: v.errors, warnings: v.warnings }, method);
            }
            rows = v.rows;
          } else if (Array.isArray(body.rows)) {
            rows = body.rows;
          } else {
            return sendJSON(res, 400, { erro: "Envie { text } ou { rows }." }, method);
          }
          const result = importar(rows);
          if (result.status === 200) {
            audit(logDir, {
              ip, usuario: sess.user.usuario, papel: sess.user.papel, acao: "importacao",
              detalhe: `${result.body.novos} novos, ${result.body.atualizados} atualizados`,
            });
          } else {
            audit(logDir, { ip, usuario: sess.user.usuario, papel: sess.user.papel, acao: "importacao_rejeitada", detalhe: result.body.erro || "erro" });
          }
          return sendJSON(res, result.status, result.body, method);
        }
        return sendJSON(res, 405, { erro: "Método não permitido." }, method, { Allow: "POST, DELETE" });
      }

      if (pathname === "/api/audit/export" && method === "POST") {
        if (!autenticado) return sendJSON(res, 401, { erro: "Não autenticado." }, method);
        if (!sameOrigin(req)) return sendJSON(res, 403, { erro: "Origem inválida." }, method);
        if (PAPEIS[sess.user.papel]?.exportar === false) return sendJSON(res, 403, { erro: "Seu papel não permite exportar." }, method);
        const body = parseBody(req, await readBody(req, 16 * 1024));
        const tipo = String(body.tipo || "desconhecido").slice(0, 40);
        if (!["excel", "pdf", "csv_pedidos", "csv_cotacoes"].includes(tipo)) {
          return sendJSON(res, 400, { erro: "Tipo de exportação inválido." }, method);
        }
        const detalhe = JSON.stringify({
          tipo,
          periodo: body.periodo || null,
          unidade: body.unidade || null,
          categoria: body.categoria || null,
          comprador: body.comprador || null,
          fornecedor: body.fornecedor || null,
          status: body.status || null,
        }).slice(0, 1200);
        audit(logDir, { ip, usuario: sess.user.usuario, papel: sess.user.papel, acao: "exportacao", detalhe });
        return sendJSON(res, 204, {}, method);
      }

      if (pathname === "/api/audit") {
        if (!autenticado) return sendJSON(res, 401, { erro: "Não autenticado." }, method);
        if (!podeAdministrar(sess.user.papel)) return sendJSON(res, 403, { erro: "Acesso restrito a administradores." }, method);
        return sendJSON(res, 200, { eventos: auditTail(logDir, Number(url.searchParams.get("limite") || 100)) }, method);
      }

      if (pathname === "/api/usuarios") {
        if (!autenticado) return sendJSON(res, 401, { erro: "Não autenticado." }, method);
        if (!podeAdministrar(sess.user.papel)) return sendJSON(res, 403, { erro: "Acesso restrito a administradores." }, method);
        if (method === "GET") {
          return sendJSON(res, 200, { usuarios: usuarios.map((u) => ({ ...publico(u), ativo: u.ativo !== false, criadoEm: u.criadoEm || null, email: u.email || "", origem: u.oidcSub ? "sso" : "local" })) }, method);
        }
        if (method === "POST") {
          if (!sameOrigin(req)) return sendJSON(res, 403, { erro: "Origem inválida." }, method);
          const body = parseBody(req, await readBody(req, 64 * 1024));
          const username = String(body.usuario || "").trim();
          const nome = String(body.nome || username).trim().slice(0, 120);
          const papel = String(body.papel || "leitor");
          if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) {
            return sendJSON(res, 422, { erro: "Usuário deve ter 3–40 caracteres (letras, números, . _ -)." }, method);
          }
          if (!PAPEIS[papel]) return sendJSON(res, 422, { erro: "Papel inválido." }, method);
          if (usuarios.some((u) => u.usuario === username)) return sendJSON(res, 409, { erro: "Usuário já existe." }, method);
          const senha = typeof body.senha === "string" && body.senha.length ? body.senha : crypto.randomBytes(9).toString("base64url");
          let credenciais;
          try { credenciais = hashPassword(senha); } catch (err) { return sendJSON(res, 422, { erro: err.message }, method); }
          const user = {
            usuario: username, nome, papel, ativo: true,
            salt: credenciais.salt, hash: credenciais.hash,
            escopo: normalizarEscopo(body.escopo),
            criadoEm: new Date().toISOString(),
          };
          usuarios.push(user);
          salvarUsuarios(usersFile, usuarios);
          usuariosMtime = fs.statSync(usersFile).mtimeMs;
          audit(logDir, { ip, usuario: sess.user.usuario, papel: sess.user.papel, acao: "usuario_criado", detalhe: `${username} (${papel})` });
          return sendJSON(res, 201, {
            usuario: { ...publico(user), ativo: true, criadoEm: user.criadoEm, origem: "local" },
            senhaGerada: senha,
          }, method);
        }
        return sendJSON(res, 405, { erro: "Método não permitido." }, method, { Allow: "GET, POST" });
      }

      const matchUsuario = pathname.match(/^\/api\/usuarios\/([^/]+)$/);
      if (matchUsuario) {
        if (!autenticado) return sendJSON(res, 401, { erro: "Não autenticado." }, method);
        if (!podeAdministrar(sess.user.papel)) return sendJSON(res, 403, { erro: "Acesso restrito a administradores." }, method);
        if (!sameOrigin(req)) return sendJSON(res, 403, { erro: "Origem inválida." }, method);
        const alvo = decodeURIComponent(matchUsuario[1]);
        const idx = usuarios.findIndex((u) => u.usuario === alvo);
        if (idx < 0) return sendJSON(res, 404, { erro: "Usuário não encontrado." }, method);
        const user = usuarios[idx];
        if (method === "PATCH") {
          const body = parseBody(req, await readBody(req, 64 * 1024));
          const proximo = { ...user };
          if (body.nome != null) proximo.nome = String(body.nome).trim().slice(0, 120) || user.usuario;
          if (body.escopo !== undefined) proximo.escopo = normalizarEscopo(body.escopo);
          if (body.papel != null) {
            const papel = String(body.papel);
            if (!PAPEIS[papel]) return sendJSON(res, 422, { erro: "Papel inválido." }, method);
            proximo.papel = papel;
          }
          if (body.ativo != null) proximo.ativo = Boolean(body.ativo);
          if (body.senha != null) {
            try {
              Object.assign(proximo, hashPassword(String(body.senha)));
              proximo.sessionVersion = Number(user.sessionVersion || 0) + 1;
              proximo.senhaTrocadaEm = new Date().toISOString();
            } catch (err) {
              return sendJSON(res, 422, { erro: err.message }, method);
            }
          }
          if ((user.papel === "admin" && proximo.papel !== "admin") || (user.ativo !== false && proximo.ativo === false)) {
            const restantes = usuarios.filter((u, i) => i !== idx);
            restantes.push(proximo);
            if (!garantirAdmin(restantes)) {
              return sendJSON(res, 409, { erro: "A ação deixaria a instalação sem administrador ativo." }, method);
            }
          }
          if (user.ativo !== false && proximo.ativo === false) {
            proximo.sessionVersion = Number(proximo.sessionVersion || 0) + 1;
          }
          usuarios[idx] = proximo;
          salvarUsuarios(usersFile, usuarios);
          usuariosMtime = fs.statSync(usersFile).mtimeMs;
          audit(logDir, {
            ip, usuario: sess.user.usuario, papel: sess.user.papel, acao: "usuario_atualizado",
            detalhe: JSON.stringify(descricaoUsuario(proximo)),
          });
          return sendJSON(res, 200, { usuario: { ...publico(proximo), ativo: proximo.ativo !== false, origem: proximo.oidcSub ? "sso" : "local" } }, method);
        }
        if (method === "DELETE") {
          if (user.papel === "admin" && !garantirAdmin(usuarios.filter((u, i) => i !== idx))) {
            return sendJSON(res, 409, { erro: "Não é possível remover o último administrador ativo." }, method);
          }
          usuarios.splice(idx, 1);
          salvarUsuarios(usersFile, usuarios);
          usuariosMtime = fs.statSync(usersFile).mtimeMs;
          audit(logDir, { ip, usuario: sess.user.usuario, papel: sess.user.papel, acao: "usuario_removido", detalhe: alvo });
          return sendJSON(res, 200, { ok: true }, method);
        }
        return sendJSON(res, 405, { erro: "Método não permitido." }, method, { Allow: "PATCH, DELETE" });
      }

      if (method !== "GET" && method !== "HEAD") return send(res, 405, "405 — método não permitido", { Allow: "GET, HEAD" }, method);

      /* ----------------------------- estáticos ----------------------------- */
      let filePath = pathname;
      if (filePath.endsWith("/")) filePath += "index.html";
      if (filePath === "/app/login.html") return send(res, 303, "", { Location: "/login.html" }, method);
      const abs = resolvePublic(root, filePath);
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return send(res, 404, "404 — recurso não encontrado", {}, method);
      }
      const ext = path.extname(abs).toLowerCase();
      let body = fs.readFileSync(abs);
      if (ext === ".csv" && sess) {
        body = Buffer.from(filtrarCSV(abs, body.toString("utf8"), sess.user, root), "utf8");
      }
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Content-Length": body.length,
        "Cache-Control": ext === ".csv" ? "no-store" : "no-cache",
      });
      res.end(method === "HEAD" ? undefined : body);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      if (res.headersSent) return res.end();
      return sendJSON(res, status, { erro: status >= 500 ? "Erro interno." : err.message }, method);
    }
  });

  return {
    server,
    usersFile,
    importedFile,
    logDir,
    usuarios: () => usuarios,
    importar,
    carregarUsuarios: () => { usuarios = carregarUsuarios(usersFile); return usuarios; },
  };
}

export function startProdServer() {
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || "0.0.0.0";
  const instance = createProdServer();
  instance.server.listen(port, host, () => {
    console.log("\n  Meridian BI · produção");
    console.log(`  ▸ http://localhost:${port}/  (login obrigatório)`);
    console.log(`  ▸ usuários: ${path.relative(ROOT, instance.usersFile)}`);
    console.log(`  ▸ auditoria: ${path.relative(ROOT, instance.logDir)}/auditoria.jsonl\n`);
  });
  return instance;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    startProdServer();
  } catch (err) {
    console.error(`\n  ✗ ${err.message}\n`);
    process.exit(1);
  }
}
