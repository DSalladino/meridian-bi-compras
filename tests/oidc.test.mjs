import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {
  verifyJwt, assinarJwt, pkcePair, roleFromClaims, upsertOidcUser,
  oidcConfigFromEnv, createOidcClient, limparCachesOidc,
} from "../server/oidc.mjs";
import { createProdServer } from "../server/prod.mjs";
import { hashPassword, salvarUsuarios } from "../server/auth.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" };
const jwks = { keys: [jwk] };
const baseClaims = {
  iss: "https://idp.exemplo.com",
  aud: "meridian",
  sub: "user-1",
  email: "ana@exemplo.com",
  email_verified: true,
  name: "Ana",
  nonce: "n-1",
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 300,
};

test("id_token: assinatura, nonce, audience e expiração", () => {
  const token = assinarJwt(baseClaims, privateKey, { kid: "k1" });
  const ok = verifyJwt(token, jwks, { issuer: baseClaims.iss, audience: "meridian", nonce: "n-1" });
  assert.equal(ok.sub, "user-1");

  const [h, , s] = token.split(".");
  const alterado = JSON.stringify({ ...baseClaims, sub: "outro" });
  const forjado = `${h}.${Buffer.from(alterado).toString("base64url")}.${s}`;
  assert.throws(() => verifyJwt(forjado, jwks, { issuer: baseClaims.iss, audience: "meridian" }), /Assinatura/);

  const semNonce = assinarJwt({ ...baseClaims, nonce: "outro" }, privateKey, { kid: "k1" });
  assert.throws(() => verifyJwt(semNonce, jwks, { nonce: "n-1" }), /nonce/);

  const outraAud = assinarJwt({ ...baseClaims, aud: "outro-cliente" }, privateKey, { kid: "k1" });
  assert.throws(() => verifyJwt(outraAud, jwks, { audience: "meridian" }), /audience/);

  const expirado = assinarJwt({ ...baseClaims, exp: Math.floor(Date.now() / 1000) - 120 }, privateKey, { kid: "k1" });
  assert.throws(() => verifyJwt(expirado, jwks, { audience: "meridian" }), /expirado/);

  const outroIssuer = assinarJwt({ ...baseClaims, iss: "https://malicioso" }, privateKey, { kid: "k1" });
  assert.throws(() => verifyJwt(outroIssuer, jwks, { issuer: baseClaims.iss }), /issuer/);
});

test("PKCE S256: challenge corresponde ao verifier", () => {
  const { verifier, challenge } = pkcePair();
  const esperado = crypto.createHash("sha256").update(verifier).digest("base64url");
  assert.equal(challenge, esperado);
  assert.notEqual(verifier, challenge);
});

test("papéis OIDC: mapa explícito, roles, e-mail de admin e papel padrão", () => {
  const cfg = oidcConfigFromEnv({
    MERIDIAN_OIDC_ISSUER: "https://idp", MERIDIAN_OIDC_CLIENT_ID: "meridian",
    MERIDIAN_OIDC_ROLE_MAP: JSON.stringify({ "Meridian-Admins": "admin", "Meridian-Buyers": "comprador" }),
    MERIDIAN_OIDC_ADMINS: "diretor@empresa.com",
    MERIDIAN_OIDC_ADMIN_ROLES: "meridian-admin",
  });
  assert.equal(roleFromClaims({ roles: ["Meridian-Admins"] }, cfg).papel, "admin");
  assert.equal(roleFromClaims({ roles: ["Meridian-Buyers"] }, cfg).papel, "comprador");
  assert.equal(roleFromClaims({ roles: ["meridian-admin"] }, cfg).papel, "admin");
  assert.equal(roleFromClaims({ email: "diretor@empresa.com" }, cfg).papel, "admin");
  const padrao = roleFromClaims({ roles: ["qualquer"] }, cfg);
  assert.equal(padrao.papel, "leitor");
  assert.equal(padrao.explicito, false);
});

test("provisionamento OIDC cria, vincula e preserva papel quando claim não é explícita", () => {
  const cfg = oidcConfigFromEnv({ MERIDIAN_OIDC_ISSUER: "https://idp", MERIDIAN_OIDC_CLIENT_ID: "meridian" });
  const usuarios = [];
  const r1 = upsertOidcUser(usuarios, baseClaims, cfg, { papel: "admin", explicito: true });
  assert.equal(r1.criado, true);
  assert.equal(r1.user.papel, "admin");
  assert.equal(usuarios.length, 1);

  const r2 = upsertOidcUser(usuarios, { ...baseClaims, name: "Ana Atualizada" }, cfg, { papel: "leitor", explicito: false });
  assert.equal(r2.criado, false);
  assert.equal(r2.user.papel, "admin", "claim ausente não deve rebaixar admin existente");
  assert.equal(r2.user.nome, "Ana Atualizada");

  const r3 = upsertOidcUser(usuarios, baseClaims, cfg, { papel: "analista", explicito: true });
  assert.equal(r3.user.papel, "analista");
  assert.equal(usuarios.length, 1);

  const fechado = { ...cfg, autoProvision: false };
  assert.throws(() => upsertOidcUser([], { ...baseClaims, sub: "novo" }, fechado, { papel: "leitor" }), /não provisionado/);
  assert.throws(() => upsertOidcUser([], { ...baseClaims, sub: "novo", email_verified: false }, cfg, { papel: "leitor" }), /não verificado/);
});

function copiarBase(dir) {
  fs.cpSync(path.join(ROOT, "data"), path.join(dir, "data"), { recursive: true });
  fs.cpSync(path.join(ROOT, "app"), path.join(dir, "app"), { recursive: true });
  fs.rmSync(path.join(dir, "data", "imported"), { recursive: true, force: true });
  const users = path.join(dir, "usuarios.json");
  const admin = hashPassword("admin-local-1");
  salvarUsuarios(users, [{ usuario: "admin", nome: "Admin", papel: "admin", ativo: true, ...admin }]);
  return users;
}

test("fluxo OIDC completo: discovery, PKCE, id_token, provisionamento e sessão", async () => {
  limparCachesOidc();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-oidc-"));
  const users = copiarBase(dir);
  let issuer = "";
  let pendente = null;
  const idp = http.createServer(async (req, res) => {
    const u = new URL(req.url, issuer);
    const json = (obj, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (u.pathname === "/.well-known/openid-configuration") {
      return json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
      });
    }
    if (u.pathname === "/jwks") return json(jwks);
    if (u.pathname === "/token") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = new URLSearchParams(raw);
      const challenge = crypto.createHash("sha256").update(body.get("code_verifier") || "").digest("base64url");
      if (body.get("code") !== "abc" || challenge !== pendente?.challenge) {
        return json({ error: "invalid_grant" }, 400);
      }
      const idToken = assinarJwt({
        ...baseClaims, iss: issuer, nonce: pendente.nonce, roles: ["meridian-admin"],
      }, privateKey, { kid: "k1" });
      return json({ access_token: "at", token_type: "Bearer", id_token: idToken });
    }
    json({ error: "not_found" }, 404);
  });
  await new Promise((r) => idp.listen(0, "127.0.0.1", r));
  issuer = `http://127.0.0.1:${idp.address().port}`;
  const oidc = createOidcClient(oidcConfigFromEnv({
    MERIDIAN_OIDC_ISSUER: issuer,
    MERIDIAN_OIDC_CLIENT_ID: "meridian",
    MERIDIAN_OIDC_ADMIN_ROLES: "meridian-admin",
  }));
  const inst = createProdServer({ root: dir, usersFile: users, logDir: path.join(dir, "logs"), sessionSecret: "s", oidcClient: oidc });
  await new Promise((r) => inst.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${inst.server.address().port}`;
  try {
    const login = await fetch(`${base}/login.html`);
    assert.match(await login.text(), /Entrar com SSO/);
    const start = await fetch(`${base}/auth/oidc/start`, { redirect: "manual" });
    assert.equal(start.status, 303);
    const location = new URL(start.headers.get("location"));
    pendente = { nonce: location.searchParams.get("nonce"), challenge: location.searchParams.get("code_challenge") };
    assert.ok(pendente.nonce && pendente.challenge);
    assert.equal(location.searchParams.get("code_challenge_method"), "S256");

    const cb = await fetch(`${base}/auth/oidc/callback?code=abc&state=${encodeURIComponent(location.searchParams.get("state"))}`, { redirect: "manual" });
    assert.equal(cb.status, 303, await cb.text());
    assert.equal(cb.headers.get("location"), "/app/");
    const cookie = (cb.headers.getSetCookie() || [])[0]?.split(";")[0];
    assert.ok(cookie?.includes("meridian_sessao"));

    const replay = await fetch(`${base}/auth/oidc/callback?code=abc&state=${encodeURIComponent(location.searchParams.get("state"))}`, { redirect: "manual" });
    assert.equal(replay.status, 303);
    assert.equal(replay.headers.get("location"), "/login.html?erro=oidc_estado");

    const sess = await fetch(`${base}/api/session`, { headers: { cookie } });
    const body = await sess.json();
    assert.equal(body.autenticado, true);
    assert.equal(body.usuario.papel, "admin");
    assert.equal(body.usuario.email, "ana@exemplo.com");

    const lista = await fetch(`${base}/api/usuarios`, { headers: { cookie } });
    const usersJson = await lista.json();
    const oidcUser = usersJson.usuarios.find((u) => u.email === "ana@exemplo.com");
    assert.ok(oidcUser);
    assert.equal(oidcUser.origem, "sso");
  } finally {
    inst.server.close();
    idp.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
