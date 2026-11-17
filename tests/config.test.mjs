import test from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig, DEFAULT_CONFIG } from "../app/js/config.js";
import { contractPortfolio } from "../app/js/kpi.js";

test("config normaliza metas em percentual e em fração", () => {
  const c = normalizeConfig({ empresa: { nome: "ACME" }, metas: { otif: 92, saving: 0.045, coberturaContrato: 80 } });
  assert.equal(c.empresa.nome, "ACME");
  assert.equal(c.empresa.marca, DEFAULT_CONFIG.empresa.marca);
  assert.equal(c.metas.otif, 0.92);
  assert.equal(c.metas.saving, 0.045);
  assert.equal(c.metas.coberturaContrato, 0.8);
  assert.equal(c.metas.alertaContratoDias, 90);
});

test("config inválida cai no fallback sem lançar", () => {
  for (const raw of [null, undefined, 42, "x", {}, { metas: { otif: "abc" } }]) {
    const c = normalizeConfig(raw);
    assert.equal(c.empresa.nome, DEFAULT_CONFIG.empresa.nome);
    assert.equal(c.metas.otif, DEFAULT_CONFIG.metas.otif);
    assert.ok(c.limites.linhasUpload > 0);
  }
});

test("metas de contrato são configuráveis por empresa", () => {
  const contracts = [{
    id_contrato: "CT-1", id_fornecedor: "F1", id_categoria: "K1",
    data_inicio: "2025-01-01", data_fim: "2026-01-15", valor_anual: 100,
    reajuste_pct: 7, indice_reajuste: "IPCA", status: "Vigente",
  }];
  const padrao = contractPortfolio(contracts, [], "2026-01-01", { alertDays: 90, reajusteLimit: 5 });
  assert.equal(padrao.rows[0].situacao, "A vencer");
  assert.ok(padrao.rows[0].alertas.some((a) => a.code === "REAJUSTE"));

  const tolerante = contractPortfolio(contracts, [], "2026-01-01", { alertDays: 10, reajusteLimit: 10 });
  assert.equal(tolerante.rows[0].situacao, "Vigente");
  assert.ok(!tolerante.rows[0].alertas.some((a) => a.code === "REAJUSTE"));
});
