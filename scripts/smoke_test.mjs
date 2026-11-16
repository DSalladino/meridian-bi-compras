#!/usr/bin/env node
/**
 * Smoke test do dataset — valida integridade, regras de negócio e KPIs de referência.
 * Uso: npm run check
 */
import fs from "node:fs";
import path from "node:path";

const DATA = path.resolve("data");
const read = (file) => {
  const text = fs.readFileSync(path.join(DATA, file), "utf8").replace(/^\uFEFF/, "").trim();
  const lines = text.split("\n");
  const header = lines[0].split(";").map((h) => h.trim());
  const rows = lines.slice(1).map((l) => {
    const out = [];
    let cur = "", q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) {
        if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ";") { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return Object.fromEntries(header.map((h, i) => [h, out[i] ?? ""]));
  });
  return rows;
};

const checks = [];
const check = (name, pass, detail = "") => {
  checks.push({ name, pass, detail });
  if (!pass) console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
};

const pedidos = read("fato_pedidos.csv");
const cotacoes = read("fato_cotacoes.csv");
const fornecedores = read("dim_fornecedores.csv");
const itens = read("dim_itens.csv");
const categorias = read("dim_categorias.csv");
const orcamento = read("fato_orcamento.csv");
const precos = read("fato_precos.csv");

const ids = (rows, f) => new Set(rows.map((r) => r[f]));
const fSet = ids(fornecedores, "id_fornecedor");
const iSet = ids(itens, "id_item");
const cSet = ids(categorias, "id_categoria");

check("dimensões carregadas", fornecedores.length === 123 && itens.length === 35 && categorias.length === 8,
  `${fornecedores.length} fornecedores, ${itens.length} itens, ${categorias.length} categorias`);
check("volume de pedidos", pedidos.length >= 3000, `${pedidos.length} pedidos`);
check("volume de cotações", cotacoes.length >= 10000, `${cotacoes.length} propostas`);
check("PK de pedidos única", new Set(pedidos.map((p) => p.id_pedido)).size === pedidos.length);
check("FK fornecedor", pedidos.every((p) => fSet.has(p.id_fornecedor)));
check("FK item", pedidos.every((p) => iSet.has(p.id_item)));
check("FK categoria", pedidos.every((p) => cSet.has(p.id_categoria)));
check("status válido", pedidos.every((p) => ["Entregue", "Em trânsito", "Parcial", "Atrasado", "Cancelado"].includes(p.status)));
check("saving consistente com baseline", pedidos.every((p) =>
  Math.abs(Number(p.saving_valor) - (Number(p.preco_referencia) - Number(p.valor_unitario)) * Number(p.quantidade)) <= 1));
check("defeito ≤ recebido", pedidos.every((p) => Number(p.qtd_defeito) <= Number(p.qtd_recebida)));
check("OTIF coerente", pedidos.every((p) => {
  const ok = p.status === "Entregue" && Number(p.atraso_dias) === 0 && Number(p.qtd_defeito) === 0;
  return (ok ? 1 : 0) === Number(p.otif);
}));

const porReq = new Map();
for (const c of cotacoes) porReq.set(c.id_requisicao, (porReq.get(c.id_requisicao) || 0) + Number(c.selecionada));
const reqInvalidas = [...porReq.values()].filter((v) => v !== 1).length;
check("1 vencedora por requisição", reqInvalidas === 0, `${reqInvalidas} requisições irregulares`);

const spend = pedidos.filter((p) => p.status !== "Cancelado").reduce((s, p) => s + Number(p.valor_total), 0);
const saving = pedidos.filter((p) => p.status !== "Cancelado").reduce((s, p) => s + Number(p.saving_valor), 0);
const budget = orcamento.reduce((s, o) => s + Number(o.orcamento), 0);
const entregues = pedidos.filter((p) => p.data_entrega_real && p.status !== "Cancelado");
const otif = entregues.filter((p) => Number(p.otif) === 1).length / entregues.length;
const fornecedoresAtivos = new Set(pedidos.filter((p) => p.status !== "Cancelado").map((p) => p.id_fornecedor)).size;

check("spend entre 70 e 90 mi", spend > 70e6 && spend < 90e6, `R$ ${(spend / 1e6).toFixed(2)} mi`);
check("economia entre 5% e 10%", saving / spend > 0.05 && saving / spend < 0.10, `${(saving / spend * 100).toFixed(1)}%`);
check("orçamento próximo do realizado", Math.abs(spend / budget - 1) < 0.05, `${(spend / budget * 100).toFixed(1)}%`);
check("OTIF entre 75% e 88%", otif > 0.75 && otif < 0.88, `${(otif * 100).toFixed(1)}%`);
check("fornecedores com compra", fornecedoresAtivos > 100, `${fornecedoresAtivos} fornecedores`);
check("série de preços completa", precos.length === itens.length * new Set(precos.map((p) => p.mes_ref)).size,
  `${precos.length} registros`);
check("orçamento cobre todos os meses", new Set(orcamento.map((o) => o.mes_ref)).size >= 20,
  `${new Set(orcamento.map((o) => o.mes_ref)).size} competências`);

const passed = checks.filter((c) => c.pass).length;
console.log(`\nSmoke test — ${passed}/${checks.length} verificações aprovadas`);
console.log(`  spend      R$ ${(spend / 1e6).toFixed(2)} mi`);
console.log(`  economia   R$ ${(saving / 1e6).toFixed(2)} mi (${(saving / spend * 100).toFixed(1)}%)`);
console.log(`  OTIF       ${(otif * 100).toFixed(1)}%`);
console.log(`  cobertura  ${(spend / budget * 100).toFixed(1)}% do orçamento\n`);
process.exit(passed === checks.length ? 0 : 1);
