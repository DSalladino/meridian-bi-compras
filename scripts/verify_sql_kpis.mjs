#!/usr/bin/env node
/**
 * Reconciliação app × PostgreSQL. Requer psql no PATH e DATABASE_URL.
 * Uso: DATABASE_URL=postgresql://... npm run test:sql
 */
import { execFileSync } from "node:child_process";
import process from "node:process";
import { loadDataset } from "./lib/dataset.mjs";
import { isValidSpend, isDelivered, contractPortfolio } from "../app/js/kpi.js";

const dsn = process.env.DATABASE_URL;
if (!dsn) {
  console.log("SKIP test:sql — defina DATABASE_URL para reconciliar com PostgreSQL.");
  process.exit(0);
}

try {
  execFileSync("psql", ["--version"], { stdio: "ignore" });
} catch {
  console.error("psql não encontrado no PATH. Instale postgresql-client.");
  process.exit(1);
}

const d = loadDataset();
const valid = d.pedidos.filter(isValidSpend);
const delivered = valid.filter(isDelivered);
const spend = valid.reduce((s, p) => s + p.valor_total, 0);
const saving = valid.reduce((s, p) => s + p.saving_valor, 0);
const otif = delivered.reduce((s, p) => s + p.otif, 0) / delivered.length;
const contractSpend = valid.filter((p) => p.tem_contrato === 1).reduce((s, p) => s + p.valor_total, 0);
const latestMonth = [
  ...d.pedidos.map((p) => p.data_emissao.slice(0, 7)),
  ...d.cotacoes.map((q) => q.data_cotacao.slice(0, 7)),
  ...d.precos.map((p) => p.mes_ref),
  ...d.orcamento.map((o) => o.mes_ref),
].sort().at(-1);
const [ly, lm] = latestMonth.split("-").map(Number);
const asOf = new Date(Date.UTC(ly, lm, 0)).toISOString().slice(0, 10);
const contracts = contractPortfolio(d.contratos, d.pedidos, asOf);

const sql = `select spend_total, saving_total, otif, entregas, otif_divergencias,
  cobertura_contrato_pct, contratos_vigentes, contratos_a_vencer_90d,
  contratos_vencidos, contratos_vencidos_com_pedido, valor_contratado,
  realizado_contratado, saldo_contratual, exposicao_contratual
from dw.vw_kpi_geral`;
const raw = execFileSync("psql", [dsn, "-At", "-F", "|", "-c", sql], { encoding: "utf8" }).trim();
const [spendSql, savingSql, otifSql, entregasSql, divergenciasSql, coberturaSql,
  vigentesSql, aVencerSql, vencidosSql, vencidosPedidoSql, valorSql, realizadoSql,
  saldoSql, exposicaoSql] = raw.split("|").map((v) => (v === "" ? null : Number(v)));

const checklist = execFileSync("psql", [dsn, "-At", "-F", "|", "-c",
  "select checagem, ocorrencias from dw.vw_integridade_checklist order by checagem"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).map((line) => line.split("|"));

const checks = [];
const check = (name, pass, detail = "") => {
  checks.push({ name, pass, detail });
  console.log(`  ${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const close = (a, b, tol = 0.01) => Math.abs(Number(a) - Number(b)) <= tol;

check("spend total", close(spendSql, spend, 0.02), `SQL ${spendSql} · JS ${spend.toFixed(2)}`);
check("saving total", close(savingSql, saving, 0.02), `SQL ${savingSql} · JS ${saving.toFixed(2)}`);
check("OTIF", close(otifSql, otif, 0.0001), `SQL ${otifSql} · JS ${otif.toFixed(4)}`);
check("entregas", Number(entregasSql) === delivered.length, `SQL ${entregasSql} · JS ${delivered.length}`);
check("divergências OTIF", Number(divergenciasSql) === 0, `SQL ${divergenciasSql}`);
check("cobertura contratual", close(coberturaSql, (contractSpend / spend) * 100, 0.02), `SQL ${coberturaSql}%`);
check("contratos vigentes", Number(vigentesSql) === contracts.totals.vigentes, `SQL ${vigentesSql} · JS ${contracts.totals.vigentes}`);
check("contratos a vencer 90d", Number(aVencerSql) === contracts.totals.aVencer90, `SQL ${aVencerSql} · JS ${contracts.totals.aVencer90}`);
check("contratos vencidos", Number(vencidosSql) === contracts.totals.vencidos, `SQL ${vencidosSql} · JS ${contracts.totals.vencidos}`);
check("vencidos com pedido", Number(vencidosPedidoSql) === contracts.totals.vencidosComPedidoAtivo, `SQL ${vencidosPedidoSql} · JS ${contracts.totals.vencidosComPedidoAtivo}`);
check("valor contratado", close(valorSql, contracts.totals.valorContratado), `SQL ${valorSql}`);
check("realizado contratual", close(realizadoSql, contracts.totals.realizado), `SQL ${realizadoSql}`);
check("saldo contratual", close(saldoSql, contracts.totals.saldo), `SQL ${saldoSql}`);
check("exposição contratual", close(exposicaoSql, contracts.totals.exposicao), `SQL ${exposicaoSql}`);
for (const [name, value] of checklist) check(`checklist: ${name}`, Number(value) === 0, `${value} ocorrência(s)`);

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} verificações SQL aprovadas`);
process.exit(failed.length ? 1 : 0);
