import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProdServer } from "../server/prod.mjs";
import { hashPassword, salvarUsuarios } from "../server/auth.mjs";
import { parseDelimited } from "../scripts/lib/erp.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

function criarRaiz() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-prod-"));
  fs.cpSync(path.join(ROOT, "data"), path.join(dir, "data"), { recursive: true });
  fs.cpSync(path.join(ROOT, "app"), path.join(dir, "app"), { recursive: true });
  fs.rmSync(path.join(dir, "data", "imported"), { recursive: true, force: true });
  fs.rmSync(path.join(dir, "data", "backups"), { recursive: true, force: true });
  const users = path.join(dir, "usuarios.json");
  const admin = hashPassword("admin-senha-1");
  const leitor = hashPassword("leitor-senha-1");
  salvarUsuarios(users, [
    { usuario: "admin", nome: "Admin", papel: "admin", ativo: true, ...admin },
    { usuario: "leitor", nome: "Leitor", papel: "leitor", ativo: true, ...leitor, escopo: { unidades: ["U1"], categorias: [] } },
  ]);
  return { dir, users, sessionsDir: path.join(dir, "logs") };
}

async function abrir(inst) {
  await new Promise((r) => inst.server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${inst.server.address().port}`;
}

function cliente(base) {
  let cookie = "";
  return async (rota, opts = {}) => {
    const res = await fetch(base + rota, {
      ...opts,
      redirect: "manual",
      headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) },
    });
    const set = res.headers.getSetCookie?.() || [];
    if (set.length) cookie = set[0].split(";")[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* html/csv */ }
    return { status: res.status, location: res.headers.get("location"), text, json };
  };
}

const CSV = [
  "id_pedido;id_requisicao;data_emissao;id_fornecedor;id_item;id_categoria;id_comprador;id_unidade;quantidade;valor_unitario;frete;valor_total;preco_referencia;status;data_entrega_prevista;data_entrega_real;qtd_recebida;qtd_defeito;tem_contrato",
  "PO-API-1;REQ-API-1;2026-09-10;F001;I001;K1;C1;U1;10;90;0;900;100;Entregue;2026-09-20;2026-09-20;10;0;1",
].join("\n");

test("servidor de produção: login, RBAC, escopo, importação persistida e auditoria", async () => {
  const { dir, users, sessionsDir } = criarRaiz();
  const inst = createProdServer({ root: dir, usersFile: users, logDir: sessionsDir, sessionSecret: "segredo-de-teste" });
  let base;
  try {
    base = await abrir(inst);
    const call = cliente(base);

    // Público: health; privado: painel e dados.
    assert.equal((await call("/api/health")).json.ok, true);
    assert.equal((await call("/app/")).status, 303);
    assert.equal((await call("/data/fato_pedidos.csv")).status, 401);

    // Credenciais inválidas não criam sessão.
    const ruim = await call("/api/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ usuario: "admin", senha: "errada" }),
    });
    assert.equal(ruim.status, 401);
    assert.equal((await call("/api/session")).status, 401);

    // Leitor entra, vê o painel, mas não importa nem audita.
    const loginLeitor = await call("/api/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ usuario: "leitor", senha: "leitor-senha-1" }),
    });
    assert.equal(loginLeitor.status, 200);
    assert.equal(loginLeitor.json.usuario.papel, "leitor");
    assert.equal((await call("/app/")).status, 200);
    assert.equal((await call("/api/audit")).status, 403);
    assert.equal((await call("/api/import", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: CSV }),
    })).status, 403);

    // Escopo por unidade filtra o CSV servido (e as cotações por requisição).
    const dados = await call("/data/fato_pedidos.csv");
    const { header, rows } = parseDelimited(dados.text, ";");
    const iu = header.indexOf("id_unidade");
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => r[iu] === "U1"), "escopo U1 vazou outra unidade");

    await call("/api/logout", { method: "POST" });
    assert.equal((await call("/api/session")).status, 401);

    // Admin importa e a importação fica salva no servidor.
    const loginAdmin = await call("/api/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ usuario: "admin", senha: "admin-senha-1" }),
    });
    assert.equal(loginAdmin.status, 200);
    const imp = await call("/api/import", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: CSV, filename: "api.csv" }),
    });
    assert.equal(imp.status, 200, imp.text);
    assert.equal(imp.json.novos, 1);
    assert.ok(fs.existsSync(inst.importedFile));
    const linhas = fs.readFileSync(inst.importedFile, "utf8").trim().split("\n");
    assert.equal(linhas.length, 2);

    // Reimportar o mesmo id atualiza em vez de duplicar.
    const again = await call("/api/import", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: CSV }),
    });
    assert.equal(again.json.novos, 0);
    assert.equal(again.json.atualizados, 1);

    // Pedido inválido é rejeitado pelo servidor, não só pelo navegador.
    const invalido = await call("/api/import", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: CSV.replace(";F001;", ";F999;") }),
    });
    assert.equal(invalido.status, 422);
    assert.ok(invalido.json.errors.some((e) => e.includes("fornecedor inexistente")));

    const audit = await call("/api/audit");
    assert.equal(audit.status, 200);
    const acoes = audit.json.eventos.map((e) => e.acao);
    assert.ok(acoes.includes("login"));
    assert.ok(acoes.includes("login_falha"));
    assert.ok(acoes.includes("importacao"));
    assert.ok(acoes.includes("importacao_rejeitada"));

    // Remoção é restrita a administrador e cria backup.
    assert.equal((await call("/api/import", { method: "DELETE" })).status, 200);
    assert.equal(fs.existsSync(inst.importedFile), false);
    assert.ok(fs.readdirSync(path.join(dir, "data", "backups")).some((f) => f.includes("removidos")));
  } finally {
    inst.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
