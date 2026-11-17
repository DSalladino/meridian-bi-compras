/* Importação de exportações reais de ERP para o contrato canônico do Meridian.
 *
 * O objetivo é separar "formato da empresa" de "modelo analítico": o ERP pode
 * usar vírgula decimal, datas dd/mm/aaaa, códigos longos e status em inglês; o
 * restante do projeto continua recebendo os mesmos CSVs canônicos de /data.
 *
 * Funções puras (parse, normalização, derivação) + uma camada de I/O usada
 * pelo CLI `scripts/importar_erp.mjs`.
 */
import fs from "node:fs";
import path from "node:path";

/* ----------------------------- contrato canônico -------------------------- */
export const TABLES = {
  dim_unidades: {
    file: "dim_unidades.csv",
    pk: "id_unidade",
    cols: ["id_unidade", "unidade", "cidade", "uf", "tipo"],
    numeric: [],
    dates: [],
    required: ["id_unidade", "unidade"],
    defaults: { cidade: "—", uf: "SP", tipo: "Operação" },
  },
  dim_compradores: {
    file: "dim_compradores.csv",
    pk: "id_comprador",
    cols: ["id_comprador", "comprador", "id_unidade", "categoria_responsavel"],
    numeric: [],
    dates: [],
    required: ["id_comprador", "comprador"],
    defaults: { categoria_responsavel: "—" },
  },
  dim_categorias: {
    file: "dim_categorias.csv",
    pk: "id_categoria",
    cols: ["id_categoria", "categoria", "grupo", "criticidade", "peso_spend", "drift_mensal", "lead_time_base_dias", "natureza"],
    numeric: ["peso_spend", "drift_mensal", "lead_time_base_dias"],
    dates: [],
    required: ["id_categoria", "categoria"],
    defaults: { grupo: "Geral", criticidade: "Média", peso_spend: 0, drift_mensal: 0.003, lead_time_base_dias: 15, natureza: "Custo indireto" },
  },
  dim_itens: {
    file: "dim_itens.csv",
    pk: "id_item",
    cols: ["id_item", "descricao", "id_categoria", "unidade_medida", "preco_referencia", "criticidade"],
    numeric: ["preco_referencia"],
    dates: [],
    required: ["id_item", "descricao", "id_categoria", "preco_referencia"],
    defaults: { unidade_medida: "un", criticidade: "Média" },
  },
  dim_fornecedores: {
    file: "dim_fornecedores.csv",
    pk: "id_fornecedor",
    cols: ["id_fornecedor", "razao_social", "id_categoria", "uf", "porte", "status", "data_homologacao", "prazo_pagamento_dias", "iso9001", "rating_cadastral", "risco", "lead_time_medio_dias"],
    numeric: ["prazo_pagamento_dias", "rating_cadastral", "lead_time_medio_dias"],
    dates: ["data_homologacao"],
    required: ["id_fornecedor", "razao_social", "id_categoria"],
    defaults: { uf: "SP", porte: "Médio", status: "Ativo", prazo_pagamento_dias: 30, iso9001: "Não", rating_cadastral: 70, risco: "Médio", lead_time_medio_dias: 15 },
  },
  dim_contratos: {
    file: "dim_contratos.csv",
    pk: "id_contrato",
    cols: ["id_contrato", "id_fornecedor", "id_categoria", "data_inicio", "data_fim", "valor_anual", "reajuste_pct", "indice_reajuste", "status"],
    numeric: ["valor_anual", "reajuste_pct"],
    dates: ["data_inicio", "data_fim"],
    required: ["id_contrato", "id_fornecedor", "id_categoria", "data_inicio", "data_fim"],
    defaults: { valor_anual: 0, reajuste_pct: 0, indice_reajuste: "IPCA", status: "Vigente" },
  },
  fato_pedidos: {
    file: "fato_pedidos.csv",
    pk: "id_pedido",
    cols: ["id_pedido", "id_requisicao", "data_emissao", "mes_ref", "id_fornecedor", "id_item", "id_categoria", "id_comprador", "id_unidade", "quantidade", "valor_unitario", "frete", "valor_total", "preco_referencia", "saving_valor", "modalidade", "tem_contrato", "data_entrega_prevista", "data_entrega_real", "atraso_dias", "qtd_recebida", "qtd_defeito", "status", "otif", "nota_qualidade"],
    numeric: ["quantidade", "valor_unitario", "frete", "valor_total", "preco_referencia", "saving_valor", "tem_contrato", "atraso_dias", "qtd_recebida", "qtd_defeito", "otif", "nota_qualidade"],
    dates: ["data_emissao", "data_entrega_prevista", "data_entrega_real"],
    required: ["id_pedido", "data_emissao", "id_fornecedor", "id_item", "id_categoria", "id_unidade", "quantidade", "valor_unitario", "valor_total", "status"],
    defaults: { modalidade: "ERP", frete: 0, atraso_dias: 0, qtd_defeito: 0, nota_qualidade: 4 },
  },
  fato_cotacoes: {
    file: "fato_cotacoes.csv",
    pk: null,
    cols: ["id_requisicao", "data_cotacao", "id_item", "id_categoria", "id_fornecedor", "quantidade", "preco_unitario", "frete", "valor_total", "prazo_entrega_dias", "prazo_pagamento_dias", "selecionada", "preco_referencia"],
    numeric: ["quantidade", "preco_unitario", "frete", "valor_total", "prazo_entrega_dias", "prazo_pagamento_dias", "selecionada", "preco_referencia"],
    dates: ["data_cotacao"],
    required: ["id_requisicao", "data_cotacao", "id_item", "id_fornecedor", "quantidade", "preco_unitario", "selecionada"],
    defaults: { frete: 0, prazo_entrega_dias: 0, prazo_pagamento_dias: 30 },
  },
  fato_precos: {
    file: "fato_precos.csv",
    pk: null,
    cols: ["mes_ref", "id_item", "id_categoria", "descricao_item", "preco_medio", "indice_categoria", "variacao_mm_pct"],
    numeric: ["preco_medio", "indice_categoria", "variacao_mm_pct"],
    dates: [],
    required: ["mes_ref", "id_item", "preco_medio"],
    defaults: { indice_categoria: 1, variacao_mm_pct: 0 },
  },
  fato_orcamento: {
    file: "fato_orcamento.csv",
    pk: null,
    cols: ["mes_ref", "id_categoria", "id_unidade", "orcamento", "forecast"],
    numeric: ["orcamento", "forecast"],
    dates: [],
    required: ["mes_ref", "id_categoria", "id_unidade", "orcamento"],
    defaults: { forecast: 0 },
  },
};

const STATUS_PEDIDO = ["Entregue", "Em trânsito", "Parcial", "Atrasado", "Cancelado"];
const STATUS_CONTRATO = ["Vigente", "Encerrado", "Suspenso"];
const CRITICIDADE = ["Alta", "Média", "Baixa"];
const RISCO = ["Baixo", "Médio", "Alto"];
const PORTE = ["MEI", "EPP", "Médio", "Grande"];

/** Nomes aceitos no mapeamento além da chave canônica (plural). */
const TABLE_ALIASES = {
  fato_pedidos: ["fato_pedido", "pedidos", "pedido"],
  fato_cotacoes: ["fato_cotacao", "cotacoes", "cotacao"],
  fato_precos: ["fato_preco", "precos", "preco"],
  fato_orcamento: ["orcamento", "orcamentos"],
  dim_fornecedores: ["dim_fornecedor", "fornecedores"],
  dim_itens: ["dim_item", "itens"],
  dim_categorias: ["dim_categoria", "categorias"],
  dim_unidades: ["dim_unidade", "unidades"],
  dim_compradores: ["dim_comprador", "compradores"],
  dim_contratos: ["dim_contrato", "contratos"],
};

const mapaTabela = (tabelas, name) => tabelas[name]
  || (TABLE_ALIASES[name] || []).map((alias) => tabelas[alias]).find(Boolean);

/* ------------------------------- CSV e tipos ------------------------------ */
export function parseDelimited(text, delimiter = ";") {
  const clean = String(text).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const delim = delimiter === "\\t" || delimiter === "tab" ? "\t" : delimiter;
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
  const header = rows[0].map((h) => h.replace(/^\uFEFF/, "").trim());
  return { header, rows: rows.slice(1).filter((r) => r.some((c) => c.trim() !== "")) };
}

export function readSourceCSV(file, { delimiter = ";", encoding = "utf-8" } = {}) {
  const buffer = fs.readFileSync(file);
  const text = new TextDecoder(encoding).decode(buffer);
  return parseDelimited(text, delimiter);
}

const stripNumber = (raw) => String(raw).replace(/[^\d,.\-+eE]/g, "");

/** Converte número localizado. `style` aceita pt-BR, en-US ou auto. */
export function parseNumber(raw, style = "auto") {
  if (raw == null || raw === "") return NaN;
  if (typeof raw === "number") return raw;
  const asBool = String(raw).trim().toUpperCase();
  if (["SIM", "YES", "Y", "X", "TRUE", "VERDADEIRO"].includes(asBool)) return 1;
  if (["NAO", "NÃO", "NO", "N", "FALSE", "FALSO"].includes(asBool)) return 0;
  let s = stripNumber(raw);
  if (!s || !/\d/.test(s)) return NaN;
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    const decimal = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    s = s.split(thousands).join("").replace(decimal, ".");
  } else if (hasComma) {
    if (style === "en-US") s = s.split(",").join("");
    else s = s.replace(",", ".");
  } else if (hasDot) {
    const parts = s.split(".");
    if (style === "pt-BR" && parts.length > 2) s = parts.join("");
    else if (style === "pt-BR" && /^\d{1,3}(\.\d{3})+$/.test(s)) s = parts.join("");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

const isoFromParts = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return "";
  return dt.toISOString().slice(0, 10);
};

/** Converte data para ISO. Suporta ISO, pt-BR, en-US e serial do Excel. */
export function parseDate(raw, format = "auto") {
  if (raw == null || raw === "") return "";
  if (typeof raw === "number" || /^\d{5}$/.test(String(raw).trim())) {
    const serial = Number(raw);
    if (serial > 20000 && serial < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 864e5);
      return d.toISOString().slice(0, 10);
    }
  }
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return isoFromParts(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) {
    const a = Number(m[1]); const b = Number(m[2]); const y = Number(m[3]);
    const us = format === "en-US" || format === "mm/dd/aaaa" || format === "mm/dd/yyyy";
    return us ? isoFromParts(y, a, b) : isoFromParts(y, b, a);
  }
  m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (m) return isoFromParts(Number(m[1]), Number(m[2]), Number(m[3]));
  // dd.mm.aaaa (comum em exportações SAP)
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return isoFromParts(Number(m[3]), Number(m[2]), Number(m[1]));
  return "";
}

/** Competência aaaa-mm. Aceita ISO, dd/mm/aaaa, mm/aaaa e aaaa-mm. */
export function parseMonth(raw, format = "auto") {
  if (raw == null || raw === "") return "";
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  m = s.match(/^(\d{2})[/-](\d{4})$/);
  if (m) return `${m[2]}-${m[1]}`;
  const iso = parseDate(raw, format);
  return iso ? iso.slice(0, 7) : "";
}

const normKey = (v) => String(v ?? "").trim().toUpperCase();

/** Normaliza domínios que o banco valida com CHECK, aceitando sinônimos do ERP. */
export function normalizeDomains(tableName, row) {
  const map = (value, aliases, fallback) => {
    const key = normKey(value);
    if (!key) return fallback;
    for (const [canonical, list] of Object.entries(aliases)) {
      if (normKey(canonical) === key || list.some((a) => normKey(a) === key)) return canonical;
    }
    return value;
  };
  if (tableName === "dim_fornecedores") {
    row.status = map(row.status, {
      Ativo: ["ATIVO", "ACTIVE", "HABILITADO", "LIBERADO"],
      "Em homologação": ["EM HOMOLOGACAO", "EM HOMOLOGAÇÃO", "PENDING", "EM ANÁLISE", "EM ANALISE"],
      Suspenso: ["SUSPENSO", "SUSPENDED", "BLOQUEADO"],
      Inativo: ["INATIVO", "INACTIVE", "DESATIVADO"],
    }, "Ativo");
    row.porte = map(row.porte, {
      MEI: ["MEI", "MICRO", "MICROEMPREENDEDOR"],
      EPP: ["EPP", "PEQUENA", "PEQUENO", "SMALL"],
      Médio: ["MEDIO", "MÉDIO", "MEDIA", "MÉDIA", "MEDIUM"],
      Grande: ["GRANDE", "LARGE"],
    }, "Médio");
    row.risco = map(row.risco, {
      Baixo: ["BAIXO", "LOW"], Médio: ["MEDIO", "MÉDIO", "MEDIUM"], Alto: ["ALTO", "HIGH"],
    }, "Médio");
    row.iso9001 = map(row.iso9001, {
      Sim: ["SIM", "S", "YES", "Y", "1", "TRUE", "CERTIFICADO"],
      Não: ["NAO", "NÃO", "N", "NO", "0", "FALSE"],
    }, "Não");
  }
  if (tableName === "dim_categorias") {
    row.criticidade = map(row.criticidade, {
      Alta: ["ALTA", "HIGH", "CRITICA", "CRÍTICA"],
      Média: ["MEDIA", "MÉDIA", "MEDIUM"],
      Baixa: ["BAIXA", "LOW"],
    }, "Média");
  }
  if (tableName === "dim_contratos") {
    row.status = map(row.status, {
      Vigente: ["VIGENTE", "ATIVO", "ACTIVE", "EM VIGOR"],
      Encerrado: ["ENCERRADO", "EXPIRADO", "EXPIRED", "CONCLUIDO", "CONCLUÍDO"],
      Suspenso: ["SUSPENSO", "SUSPENDED", "BLOQUEADO"],
    }, "Vigente");
  }
  return row;
}

export function translate(value, map) {
  if (value == null) return value;
  const raw = String(value).trim();
  if (!map) return raw;
  if (Object.prototype.hasOwnProperty.call(map, raw)) return map[raw];
  const hit = Object.keys(map).find((k) => normKey(k) === normKey(raw));
  return hit ? map[hit] : raw;
}

/* ------------------------------ mapeamento -------------------------------- */
/**
 * Converte uma linha da origem para o contrato canônico.
 * @param {Record<string,string>} source
 * @param {object} spec item de TABLES
 * @param {object} mapCfg { colunas, valoresFixos, traducoes }
 * @param {object} origem { decimal, formatoData }
 */
export function mapRow(source, spec, mapCfg = {}, origem = {}) {
  const out = {};
  const translations = mapCfg.traducoes || {};
  for (const col of spec.cols) {
    const sourceCol = mapCfg.colunas?.[col];
    let raw = sourceCol ? source[sourceCol] : undefined;
    if (raw === undefined || raw === "") raw = mapCfg.valoresFixos?.[col];
    if (raw === undefined) raw = spec.defaults?.[col];
    if (raw === undefined) raw = "";

    if (spec.dates.includes(col)) out[col] = parseDate(raw, origem.formatoData);
    else if (col === "mes_ref") out[col] = parseMonth(raw, origem.formatoData);
    else if (spec.numeric.includes(col)) {
      const translated = translations[col] ? translate(raw, translations[col]) : raw;
      out[col] = parseNumber(translated, origem.decimal);
    } else if (translations[col]) out[col] = translate(raw, translations[col]);
    else out[col] = typeof raw === "string" ? raw.trim() : raw;
  }
  return out;
}

export function mapTable(tableName, sourceTable, mapCfg, origem, report) {
  const spec = TABLES[tableName];
  const used = new Set(Object.values(mapCfg.colunas || {}));
  const unmapped = sourceTable.header.filter((h) => !used.has(h));
  if (unmapped.length) report.avisos.push(`${tableName}: ${unmapped.length} coluna(s) da origem ignorada(s): ${unmapped.slice(0, 8).join(", ")}`);
  const rows = sourceTable.rows.map((r) => {
    const src = {};
    sourceTable.header.forEach((h, i) => { src[h] = (r[i] ?? "").trim(); });
    return normalizeDomains(tableName, mapRow(src, spec, mapCfg, origem));
  });
  return rows;
}

/* ------------------------------ derivações -------------------------------- */
const groupBy = (rows, fn) => {
  const map = new Map();
  for (const row of rows) {
    const key = fn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
};
const sum = (rows, fn) => rows.reduce((acc, r) => acc + (Number(fn(r)) || 0), 0);
const mode = (values) => {
  const map = new Map();
  for (const v of values) if (v) map.set(v, (map.get(v) || 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

/** Completa os campos derivados do pedido com a mesma regra do painel/SQL. */
export function deriveOrders(orders, dims) {
  const items = new Map(dims.dim_itens.map((i) => [i.id_item, i]));
  const categories = new Map(dims.dim_categorias.map((c) => [c.id_categoria, c]));
  const fallbackBuyer = dims.dim_compradores[0]?.id_comprador || "SEM-COMP";
  for (const p of orders) {
    p.data_emissao = parseDate(p.data_emissao) || p.data_emissao;
    p.data_entrega_prevista = parseDate(p.data_entrega_prevista) || p.data_emissao;
    p.data_entrega_real = parseDate(p.data_entrega_real) || "";
    p.mes_ref = p.mes_ref || p.data_emissao?.slice(0, 7) || "";
    p.id_comprador = p.id_comprador || fallbackBuyer;
    p.id_requisicao = p.id_requisicao || `REQ-${p.id_pedido}`;
    p.status = STATUS_PEDIDO.includes(p.status) ? p.status : translate(p.status, {});
    const item = items.get(p.id_item);
    p.preco_referencia = Number.isFinite(Number(p.preco_referencia)) && Number(p.preco_referencia) > 0
      ? Number(p.preco_referencia)
      : Number(item?.preco_referencia) || Number(p.valor_unitario) || 0;
    const qtd = Number(p.quantidade) || 0;
    const unit = Number(p.valor_unitario) || 0;
    const total = Number(p.valor_total) || 0;
    p.frete = Number.isFinite(Number(p.frete)) ? Number(p.frete) : Math.max(0, total - qtd * unit);
    p.valor_total = total;
    p.saving_valor = Number.isFinite(Number(p.saving_valor)) && Number(p.saving_valor) !== 0
      ? Number(p.saving_valor)
      : (p.preco_referencia - unit) * qtd;
    p.tem_contrato = Number(p.tem_contrato) === 1 ? 1 : 0;
    p.qtd_recebida = Number(p.qtd_recebida) || (["Entregue", "Atrasado"].includes(p.status) ? qtd : 0);
    p.qtd_defeito = Number(p.qtd_defeito) || 0;
    p.atraso_dias = p.data_entrega_real && p.data_entrega_prevista
      ? Math.max(0, Math.round((Date.parse(p.data_entrega_real) - Date.parse(p.data_entrega_prevista)) / 864e5))
      : 0;
    p.otif = p.status === "Entregue" && p.atraso_dias === 0 && p.qtd_recebida >= qtd && p.qtd_defeito === 0 ? 1 : 0;
    p.nota_qualidade = Number(p.nota_qualidade) || 4;
    p.id_categoria = p.id_categoria || item?.id_categoria || "";
    p.id_unidade = p.id_unidade || dims.dim_unidades[0]?.id_unidade || "UN";
    if (!p.id_fornecedor) p.id_fornecedor = "";
    if (!categories.has(p.id_categoria)) p.id_categoria = item?.id_categoria || p.id_categoria;
  }
  return orders;
}

/** Cria dimensões mínimas para chaves presentes nos pedidos e ausentes no cadastro. */
export function completeDimensions(orders, dims, rotulos = {}, report) {
  const spendBySupplier = groupBy(orders, (p) => p.id_fornecedor);
  const spendByKat = groupBy(orders, (p) => p.id_categoria);
  const totalSpend = sum(orders, (p) => p.valor_total) || 1;

  const unitIds = new Set(dims.dim_unidades.map((u) => u.id_unidade));
  for (const id of new Set(orders.map((p) => p.id_unidade).filter(Boolean))) {
    if (unitIds.has(id)) continue;
    dims.dim_unidades.push({ id_unidade: id, unidade: rotulos.unidades?.[id] || id, cidade: "—", uf: "SP", tipo: "Operação" });
    report.avisos.push(`dim_unidades: unidade ${id} criada automaticamente (informe cidade/UF no cadastro).`);
  }

  const katIds = new Set(dims.dim_categorias.map((c) => c.id_categoria));
  for (const [id, rows] of spendByKat) {
    if (!id || katIds.has(id)) continue;
    const spend = sum(rows, (p) => p.valor_total);
    dims.dim_categorias.push({
      id_categoria: id,
      categoria: rotulos.categorias?.[id] || id,
      grupo: "Geral", criticidade: "Média", natureza: "Custo indireto",
      peso_spend: Number((spend / totalSpend * 100).toFixed(2)),
      drift_mensal: 0.003,
      lead_time_base_dias: Math.max(1, Math.round(sum(rows, (p) => p.atraso_dias || 0) / (rows.length || 1)) + 10),
    });
    report.avisos.push(`dim_categorias: categoria ${id} criada automaticamente (nome = código).`);
  }

  const itemIds = new Set(dims.dim_itens.map((i) => i.id_item));
  for (const [id, rows] of groupBy(orders, (p) => p.id_item)) {
    if (!id || itemIds.has(id)) continue;
    const totalQty = sum(rows, (p) => p.quantidade) || 1;
    const weighted = sum(rows, (p) => p.valor_unitario * p.quantidade) / totalQty;
    dims.dim_itens.push({
      id_item: id,
      descricao: rotulos.itens?.[id] || id,
      id_categoria: rows[0].id_categoria,
      unidade_medida: "un",
      preco_referencia: Number((weighted || 1).toFixed(2)),
      criticidade: "Média",
    });
    report.avisos.push(`dim_itens: item ${id} criado automaticamente a partir do histórico de pedidos.`);
  }

  const supplierIds = new Set(dims.dim_fornecedores.map((f) => f.id_fornecedor));
  for (const [id, rows] of spendBySupplier) {
    if (!id || supplierIds.has(id)) continue;
    const first = rows.map((p) => p.data_emissao).sort()[0] || "";
    const cat = mode(rows.map((p) => p.id_categoria)) || dims.dim_categorias[0]?.id_categoria || "K0";
    dims.dim_fornecedores.push({
      id_fornecedor: id,
      razao_social: rotulos.fornecedores?.[id] || id,
      id_categoria: cat,
      uf: "SP", porte: "Médio", status: "Ativo",
      data_homologacao: first || new Date().toISOString().slice(0, 10),
      prazo_pagamento_dias: 30, iso9001: "Não",
      rating_cadastral: 70, risco: "Médio", lead_time_medio_dias: 15,
    });
    report.avisos.push(`dim_fornecedores: fornecedor ${id} criado automaticamente (sem cadastro na origem).`);
  }

  const buyerIds = new Set(dims.dim_compradores.map((c) => c.id_comprador));
  const fallbackUnit = dims.dim_unidades[0]?.id_unidade || "UN";
  for (const [id, rows] of groupBy(orders, (p) => p.id_comprador)) {
    if (!id || buyerIds.has(id)) continue;
    const unit = mode(rows.map((p) => p.id_unidade)) || fallbackUnit;
    dims.dim_compradores.push({ id_comprador: id, comprador: rotulos.compradores?.[id] || id, id_unidade: unit, categoria_responsavel: "—" });
    report.avisos.push(`dim_compradores: comprador ${id} criado automaticamente.`);
  }
  return dims;
}

/** Série mensal de preços derivada do preço efetivamente praticado. */
export function derivePrices(orders, dims) {
  const byItemMonth = groupBy(orders, (p) => `${p.id_item}|${p.mes_ref}`);
  const rows = [];
  for (const [, group] of byItemMonth) {
    const qty = sum(group, (p) => p.quantidade) || 1;
    const price = sum(group, (p) => p.valor_unitario * p.quantidade) / qty;
    if (!price) continue;
    const item = dims.dim_itens.find((i) => i.id_item === group[0].id_item);
    rows.push({
      mes_ref: group[0].mes_ref,
      id_item: group[0].id_item,
      id_categoria: group[0].id_categoria || item?.id_categoria || "",
      descricao_item: item?.descricao || group[0].id_item,
      preco_medio: Number(price.toFixed(2)),
      indice_categoria: 1,
      variacao_mm_pct: 0,
    });
  }
  // Índice por categoria relativo ao primeiro mês disponível.
  const base = new Map();
  for (const mes of [...new Set(rows.map((r) => r.mes_ref))].sort()) {
    for (const kat of new Set(rows.map((r) => r.id_categoria))) {
      const subset = rows.filter((r) => r.mes_ref === mes && r.id_categoria === kat);
      if (!subset.length) continue;
      const avgPrice = sum(subset, (r) => r.preco_medio) / subset.length;
      if (!base.has(kat)) base.set(kat, avgPrice || 1);
    }
  }
  const previous = new Map();
  for (const r of rows.sort((a, b) => a.mes_ref.localeCompare(b.mes_ref))) {
    const b = base.get(r.id_categoria) || 1;
    r.indice_categoria = Number((r.preco_medio / b).toFixed(4));
    const key = `${r.mes_ref}|${r.id_categoria}`;
    const prev = previous.get(key);
    r.variacao_mm_pct = prev ? Number(((r.preco_medio / prev - 1) * 100).toFixed(2)) : 0;
    previous.set(key, r.preco_medio);
  }
  return rows.sort((a, b) => a.mes_ref.localeCompare(b.mes_ref) || a.id_item.localeCompare(b.id_item));
}

/* ------------------------------ validação --------------------------------- */
export function validateDataset(dims, facts) {
  const errors = [];
  const warnings = [];
  const pkDup = (rows, pk, name) => {
    if (!pk) return;
    const seen = new Set();
    for (const r of rows) {
      if (!r[pk]) errors.push(`${name}: ${pk} vazio.`);
      else if (seen.has(r[pk])) errors.push(`${name}: ${pk} duplicado (${r[pk]}).`);
      seen.add(r[pk]);
    }
  };
  pkDup(dims.dim_unidades, "id_unidade", "dim_unidades");
  pkDup(dims.dim_compradores, "id_comprador", "dim_compradores");
  pkDup(dims.dim_categorias, "id_categoria", "dim_categorias");
  pkDup(dims.dim_itens, "id_item", "dim_itens");
  pkDup(dims.dim_fornecedores, "id_fornecedor", "dim_fornecedores");
  pkDup(dims.dim_contratos, "id_contrato", "dim_contratos");
  pkDup(facts.fato_pedidos, "id_pedido", "fato_pedidos");

  const sets = {
    unidade: new Set(dims.dim_unidades.map((r) => r.id_unidade)),
    comprador: new Set(dims.dim_compradores.map((r) => r.id_comprador)),
    categoria: new Set(dims.dim_categorias.map((r) => r.id_categoria)),
    item: new Set(dims.dim_itens.map((r) => r.id_item)),
    fornecedor: new Set(dims.dim_fornecedores.map((r) => r.id_fornecedor)),
  };
  const fk = (rows, col, set, name) => {
    const bad = rows.filter((r) => r[col] && !set.has(r[col]));
    if (bad.length) errors.push(`${name}: ${bad.length} referência(s) inválida(s) em ${col} (ex.: ${bad[0][col]}).`);
  };
  fk(facts.fato_pedidos, "id_unidade", sets.unidade, "fato_pedidos");
  fk(facts.fato_pedidos, "id_comprador", sets.comprador, "fato_pedidos");
  fk(facts.fato_pedidos, "id_categoria", sets.categoria, "fato_pedidos");
  fk(facts.fato_pedidos, "id_item", sets.item, "fato_pedidos");
  fk(facts.fato_pedidos, "id_fornecedor", sets.fornecedor, "fato_pedidos");
  fk(facts.fato_cotacoes, "id_categoria", sets.categoria, "fato_cotacoes");
  fk(facts.fato_cotacoes, "id_item", sets.item, "fato_cotacoes");
  fk(facts.fato_cotacoes, "id_fornecedor", sets.fornecedor, "fato_cotacoes");
  fk(dims.dim_itens, "id_categoria", sets.categoria, "dim_itens");
  fk(dims.dim_fornecedores, "id_categoria", sets.categoria, "dim_fornecedores");
  fk(dims.dim_compradores, "id_unidade", sets.unidade, "dim_compradores");
  fk(dims.dim_contratos, "id_fornecedor", sets.fornecedor, "dim_contratos");
  fk(dims.dim_contratos, "id_categoria", sets.categoria, "dim_contratos");

  for (const p of facts.fato_pedidos) {
    for (const col of ["id_fornecedor", "id_item", "id_categoria", "id_unidade", "id_comprador"]) {
      if (!p[col]) errors.push(`fato_pedidos ${p.id_pedido}: ${col} vazio.`);
    }
    if (!STATUS_PEDIDO.includes(p.status)) errors.push(`fato_pedidos ${p.id_pedido}: status inválido (${p.status}). Use traduções no mapeamento.`);
    if (!p.data_emissao) errors.push(`fato_pedidos ${p.id_pedido}: data de emissão inválida.`);
    if (p.mes_ref !== p.data_emissao?.slice(0, 7)) errors.push(`fato_pedidos ${p.id_pedido}: mes_ref incoerente com a emissão.`);
    if (!(Number(p.quantidade) > 0)) errors.push(`fato_pedidos ${p.id_pedido}: quantidade deve ser > 0.`);
    if (!(Number(p.valor_unitario) > 0)) errors.push(`fato_pedidos ${p.id_pedido}: valor_unitario deve ser > 0.`);
    const expected = (Number(p.preco_referencia) - Number(p.valor_unitario)) * Number(p.quantidade);
    if (Math.abs(expected - Number(p.saving_valor)) > 1) errors.push(`fato_pedidos ${p.id_pedido}: saving inconsistente com o baseline.`);
    const otif = p.status === "Entregue" && Number(p.atraso_dias) === 0
      && Number(p.qtd_recebida) >= Number(p.quantidade) && Number(p.qtd_defeito) === 0 ? 1 : 0;
    if (otif !== Number(p.otif)) errors.push(`fato_pedidos ${p.id_pedido}: OTIF incoerente.`);
  }
  for (const f of dims.dim_fornecedores) {
    if (!f.id_categoria) errors.push(`dim_fornecedores ${f.id_fornecedor}: id_categoria vazio.`);
    if (!["Ativo", "Em homologação", "Suspenso", "Inativo"].includes(f.status)) errors.push(`dim_fornecedores ${f.id_fornecedor}: status "${f.status}" inválido — adicione a tradução no mapeamento.`);
    if (f.risco && !RISCO.includes(f.risco)) errors.push(`dim_fornecedores ${f.id_fornecedor}: risco "${f.risco}" inválido.`);
    if (f.porte && !PORTE.includes(f.porte)) errors.push(`dim_fornecedores ${f.id_fornecedor}: porte "${f.porte}" inválido.`);
    if (!["Sim", "Não"].includes(f.iso9001)) errors.push(`dim_fornecedores ${f.id_fornecedor}: ISO 9001 deve ser "Sim" ou "Não" (recebido "${f.iso9001}").`);
  }
  for (const c of dims.dim_categorias) {
    if (!CRITICIDADE.includes(c.criticidade)) errors.push(`dim_categorias ${c.id_categoria}: criticidade "${c.criticidade}" inválida.`);
  }
  for (const i of dims.dim_itens) {
    if (!i.id_categoria) errors.push(`dim_itens ${i.id_item}: id_categoria vazio.`);
    if (!(Number(i.preco_referencia) > 0)) errors.push(`dim_itens ${i.id_item}: preço de referência deve ser > 0.`);
  }
  for (const u of dims.dim_compradores) {
    if (!u.id_unidade) errors.push(`dim_compradores ${u.id_comprador}: id_unidade vazio.`);
  }
  for (const c of dims.dim_contratos) {
    if (!STATUS_CONTRATO.includes(c.status)) errors.push(`dim_contratos ${c.id_contrato}: status inválido (${c.status}).`);
    if (c.data_fim <= c.data_inicio) errors.push(`dim_contratos ${c.id_contrato}: data_fim deve ser maior que data_inicio.`);
  }

  if (facts.fato_cotacoes.length) {
    const chaves = new Set();
    let duplicadas = 0;
    for (const q of facts.fato_cotacoes) {
      const key = `${q.id_requisicao}|${q.id_fornecedor}|${q.id_item}`;
      if (chaves.has(key)) duplicadas++;
      chaves.add(key);
    }
    if (duplicadas) errors.push(`fato_cotacoes: ${duplicadas} proposta(s) duplicada(s) por requisição/fornecedor/item.`);
    const byReq = new Map();
    for (const q of facts.fato_cotacoes) byReq.set(q.id_requisicao, (byReq.get(q.id_requisicao) || 0) + Number(q.selecionada || 0));
    const bad = [...byReq.entries()].filter(([, v]) => v !== 1);
    if (bad.length) warnings.push(`fato_cotacoes: ${bad.length} requisição(ões) sem exatamente uma proposta vencedora — o funil de negociação ficará parcial.`);
    for (const q of facts.fato_cotacoes) {
      q.valor_total = Number(q.valor_total) || (Number(q.quantidade) * Number(q.preco_unitario) + Number(q.frete || 0));
      if (!q.preco_referencia) q.preco_referencia = dims.dim_itens.find((i) => i.id_item === q.id_item)?.preco_referencia || q.preco_unitario;
    }
  }
  if (!facts.fato_pedidos.length) errors.push("fato_pedidos: nenhum pedido válido foi importado.");
  const chavesOrc = new Set();
  for (const o of facts.fato_orcamento) {
    const key = `${o.mes_ref}|${o.id_categoria}|${o.id_unidade}`;
    if (chavesOrc.has(key)) errors.push(`fato_orcamento: competência/categoria/unidade duplicada (${key}).`);
    chavesOrc.add(key);
  }
  const chavesPreco = new Set();
  for (const p of facts.fato_precos) {
    const key = `${p.mes_ref}|${p.id_item}`;
    if (chavesPreco.has(key)) errors.push(`fato_precos: item/competência duplicado (${key}).`);
    chavesPreco.add(key);
  }
  if (!facts.fato_orcamento.length) warnings.push("fato_orcamento: vazio — os KPIs de aderência ao orçamento ficarão sem denominador.");
  if (!facts.fato_cotacoes.length) warnings.push("fato_cotacoes: vazio — funil de cotações e competitividade não serão calculados.");
  if (!dims.dim_contratos.length) warnings.push("dim_contratos: vazio — a página de contratos e riscos ficará sem carteira.");

  return { errors, warnings };
}

/* --------------------------------- I/O ------------------------------------ */
const esc = (v) => {
  const t = v == null ? "" : String(v);
  return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export function toCSV(header, rows) {
  return [header.join(";"), ...rows.map((r) => header.map((h) => esc(r[h])).join(";"))].join("\n") + "\n";
}

export function writeDataset(outDir, dims, facts) {
  fs.mkdirSync(outDir, { recursive: true });
  const all = { ...dims, ...facts };
  for (const [name, spec] of Object.entries(TABLES)) {
    const rows = all[name] || [];
    fs.writeFileSync(path.join(outDir, spec.file), toCSV(spec.cols, rows), "utf8");
  }
}

/** Carrega e adapta uma empresa inteira a partir de config/empresa.json. */
export function importarEmpresa({ config, sourceDir, rotulos = {}, report, allowDerive = true }) {
  const origem = config.origem || {};
  const tabelas = origem.tabelas || {};
  const dims = { dim_unidades: [], dim_compradores: [], dim_categorias: [], dim_itens: [], dim_fornecedores: [], dim_contratos: [] };
  const facts = { fato_pedidos: [], fato_cotacoes: [], fato_precos: [], fato_orcamento: [] };

  const loaded = new Set();
  for (const [name] of Object.entries(TABLES)) {
    const cfg = mapaTabela(tabelas, name);
    const sourceFile = cfg?.arquivo ? path.join(sourceDir, cfg.arquivo) : null;
    if (!sourceFile || !fs.existsSync(sourceFile)) {
      if (name === "fato_pedidos") {
        report.erros.push(`Origem obrigatória ausente: ${name}${cfg?.arquivo ? ` (${cfg.arquivo})` : " sem mapeamento"}.`);
      } else if (cfg && !cfg.opcional) {
        report.erros.push(`Origem ausente: ${name} (${cfg.arquivo}).`);
      }
      continue;
    }
    const table = readSourceCSV(sourceFile, origem);
    if (!table.header.length) { report.erros.push(`${name}: arquivo vazio (${cfg.arquivo}).`); continue; }
    const rows = mapTable(name, table, cfg, origem, report);
    if (name.startsWith("dim_")) dims[name] = rows;
    else facts[name] = rows;
    loaded.add(name);
    report.tabelas[name] = { arquivo: cfg.arquivo, linhas: rows.length };
  }

  if (!loaded.has("fato_pedidos")) return { dims, facts, loaded };

  // Dimensões obrigatórias: deriva do próprio pedido quando não vier cadastro.
  const minimal = {
    dim_unidades: true, dim_compradores: true, dim_categorias: true, dim_itens: true, dim_fornecedores: true,
  };
  for (const [name, mandatory] of Object.entries(minimal)) {
    if (loaded.has(name)) continue;
    if (mandatory && allowDerive) report.avisos.push(`${name}: cadastro não informado — dimensão derivada dos pedidos.`);
  }
  completeDimensions(facts.fato_pedidos, dims, rotulos, report);
  deriveOrders(facts.fato_pedidos, dims);
  // Segunda passagem: categorias/itens criados a partir do pedido atualizam
  // as referências que ainda estavam vazias.
  completeDimensions(facts.fato_pedidos, dims, rotulos, report);
  deriveOrders(facts.fato_pedidos, dims);

  if (!loaded.has("fato_precos")) {
    facts.fato_precos = derivePrices(facts.fato_pedidos, dims);
    if (facts.fato_precos.length) report.avisos.push(`fato_precos: série derivada do preço praticado em ${facts.fato_precos.length} item/mês.`);
  }
  if (loaded.has("fato_cotacoes")) {
    for (const q of facts.fato_cotacoes) {
      q.data_cotacao = parseDate(q.data_cotacao) || q.data_cotacao;
      q.selecionada = Number(q.selecionada) === 1 || String(q.selecionada).toUpperCase() === "SIM" ? 1 : 0;
      q.id_categoria = q.id_categoria || dims.dim_itens.find((i) => i.id_item === q.id_item)?.id_categoria || "";
      q.valor_total = Number(q.valor_total) || (Number(q.quantidade) * Number(q.preco_unitario) + Number(q.frete || 0));
    }
  }
  if (loaded.has("fato_orcamento")) {
    for (const o of facts.fato_orcamento) o.mes_ref = parseMonth(o.mes_ref) || o.mes_ref;
  }
  if (loaded.has("fato_precos")) {
    for (const p of facts.fato_precos) p.mes_ref = parseMonth(p.mes_ref) || p.mes_ref;
  }

  // Ordena por chave para gerar diffs estáveis entre execuções.
  const by = (pk) => (a, b) => String(a[pk] || "").localeCompare(String(b[pk] || ""));
  dims.dim_unidades.sort(by("id_unidade"));
  dims.dim_compradores.sort(by("id_comprador"));
  dims.dim_categorias.sort(by("id_categoria"));
  dims.dim_itens.sort(by("id_item"));
  dims.dim_fornecedores.sort(by("id_fornecedor"));
  dims.dim_contratos.sort(by("id_contrato"));
  facts.fato_pedidos.sort(by("id_pedido"));
  facts.fato_cotacoes.sort((a, b) => String(a.id_requisicao).localeCompare(String(b.id_requisicao)) || String(a.id_fornecedor).localeCompare(String(b.id_fornecedor)));
  facts.fato_precos.sort((a, b) => String(a.mes_ref).localeCompare(String(b.mes_ref)) || String(a.id_item).localeCompare(String(b.id_item)));
  facts.fato_orcamento.sort((a, b) => String(a.mes_ref).localeCompare(String(b.mes_ref)));
  return { dims, facts, loaded };
}
