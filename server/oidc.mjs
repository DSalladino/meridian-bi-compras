/* OpenID Connect (Authorization Code + PKCE), sem dependências externas.
 *
 * Compatível com provedores corporativos que expõem discovery
 * (/.well-known/openid-configuration) e JWKS: Azure AD/Entra ID, Google,
 * Okta, Keycloak, Authentik etc.
 *
 * Decisões:
 *  - PKCE (S256) sempre, mesmo em client confidencial.
 *  - state e nonce de uso único, guardados em memória por 10 minutos.
 *  - id_token validado por assinatura (RS256/384/512 ou ES256) + iss/aud/exp/nonce.
 *  - papéis vêm de claim configurável (roles/groups) ou mapa explícito.
 */
import crypto from "node:crypto";

const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const JWKS_TTL_MS = 60 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;

const discoveryCache = new Map();
const jwksCache = new Map();

export function oidcConfigFromEnv(env = process.env) {
  const issuer = String(env.MERIDIAN_OIDC_ISSUER || "").trim().replace(/\/$/, "");
  if (!issuer) return null;
  const clientId = String(env.MERIDIAN_OIDC_CLIENT_ID || "").trim();
  if (!clientId) return null;
  const list = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
  let roleMap = {};
  if (env.MERIDIAN_OIDC_ROLE_MAP) {
    try { roleMap = JSON.parse(env.MERIDIAN_OIDC_ROLE_MAP); } catch { /* inválido: ignora */ }
  }
  return {
    issuer,
    clientId,
    clientSecret: String(env.MERIDIAN_OIDC_CLIENT_SECRET || ""),
    scopes: String(env.MERIDIAN_OIDC_SCOPES || "openid email profile"),
    redirectUri: String(env.MERIDIAN_OIDC_REDIRECT_URI || "").trim(),
    publicUrl: String(env.MERIDIAN_PUBLIC_URL || "").trim().replace(/\/$/, ""),
    roleClaim: String(env.MERIDIAN_OIDC_ROLE_CLAIM || "roles"),
    roleMap,
    adminRoles: list(env.MERIDIAN_OIDC_ADMIN_ROLES || "meridian-admin,admin"),
    adminsEmails: list(env.MERIDIAN_OIDC_ADMINS).map((e) => e.toLowerCase()),
    defaultRole: String(env.MERIDIAN_OIDC_DEFAULT_ROLE || "leitor"),
    autoProvision: String(env.MERIDIAN_OIDC_AUTO_PROVISION || "1") !== "0",
    buttonLabel: String(env.MERIDIAN_OIDC_BUTTON_LABEL || "Entrar com SSO"),
    acrValues: String(env.MERIDIAN_OIDC_ACR_VALUES || ""),
    prompt: String(env.MERIDIAN_OIDC_PROMPT || ""),
  };
}

export async function discover(issuer, { fetchImpl = fetch, force = false, now = Date.now() } = {}) {
  const hit = discoveryCache.get(issuer);
  if (!force && hit && now - hit.at < DISCOVERY_TTL_MS) return hit.doc;
  const url = `${issuer}/.well-known/openid-configuration`;
  const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`OIDC discovery falhou (${res.status}) em ${url}`);
  const doc = await res.json();
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
    throw new Error("OIDC discovery sem authorization_endpoint/token_endpoint/jwks_uri.");
  }
  const docIssuer = String(doc.issuer || issuer).replace(/\/$/, "");
  if (docIssuer !== issuer) throw new Error(`OIDC issuer divergente: ${docIssuer} (esperado ${issuer}).`);
  discoveryCache.set(issuer, { at: now, doc });
  return doc;
}

export async function fetchJwks(jwksUri, { fetchImpl = fetch, force = false, now = Date.now() } = {}) {
  const hit = jwksCache.get(jwksUri);
  if (!force && hit && now - hit.at < JWKS_TTL_MS) return hit.jwks;
  const res = await fetchImpl(jwksUri, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`OIDC JWKS falhou (${res.status}) em ${jwksUri}`);
  const jwks = await res.json();
  if (!Array.isArray(jwks.keys) || !jwks.keys.length) throw new Error("OIDC JWKS sem chaves.");
  jwksCache.set(jwksUri, { at: now, jwks });
  return jwks;
}

export function limparCachesOidc() {
  discoveryCache.clear();
  jwksCache.clear();
}

const ALGORITMOS = {
  RS256: { hash: "RSA-SHA256", tipo: "rsa" },
  RS384: { hash: "RSA-SHA384", tipo: "rsa" },
  RS512: { hash: "RSA-SHA512", tipo: "rsa" },
  ES256: { hash: "sha256", tipo: "ec" },
};

/** Verifica um JWT OIDC contra um JWKS e valida claims essenciais. */
export function verifyJwt(token, jwks, { issuer, audience, nonce, now = Date.now(), clockSkewSeconds = 60 } = {}) {
  if (typeof token !== "string") throw new Error("id_token ausente.");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("id_token malformado.");
  const [h64, p64, s64] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(h64, "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(p64, "base64url").toString("utf8"));
  } catch {
    throw new Error("id_token com JSON inválido.");
  }
  const alg = ALGORITMOS[header.alg];
  if (!alg) throw new Error(`Algoritmo de id_token não suportado: ${header.alg}`);
  const chaves = jwks?.keys || [];
  const jwk = chaves.find((k) => (header.kid ? k.kid === header.kid : true) && (!k.use || k.use === "sig"));
  if (!jwk) {
    const err = new Error("Chave de assinatura do id_token não encontrada.");
    err.code = "kid_desconhecido";
    throw err;
  }
  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const data = Buffer.from(`${h64}.${p64}`);
  const sig = Buffer.from(s64, "base64url");
  const ok = alg.tipo === "rsa"
    ? crypto.verify(alg.hash, data, publicKey, sig)
    : crypto.verify(alg.hash, data, { key: publicKey, dsaEncoding: "ieee-p1363" }, sig);
  if (!ok) throw new Error("Assinatura do id_token inválida.");

  if (issuer) {
    const claimIssuer = String(payload.iss || "").replace(/\/$/, "");
    if (claimIssuer !== String(issuer).replace(/\/$/, "")) throw new Error("id_token com issuer inválido.");
  }
  if (audience) {
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(audience)) throw new Error("id_token com audience inválido.");
    if (payload.azp && payload.azp !== audience) throw new Error("id_token com azp inválido.");
  }
  const agora = now / 1000;
  if (!Number.isFinite(payload.exp) || payload.exp < agora - clockSkewSeconds) throw new Error("id_token expirado.");
  if (payload.iat && payload.iat > agora + clockSkewSeconds) throw new Error("id_token emitido no futuro.");
  if (nonce && payload.nonce !== nonce) throw new Error("id_token com nonce inválido.");
  return payload;
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

/** Cria um JWT assinado (usado nos testes e em provedores de desenvolvimento). */
export function assinarJwt(payload, privateKey, { kid, alg = "RS256", headerExtra = {} } = {}) {
  const header = { alg, typ: "JWT", ...(kid ? { kid } : {}), ...headerExtra };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const data = Buffer.from(`${h}.${p}`);
  const hash = ALGORITMOS[alg]?.hash || "RSA-SHA256";
  const sig = crypto.sign(hash, data, privateKey);
  return `${h}.${p}.${b64url(sig)}`;
}

export function pkcePair() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/** Mapeia claims do provedor para papéis locais. */
export function roleFromClaims(payload, config) {
  const raw = payload?.[config.roleClaim] ?? payload?.roles ?? payload?.groups
    ?? payload?.realm_access?.roles ?? payload?.resource_access?.[config.clientId]?.roles;
  const roles = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === "string" ? raw.split(/[\s,]+/).filter(Boolean) : [];
  const email = String(payload?.email || "").toLowerCase();
  if (email && config.adminsEmails?.includes(email)) return { papel: "admin", explicito: true };
  for (const role of roles) {
    const mapped = config.roleMap?.[role];
    if (mapped) return { papel: mapped, explicito: true };
  }
  if (roles.some((r) => config.adminRoles.includes(r))) return { papel: "admin", explicito: true };
  return { papel: config.defaultRole, explicito: false };
}

/** Cria/atualiza o usuário local a partir das claims do provedor. */
export function upsertOidcUser(usuarios, payload, config, role) {
  const sub = String(payload.sub || "");
  const email = String(payload.email || "").toLowerCase();
  const nome = String(payload.name || payload.preferred_username || email || sub);
  let user = usuarios.find((u) => u.oidcSub && u.oidcSub === sub)
    || (email && payload.email_verified !== false ? usuarios.find((u) => String(u.email || "").toLowerCase() === email) : null);
  const agora = new Date().toISOString();
  if (!user && payload.email_verified === false) {
    const err = new Error("E-mail do provedor não verificado.");
    err.code = "sem_acesso";
    throw err;
  }
  if (user) {
    user.nome = nome || user.nome;
    user.email = email || user.email;
    user.oidcSub = sub;
    user.oidcIssuer = config.issuer;
    user.ultimoLogin = agora;
    if (role.explicito && user.papel !== role.papel) {
      user.papel = role.papel;
      user.papelOrigem = "oidc";
    }
    return { user, criado: false };
  }
  if (!config.autoProvision) {
    const err = new Error("Usuário não provisionado; peça acesso ao administrador.");
    err.code = "sem_acesso";
    throw err;
  }
  user = {
    usuario: ((email.split("@")[0] || sub).slice(0, 40).replace(/[^a-zA-Z0-9._-]/g, "") || `sso-${sub.slice(-8)}`),
    nome,
    email,
    papel: role.papel,
    papelOrigem: "oidc",
    ativo: true,
    oidcSub: sub,
    oidcIssuer: config.issuer,
    criadoEm: agora,
    ultimoLogin: agora,
  };
  // Evita colisão de username com contas locais.
  if (usuarios.some((u) => u.usuario === user.usuario)) user.usuario = `${user.usuario}-${sub.slice(-6)}`;
  usuarios.push(user);
  return { user, criado: true };
}

export function criarGerenciadorEstado({ now = Date.now } = {}) {
  const estados = new Map();
  const limpar = () => {
    const t = now();
    for (const [k, v] of estados) if (v.expiraEm < t) estados.delete(k);
  };
  return {
    criar(dados) {
      limpar();
      const state = crypto.randomBytes(24).toString("base64url");
      estados.set(state, { ...dados, expiraEm: now() + STATE_TTL_MS });
      return state;
    },
    consumir(state) {
      limpar();
      const dados = estados.get(state);
      estados.delete(state);
      return dados || null;
    },
  };
}

export function createOidcClient(config, { fetchImpl = fetch } = {}) {
  if (!config) return null;
  const estados = criarGerenciadorEstado();

  const cliente = {
    config,
    estados,
    get disponivel() { return true; },
    async discovery() { return discover(config.issuer, { fetchImpl }); },
    async authorizationUrl({ redirectUri }) {
      const doc = await discover(config.issuer, { fetchImpl });
      const nonce = crypto.randomBytes(24).toString("base64url");
      const { verifier, challenge } = pkcePair();
      const state = estados.criar({ nonce, verifier, redirectUri });
      const params = new URLSearchParams({
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: redirectUri,
        scope: config.scopes,
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
      });
      if (config.prompt) params.set("prompt", config.prompt);
      if (config.acrValues) params.set("acr_values", config.acrValues);
      return `${doc.authorization_endpoint}?${params.toString()}`;
    },
    async verificarIdToken(idToken, nonce) {
      const doc = await discover(config.issuer, { fetchImpl });
      let jwks = await fetchJwks(doc.jwks_uri, { fetchImpl });
      try {
        return verifyJwt(idToken, jwks, { issuer: config.issuer, audience: config.clientId, nonce });
      } catch (err) {
        if (err.code !== "kid_desconhecido") throw err;
        jwks = await fetchJwks(doc.jwks_uri, { fetchImpl, force: true });
        return verifyJwt(idToken, jwks, { issuer: config.issuer, audience: config.clientId, nonce });
      }
    },
    async trocarCodigo({ code, codeVerifier, redirectUri }) {
      const doc = await discover(config.issuer, { fetchImpl });
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: config.clientId,
        code_verifier: codeVerifier,
      });
      const headers = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
      const metodos = doc.token_endpoint_auth_methods_supported || [];
      const usarBasic = config.clientSecret
        && metodos.includes("client_secret_basic")
        && !metodos.includes("client_secret_post");
      if (usarBasic) {
        headers.Authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
      } else if (config.clientSecret) {
        body.set("client_secret", config.clientSecret);
      }
      const res = await fetchImpl(doc.token_endpoint, { method: "POST", headers, body });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = {}; }
      if (!res.ok) throw new Error(`OIDC token endpoint falhou (${res.status}): ${json.error_description || json.error || text.slice(0, 200)}`);
      if (!json.id_token) throw new Error("OIDC token endpoint não retornou id_token.");
      return json;
    },
  };
  return cliente;
}
