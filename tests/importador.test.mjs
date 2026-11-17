import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseNumber, parseDate, parseMonth, parseDelimited, importarEmpresa, validateDataset } from "../scripts/lib/erp.mjs";
import { normalizeConfig } from "../app/js/config.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const exemplo = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "empresa.example.json"), "utf8"));

test("números localizados: pt-BR, en-US, percentual e booleano", () => {
  assert.equal(parseNumber("1.234,56", "pt-BR"), 1234.56);
  assert.equal(parseNumber("1,234.56", "en-US"), 1234.56);
  assert.equal(parseNumber("R$ 12.506,25", "pt-BR"), 12506.25);
  assert.equal(parseNumber("1.000", "pt-BR"), 1000);
  assert.equal(parseNumber("12,5%", "pt-BR"), 12.5);
  assert.equal(parseNumber("SIM"), 1);
  assert.equal(parseNumber("Não"), 0);
  assert.ok(Number.isNaN(parseNumber("", "pt-BR")));
});

test("datas: ISO, pt-BR, en-US, serial do Excel e competência", () => {
  assert.equal(parseDate("2026-02-03"), "2026-02-03");
  assert.equal(parseDate("03/02/2026", "dd/mm/aaaa"), "2026-02-03");
  assert.equal(parseDate("02/03/2026", "en-US"), "2026-02-03");
  assert.equal(parseDate("31/02/2026", "dd/mm/aaaa"), "");
  assert.equal(parseDate(46000), "2025-12-09");
  assert.equal(parseMonth("02/2026"), "2026-02");
  assert.equal(parseMonth("2026-02-15"), "2026-02");
});

test("CSV aceita delimitador tab e campos entre aspas", () => {
  const { header, rows } = parseDelimited('a\tb\n1\t"x;y"\n', "tab");
  assert.deepEqual(header, ["a", "b"]);
  assert.deepEqual(rows[0], ["1", "x;y"]);
});

function escrever(dir, nome, header, rows) {
  fs.writeFileSync(path.join(dir, nome), [header.join(";"), ...rows.map((r) => r.join(";"))].join("\n") + "\n");
}

test("importação completa: mapeia, traduz, deriva e valida", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-erp-"));
  const origem = path.join(dir, "erp");
  fs.mkdirSync(origem);
  try {
    const m = exemplo.origem.tabelas;
    escrever(origem, "pedidos.csv",
      Object.values(m.fato_pedidos.colunas),
      [
        ["PO-1", "REQ-1", "02/01/2026", "FORN-001", "MAT-0001", "CAT-A", "COMP-1", "UN-1", "1.000,5", "12,50", "12.506,25", "13,00", "ENTREGUE", "12/01/2026", "12/01/2026", "1.000,5", "0", "SIM"],
        ["PO-2", "REQ-2", "05/01/2026", "FORN-X", "MAT-0002", "CAT-A", "COMP-2", "UN-2", "20", "99,90", "1.998,00", "100,00", "ATRASADO", "10/01/2026", "15/01/2026", "20", "1", "NAO"],
        ["PO-3", "REQ-3", "10/02/2026", "FORN-001", "MAT-0001", "CAT-A", "COMP-1", "UN-1", "500", "12,00", "6.000,00", "13,00", "EM TRANSITO", "20/02/2026", "", "0", "0", "SIM"],
      ]);
    escrever(origem, "fornecedores.csv",
      Object.values(m.dim_fornecedores.colunas),
      [["FORN-001", "Alfa Metais Ltda", "CAT-A", "SP", "Médio", "Ativo", "10/01/2024", "30", "Sim", "88", "Baixo"]]);
    escrever(origem, "itens.csv",
      Object.values(m.dim_itens.colunas),
      [["MAT-0001", "Chapa de aço", "CAT-A", "kg", "13,00", "Alta"]]);
    escrever(origem, "categorias.csv",
      Object.values(m.dim_categorias.colunas),
      [["CAT-A", "Matéria-prima", "Produção", "Alta", "Custo direto", "100", "0,005", "18"]]);
    escrever(origem, "unidades.csv", Object.values(m.dim_unidades.colunas),
      [["UN-1", "Planta A", "Campinas", "SP", "Indústria"], ["UN-2", "CD B", "Curitiba", "PR", "CD"]]);
    escrever(origem, "compradores.csv", Object.values(m.dim_compradores.colunas),
      [["COMP-1", "Ana", "UN-1", "Matéria-prima"], ["COMP-2", "Bruno", "UN-2", "Matéria-prima"]]);
    escrever(origem, "cotacoes.csv", Object.values(m.fato_cotacoes.colunas),
      [
        ["REQ-1", "02/01/2026", "MAT-0001", "CAT-A", "FORN-001", "1.000,5", "12,50", "0", "12.506,25", "10", "30", "SIM", "13,00"],
        ["REQ-1", "02/01/2026", "MAT-0001", "CAT-A", "FORN-X", "1.000,5", "12,90", "0", "12.906,45", "9", "30", "NAO", "13,00"],
      ]);
    escrever(origem, "orcamento.csv", Object.values(m.fato_orcamento.colunas),
      [["01/2026", "CAT-A", "UN-1", "15.000,00", "16.000,00"]]);
    escrever(origem, "contratos.csv", Object.values(m.dim_contratos.colunas),
      [["CT-1", "FORN-001", "CAT-A", "01/01/2026", "31/12/2026", "100.000,00", "4,5", "IPCA", "Vigente"]]);

    const report = { tabelas: {}, erros: [], avisos: [] };
    const empresa = {
      version: 1,
      empresa: { nome: "Empresa Teste" },
      metas: { otif: 0.9 },
      origem: { ...exemplo.origem, tabelas: m },
    };
    const { dims, facts } = importarEmpresa({ config: empresa, sourceDir: origem, report });
    const v = validateDataset(dims, facts);
    assert.deepEqual(v.errors, [], v.errors.join("\n"));

    const po1 = facts.fato_pedidos.find((p) => p.id_pedido === "PO-1");
    assert.equal(po1.quantidade, 1000.5);
    assert.equal(po1.valor_unitario, 12.5);
    assert.equal(po1.mes_ref, "2026-01");
    assert.equal(po1.tem_contrato, 1);
    assert.equal(po1.otif, 1);
    assert.equal(Math.round(po1.saving_valor), 500);

    const po2 = facts.fato_pedidos.find((p) => p.id_pedido === "PO-2");
    assert.equal(po2.otif, 0);
    assert.equal(po2.atraso_dias, 5);
    assert.equal(po2.qtd_defeito, 1);

    const po3 = facts.fato_pedidos.find((p) => p.id_pedido === "PO-3");
    assert.equal(po3.status, "Em trânsito");
    assert.equal(po3.data_entrega_real, "");

    // Dimensões derivadas para chaves ausentes no cadastro.
    assert.ok(dims.dim_fornecedores.some((f) => f.id_fornecedor === "FORN-X"));
    assert.ok(dims.dim_itens.some((i) => i.id_item === "MAT-0002"));
    assert.ok(report.avisos.some((a) => a.includes("FORN-X")));

    // Cotações: SIM/NAO traduzidos, total derivado e vencedora única.
    assert.equal(facts.fato_cotacoes.filter((q) => q.selecionada === 1).length, 1);
    assert.equal(facts.fato_cotacoes[0].valor_total, 12506.25);

    // Preços derivados do histórico e orçamento preservado.
    assert.ok(facts.fato_precos.length >= 3);
    assert.equal(facts.fato_orcamento[0].orcamento, 15000);
    assert.equal(normalizeConfig(empresa).empresa.nome, "Empresa Teste");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
