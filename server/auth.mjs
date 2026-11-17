/* Autenticação do servidor de produção: scrypt, sessão assinada e usuários.
 *
 * Sem dependências externas. A senha nunca é armazenada em texto: cada usuário
 * tem salt aleatório e hash scrypt. A sessão é um token assinado com HMAC
 * (stateless), o que permite reiniciar o processo sem derrubar todo mundo.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PAPEIS = Object.freeze({
  admin: { label: "Administrador", importar: true, administrar: true, exportar: true },
  analista: { label: "Analista", importar: true, administrar: false, exportar: true },
  comprador: { label: "Comprador", importar: true, administrar: false, exportar: true },
  leitor: { label: "Leitor", importar: false, administrar: false, exportar: true },
});

export const podeImportar = (papel) => Boolean(PAPEIS[papel]?.importar);
export const podeAdministrar = (papel) => Boolean(PAPEIS[papel]?.administrar);

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("A senha deve ter pelo menos 8 caracteres.");
  }
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p })
    .toString("hex");
  return { salt, hash, algoritmo: "scrypt", parametros: "N=16384,r=8,p=1" };
}

export function verifyPassword(password, user) {
  if (!user?.salt || !user?.hash) return false;
  try {
    const expected = Buffer.from(user.hash, "hex");
    const actual = crypto.scryptSync(String(password), user.salt, expected.length, {
      N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
    });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function carregarUsuarios(file) {
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  const list = Array.isArray(raw) ? raw : raw.usuarios;
  if (!Array.isArray(list)) throw new Error(`Formato inválido em ${file}: esperado { "usuarios": [...] }.`);
  return list.filter((u) => u && u.usuario);
}

export function salvarUsuarios(file, usuarios) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ versao: 1, usuarios }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Segredo de sessão persistido com permissão 600 (ou vindo do ambiente). */
export function carregarSegredo(root, env = process.env) {
  if (env.MERIDIAN_SESSION_SECRET) return env.MERIDIAN_SESSION_SECRET;
  const dir = path.join(root, ".secrets");
  const file = path.join(dir, "session.key");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  fs.mkdirSync(dir, { recursive: true });
  const secret = crypto.randomBytes(48).toString("base64url");
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const b64 = (buf) => Buffer.from(buf).toString("base64url");

export function assinarSessao(payload, secret) {
  const body = b64(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function lerSessao(token, secret, now = Date.now()) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.usuario || !payload?.exp || payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(header = "") {
  const out = {};
  for (const part of String(header).split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (key) out[key] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookieSessao(token, { secure = false, maxAgeSeconds = 8 * 3600 } = {}) {
  return [
    `meridian_sessao=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

export function cookieLogout() {
  return "meridian_sessao=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

/** Limite simples de tentativas de login por IP (janela deslizante). */
export function criarRateLimit({ limite = 8, janelaMs = 15 * 60 * 1000 } = {}) {
  const tentativas = new Map();
  return {
    permitir(ip, now = Date.now()) {
      const rec = tentativas.get(ip);
      if (!rec || now > rec.reset) {
        tentativas.set(ip, { count: 1, reset: now + janelaMs });
        return true;
      }
      rec.count += 1;
      return rec.count <= limite;
    },
    limpar(ip) { tentativas.delete(ip); },
    restantes(ip, now = Date.now()) {
      const rec = tentativas.get(ip);
      return !rec || now > rec.reset ? limite : Math.max(0, limite - rec.count);
    },
  };
}
