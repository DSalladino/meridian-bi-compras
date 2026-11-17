import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  hashPassword, verifyPassword, assinarSessao, lerSessao, cookieSessao, cookieLogout,
  parseCookies, criarRateLimit, carregarUsuarios, salvarUsuarios, PAPEIS,
} from "../server/auth.mjs";

test("scrypt: mesma senha, hash diferente por salt e verificação correta", () => {
  const a = hashPassword("senha-segura-123");
  const b = hashPassword("senha-segura-123");
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
  assert.equal(verifyPassword("senha-segura-123", a), true);
  assert.equal(verifyPassword("senha-errada", a), false);
  assert.throws(() => hashPassword("curta"), /pelo menos 8/);
});

test("sessão assinada detecta adulteração e expiração", () => {
  const secret = crypto.randomBytes(32).toString("hex");
  const token = assinarSessao({ usuario: "ana", papel: "analista", exp: Date.now() + 60_000 }, secret);
  assert.equal(lerSessao(token, secret).usuario, "ana");
  assert.equal(lerSessao(`${token}x`, secret), null);
  assert.equal(lerSessao(token, "outro-segredo"), null);
  const expirada = assinarSessao({ usuario: "ana", exp: Date.now() - 1 }, secret);
  assert.equal(lerSessao(expirada, secret), null);
});

test("cookie de sessão é HttpOnly e SameSite; logout o expira", () => {
  const c = cookieSessao("abc", { maxAgeSeconds: 60 });
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Max-Age=60/);
  assert.doesNotMatch(c, /Secure/);
  assert.match(cookieSessao("abc", { secure: true }), /Secure/);
  assert.match(cookieLogout(), /Max-Age=0/);
  assert.deepEqual(parseCookies("a=1; meridian_sessao=xyz%2B1"), { a: "1", meridian_sessao: "xyz+1" });
});

test("rate limit bloqueia após o limite e libera após a janela", () => {
  const rl = criarRateLimit({ limite: 3, janelaMs: 1000 });
  const t = 1_000_000;
  assert.equal(rl.permitir("1.2.3.4", t), true);
  assert.equal(rl.permitir("1.2.3.4", t), true);
  assert.equal(rl.permitir("1.2.3.4", t), true);
  assert.equal(rl.permitir("1.2.3.4", t), false);
  assert.equal(rl.permitir("5.6.7.8", t), true);
  assert.equal(rl.permitir("1.2.3.4", t + 1001), true);
});

test("arquivo de usuários preserva papéis e permissões", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-users-"));
  const file = path.join(dir, "usuarios.json");
  try {
    const { salt, hash } = hashPassword("senha-forte-1");
    salvarUsuarios(file, [{ usuario: "ana", nome: "Ana", papel: "analista", ativo: true, salt, hash }]);
    const lidos = carregarUsuarios(file);
    assert.equal(lidos.length, 1);
    assert.equal(lidos[0].papel, "analista");
    assert.equal(PAPEIS.analista.importar, true);
    assert.equal(PAPEIS.analista.administrar, false);
    assert.equal(PAPEIS.leitor.importar, false);
    assert.equal(PAPEIS.admin.administrar, true);
    if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
