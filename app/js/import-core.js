/* Núcleo puro da importação de pedidos.
 *
 * Sem DOM e sem estado global: o painel usa este módulo para validar o CSV
 * antes de aplicar, e o servidor de produção usa exatamente as mesmas regras
 * para persistir a importação. Assim a validação do navegador nunca é a única
 * barreira de uma base real.
 */
import { parseCSV, dateBR } from "./util.js";
import { computeOtif } from "./kpi.js";

export const IMPORT_STATUS = ["Entregue", "Em trânsito", "Parcial", "Atrasado", "Cancelado"];

export const IMPORT_REQUIRED = [
  "id_pedido", "data_emissao", "id_fornecedor", "id_categoria", "id_item", "id_unidade",
  "quantidade", "valor_unitario", "valor_total", "status",
];

export const TEMPLATE_HEADER = [
  "id_pedido", "id_requisicao", "data_emissao", "id_fornecedor", "id_item", "id_categoria",
  "id_comprador", "id_unidade", "quantidade", "valor_unitario", "frete", "valor_total",
  "preco_referencia", "status", "data_entrega_prevista", "data_entrega_real", "qtd_recebida",
  "qtd_defeito", "tem_contrato",
];

/** Converte "1.234,56", "1234.56", "R$ 1.234,56" em número. */
export function normNum(v) {
  if (v == null || v === "") return NaN;
  const s = String(v).replace(/[R$\s]/g, "");
  if (s.includes(",") && s.includes(".")) return Number(s.replace(/\./g, "").replace(",", "."));
  if (s.includes(",")) return Number(s.replace(",", "."));
  return Number(s);
}

/** Aceita ISO (aaaa-mm-dd) e pt-BR (dd/mm/aaaa); devolve ISO ou "". */
export function normDate(v) {
  const s = String(v || "").trim();
  let y; let m; let d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { [y, m, d] = s.split("-").map(Number); }
  else {
    const mm = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
    if (!mm) return "";
    d = Number(mm[1]); m = Number(mm[2]); y = Number(mm[3]);
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return "";
  return dt.toISOString().slice(0, 10);
}

const dataMax = (rows) => rows.reduce((m, r) => (r.data_emissao > m ? r.data_emissao : m), "0");

/**
 * Valida e normaliza um CSV de pedidos.
 *
 * @param {object} opts
 * @param {string} opts.text       conteúdo do CSV
 * @param {string} [opts.filename] nome exibido no relatório
 * @param {object} opts.dims       { fornecedores, categorias, itens, unidades, compradores }
 * @param {string} [opts.minDate]  limite inferior aceito
 * @param {string} [opts.maxDate]  competência atual da base
 * @param {number} [opts.maxRows]  limite de linhas
 * @returns {{errors:string[],warnings:string[],rows:object[],header:string[],filename?:string}}
 */
export function normalizeImport({
  text, filename, dims = {}, minDate = "2000-01-01", maxDate, maxRows = 5000,
}) {
  const { header, rows } = parseCSV(text);
  const errors = [];
  const warnings = [];
  if (!header.length) return { errors: ["Arquivo vazio ou ilegível."], warnings, rows: [], header };

  const missing = IMPORT_REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) {
    return { errors: [`Colunas obrigatórias ausentes: ${missing.join(", ")}.`], warnings, rows: [], header, filename };
  }

  const fById = new Map((dims.fornecedores || []).map((f) => [f.id_fornecedor, f]));
  const cById = new Map((dims.categorias || []).map((c) => [c.id_categoria, c]));
  const iById = new Map((dims.itens || []).map((i) => [i.id_item, i]));
  const uById = new Map((dims.unidades || []).map((u) => [u.id_unidade, u]));
  const kById = new Map((dims.compradores || []).map((k) => [k.id_comprador, k]));
  const defaultBuyer = dims.compradores?.[0]?.id_comprador || "";

  const now = new Date();
  const maxAllowed = new Date(Date.UTC(now.getUTCFullYear() + 2, now.getUTCMonth(), now.getUTCDate()))
    .toISOString().slice(0, 10);
  const seen = new Set();
  const out = [];

  rows.forEach((r, idx) => {
    const line = idx + 2;
    const o = {};
    header.forEach((h, i) => { o[h] = (r[i] ?? "").trim(); });
    const id = o.id_pedido;
    if (!id) { errors.push(`Linha ${line}: id_pedido vazio.`); return; }
    if (seen.has(id)) { errors.push(`Linha ${line}: id_pedido duplicado (${id}).`); return; }
    seen.add(id);

    const data = normDate(o.data_emissao);
    if (!data) { errors.push(`Linha ${line}: data_emissao inválida.`); return; }
    if (data < minDate || data > maxAllowed) warnings.push(`Linha ${line}: data fora da janela histórica (${dateBR(data)}).`);

    if (!fById.has(o.id_fornecedor)) errors.push(`Linha ${line}: fornecedor inexistente (${o.id_fornecedor}).`);
    if (!cById.has(o.id_categoria)) errors.push(`Linha ${line}: categoria inexistente (${o.id_categoria}).`);
    if (!iById.has(o.id_item)) errors.push(`Linha ${line}: item inexistente (${o.id_item}).`);
    if (!uById.has(o.id_unidade)) errors.push(`Linha ${line}: unidade inexistente (${o.id_unidade}).`);
    if (o.id_comprador && !kById.has(o.id_comprador)) warnings.push(`Linha ${line}: comprador desconhecido (${o.id_comprador}).`);

    const qtd = normNum(o.quantidade);
    const unit = normNum(o.valor_unitario);
    const total = normNum(o.valor_total);
    if (!Number.isFinite(qtd) || qtd <= 0) errors.push(`Linha ${line}: quantidade inválida.`);
    if (!Number.isFinite(unit) || unit <= 0) errors.push(`Linha ${line}: valor_unitario inválido.`);
    if (!Number.isFinite(total) || total <= 0) errors.push(`Linha ${line}: valor_total inválido.`);
    else if (Number.isFinite(qtd) && Number.isFinite(unit)) {
      const calc = qtd * unit;
      if (calc > 0 && Math.abs(calc - total) / total > 0.03) {
        warnings.push(`Linha ${line}: valor_total difere de quantidade × valor_unitario em ${((total / calc - 1) * 100).toFixed(1)}%.`);
      }
    }

    const status = IMPORT_STATUS.includes(o.status) ? o.status : "Entregue";
    if (o.status && !IMPORT_STATUS.includes(o.status)) warnings.push(`Linha ${line}: status "${o.status}" não reconhecido — assumido "Entregue".`);

    const prev = normDate(o.data_entrega_prevista) || data;
    const real = normDate(o.data_entrega_real);
    const atraso = real && prev ? Math.max(0, Math.round((new Date(real) - new Date(prev)) / 864e5)) : 0;
    const item = iById.get(o.id_item);
    const ref = normNum(o.preco_referencia) || item?.preco_referencia || unit;
    const received = normNum(o.qtd_recebida) || (status === "Entregue" || status === "Atrasado" ? qtd : 0);
    const defects = normNum(o.qtd_defeito) || 0;
    const otif = computeOtif({ status, atraso_dias: atraso, qtd_recebida: received, quantidade: qtd, qtd_defeito: defects });
    const mes = data.slice(0, 7);

    out.push({
      ...o,
      data_emissao: data,
      mes_ref: mes,
      mes,
      ano: mes.slice(0, 4),
      quantidade: qtd,
      valor_unitario: unit,
      valor_total: total,
      frete: normNum(o.frete) || 0,
      preco_referencia: ref,
      saving_valor: (ref - unit) * qtd,
      tem_contrato: Number(normNum(o.tem_contrato)) === 1 ? 1 : 0,
      data_entrega_prevista: prev,
      data_entrega_real: real,
      atraso_dias: atraso,
      qtd_recebida: received,
      qtd_defeito: defects,
      otif,
      nota_qualidade: normNum(o.nota_qualidade) || 4,
      status,
      modalidade: o.modalidade || "Importado",
      id_comprador: o.id_comprador || defaultBuyer,
      id_requisicao: o.id_requisicao || `REQ-IMP-${id}`,
    });
  });

  if (rows.length > maxRows) errors.push(`Limite de ${maxRows.toLocaleString("pt-BR")} linhas por arquivo excedido.`);
  if (maxDate && dataMax(out) > maxDate) {
    warnings.push(`Há pedidos após a competência atual da base (${dateBR(maxDate, false)}); o período padrão não os exibirá.`);
  }
  return { errors, warnings, rows: out, header, filename };
}
