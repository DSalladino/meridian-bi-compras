/* Leitor de CSV do dataset (Node, sem dependências) e montagem do modelo. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function parseCSV(text) {
  const clean = String(text).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const firstLine = clean.slice(0, clean.indexOf("\n") === -1 ? clean.length : clean.indexOf("\n"));
  const delim = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return { header: [], rows: [] };
  const header = rows[0].map((h) => h.trim());
  return { header, rows: rows.slice(1).filter((r) => r.some((c) => c.trim() !== "")) };
}

export const FILES = {
  unidades: ["dim_unidades.csv", []],
  compradores: ["dim_compradores.csv", []],
  categorias: ["dim_categorias.csv", ["peso_spend", "drift_mensal", "lead_time_base_dias"]],
  itens: ["dim_itens.csv", ["preco_referencia"]],
  fornecedores: ["dim_fornecedores.csv", ["prazo_pagamento_dias", "rating_cadastral", "lead_time_medio_dias"]],
  contratos: ["dim_contratos.csv", ["valor_anual", "reajuste_pct"]],
  pedidos: ["fato_pedidos.csv", ["quantidade", "valor_unitario", "frete", "valor_total", "preco_referencia", "saving_valor", "tem_contrato", "atraso_dias", "qtd_recebida", "qtd_defeito", "otif", "nota_qualidade"]],
  cotacoes: ["fato_cotacoes.csv", ["quantidade", "preco_unitario", "frete", "valor_total", "prazo_entrega_dias", "prazo_pagamento_dias", "selecionada", "preco_referencia"]],
  precos: ["fato_precos.csv", ["preco_medio", "indice_categoria", "variacao_mm_pct"]],
  orcamento: ["fato_orcamento.csv", ["orcamento", "forecast"]],
};

export function readCSV(file, numeric = [], dataDir = path.join(ROOT, "data")) {
  const text = fs.readFileSync(path.join(dataDir, file), "utf8");
  const { header, rows } = parseCSV(text);
  const numSet = new Set(numeric);
  return rows.map((r) => {
    const out = {};
    header.forEach((h, i) => {
      const raw = (r[i] ?? "").trim();
      out[h] = numSet.has(h) ? (raw === "" ? null : Number(raw)) : raw;
    });
    return out;
  });
}

/** Carrega todas as tabelas do dataset versionado. */
export function loadDataset({ dataDir } = {}) {
  const dir = dataDir || path.join(ROOT, "data");
  const out = {};
  for (const [key, [file, numeric]] of Object.entries(FILES)) out[key] = readCSV(file, numeric, dir);
  return out;
}

export { ROOT };
