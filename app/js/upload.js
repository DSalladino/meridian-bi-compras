/* Importação de CSV com validação e recálculo dos indicadores. */
import { parseCSV, esc, num, brl, dateBR, toast, download, toCSV } from "./util.js";
import { store, addUploadedOrders, clearUploads, storedUploadsCount, computeOtif } from "./data.js";

const REQUIRED = ["id_pedido", "data_emissao", "id_fornecedor", "id_categoria", "id_item", "id_unidade", "quantidade", "valor_unitario", "valor_total", "status"];
const STATUS = ["Entregue", "Em trânsito", "Parcial", "Atrasado", "Cancelado"];
let pending = null;

const normNum = (v) => {
  if (v == null || v === "") return NaN;
  const s = String(v).replace(/[R$\s]/g, "");
  if (s.includes(",") && s.includes(".")) return Number(s.replace(/\./g, "").replace(",", "."));
  if (s.includes(",")) return Number(s.replace(",", "."));
  return Number(s);
};
function normDate(v) {
  const s = String(v || "").trim();
  let y, m, d;
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

export function validateCSV(text, filename) {
  const { header, rows } = parseCSV(text);
  const errors = [], warnings = [];
  if (!header.length) return { errors: ["Arquivo vazio ou ilegível."], warnings, rows: [], header };
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) errors.push(`Colunas obrigatórias ausentes: ${missing.join(", ")}.`);
  if (errors.length) return { errors, warnings, rows: [], header, filename };

  const maxDate = store.maxDate;
  const minDate = store.minDate || "2000-01-01";
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

    if (!store.idx.fById.has(o.id_fornecedor)) errors.push(`Linha ${line}: fornecedor inexistente (${o.id_fornecedor}).`);
    if (!store.idx.cById.has(o.id_categoria)) errors.push(`Linha ${line}: categoria inexistente (${o.id_categoria}).`);
    if (!store.idx.iById.has(o.id_item)) errors.push(`Linha ${line}: item inexistente (${o.id_item}).`);
    if (!store.idx.uById.has(o.id_unidade)) errors.push(`Linha ${line}: unidade inexistente (${o.id_unidade}).`);
    if (o.id_comprador && !store.idx.kById.has(o.id_comprador)) warnings.push(`Linha ${line}: comprador desconhecido (${o.id_comprador}).`);

    const qtd = normNum(o.quantidade);
    const unit = normNum(o.valor_unitario);
    const total = normNum(o.valor_total);
    if (!Number.isFinite(qtd) || qtd <= 0) errors.push(`Linha ${line}: quantidade inválida.`);
    if (!Number.isFinite(unit) || unit <= 0) errors.push(`Linha ${line}: valor_unitario inválido.`);
    if (!Number.isFinite(total) || total <= 0) errors.push(`Linha ${line}: valor_total inválido.`);
    else if (Number.isFinite(qtd) && Number.isFinite(unit)) {
      const calc = qtd * unit;
      if (Math.abs(calc - total) / total > 0.03) warnings.push(`Linha ${line}: valor_total difere de quantidade × valor_unitario em ${((total / calc - 1) * 100).toFixed(1)}%.`);
    }

    const status = STATUS.includes(o.status) ? o.status : "Entregue";
    if (o.status && !STATUS.includes(o.status)) warnings.push(`Linha ${line}: status "${o.status}" não reconhecido — assumido "Entregue".`);

    const prev = normDate(o.data_entrega_prevista) || data;
    const real = normDate(o.data_entrega_real);
    const atraso = real && prev ? Math.max(0, Math.round((new Date(real) - new Date(prev)) / 864e5)) : 0;
    const item = store.idx.iById.get(o.id_item);
    const ref = normNum(o.preco_referencia) || item?.preco_referencia || unit;
    const received = normNum(o.qtd_recebida) || (status === "Entregue" || status === "Atrasado" ? qtd : 0);
    const defects = normNum(o.qtd_defeito) || 0;
    const otif = computeOtif({
      status, atraso_dias: atraso, qtd_recebida: received, quantidade: qtd, qtd_defeito: defects,
    });
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
      tem_contrato: Number(o.tem_contrato) === 1 ? 1 : 0,
      data_entrega_prevista: prev,
      data_entrega_real: real,
      atraso_dias: atraso,
      qtd_recebida: received,
      qtd_defeito: defects,
      otif,
      nota_qualidade: normNum(o.nota_qualidade) || 4,
      status,
      modalidade: o.modalidade || "Importado",
      id_comprador: o.id_comprador || store.dim.compradores[0].id_comprador,
      id_requisicao: o.id_requisicao || `REQ-IMP-${id}`,
    });
  });

  if (rows.length > 5000) errors.push("Limite de 5.000 linhas por arquivo excedido.");
  if (dataMax(out) > maxDate) warnings.push(`Há pedidos após a competência atual da base (${dateBR(maxDate, false)}); o período padrão não os exibirá.`);
  return { errors, warnings, rows: out, header, filename };
}

function dataMax(rows) {
  return rows.reduce((m, r) => (r.data_emissao > m ? r.data_emissao : m), "0");
}

function renderValidation(v) {
  const el = document.getElementById("validation");
  if (!el) return;
  const ok = v.errors.length === 0 && v.rows.length > 0;
  const total = v.rows.reduce((s, r) => s + r.valor_total, 0);
  el.innerHTML = `
    <div class="vrow"><span class="badge ${ok ? "mint" : "blush"}">${ok ? "válido" : "com erros"}</span>
      <strong>${esc(v.filename || "arquivo")}</strong><span class="muted tiny">${num(v.rows.length)} registros · ${brl(total)}</span></div>
    ${v.errors.length ? `<div class="tiny" style="color:#a75a51">${v.errors.slice(0, 6).map((e) => `<div>• ${esc(e)}</div>`).join("")}${v.errors.length > 6 ? `<div>• +${v.errors.length - 6} erros…</div>` : ""}</div>` : ""}
    ${v.warnings.length ? `<div class="tiny" style="color:#96722a">${v.warnings.slice(0, 4).map((e) => `<div>• ${esc(e)}</div>`).join("")}${v.warnings.length > 4 ? `<div>• +${v.warnings.length - 4} avisos…</div>` : ""}</div>` : ""}
    ${ok ? `<div style="display:flex;gap:8px"><button class="btn btn-sm btn-primary" data-action="apply-upload">Aplicar importação</button>
      <button class="btn btn-sm btn-ghost" data-action="cancel-upload">Descartar</button></div>` : ""}`;
  pending = ok ? v.rows : null;
  el.dataset.ready = ok ? "1" : "0";
}

function handleFile(file) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast("Arquivo acima de 5 MB.", "bad"); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const v = validateCSV(String(reader.result), file.name);
    renderValidation(v);
    if (v.errors.length) toast(`${v.errors.length} erro(s) de validação encontrados.`, "bad");
    else toast(`${v.rows.length} registros validados com sucesso.`, "good");
  };
  reader.readAsText(file, "utf-8");
}

export const TEMPLATE_HEADER = [
  "id_pedido", "id_requisicao", "data_emissao", "id_fornecedor", "id_item", "id_categoria",
  "id_comprador", "id_unidade", "quantidade", "valor_unitario", "frete", "valor_total",
  "preco_referencia", "status", "data_entrega_prevista", "data_entrega_real", "qtd_recebida", "qtd_defeito", "tem_contrato",
];

function addDaysISO(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

let clickBound = false;

export function initUpload(onChange) {
  const input = document.getElementById("file-input");
  const drop = document.getElementById("drop");

  if (!clickBound) document.addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "pick-file") { document.getElementById("file-input")?.click(); }
    if (action === "download-template") {
      const itemA = store.dim.itens[0];
      const itemB = store.dim.itens[1] || itemA;
      const fornA = store.dim.fornecedores[0];
      const fornB = store.dim.fornecedores[1] || fornA;
      const comp = store.dim.compradores[0];
      const unit = store.dim.unidades[0];
      const base = store.maxDate || new Date().toISOString().slice(0, 10);
      const d1 = addDaysISO(base, -12);
      const d2 = addDaysISO(base, -9);
      const example = [
        [`PO-IMP-${d1.replaceAll("-", "")}-1`, `REQ-IMP-${d1.replaceAll("-", "")}-1`, d1, fornA.id_fornecedor, itemA.id_item, itemA.id_categoria, comp.id_comprador, unit.id_unidade, 2500, 7.12, 180, 17980, itemA.preco_referencia, "Entregue", addDaysISO(d1, 10), addDaysISO(d1, 9), 2500, 0, 1],
        [`PO-IMP-${d2.replaceAll("-", "")}-2`, `REQ-IMP-${d2.replaceAll("-", "")}-2`, d2, fornB.id_fornecedor, itemB.id_item, itemB.id_categoria, comp.id_comprador, unit.id_unidade, 40, 139.9, 0, 5596, itemB.preco_referencia, "Em trânsito", addDaysISO(d2, 14), "", 0, 0, 0],
      ];
      download("modelo_importacao_pedidos.csv", "\uFEFF" + toCSV(TEMPLATE_HEADER, example));
      toast("Modelo CSV baixado com datas e chaves da base atual.", "good");
    }
    if (action === "apply-upload") {
      if (!pending) return;
      const res = addUploadedOrders(pending);
      toast(`Importação aplicada: ${res.novos} novos, ${res.atualizados} atualizados.`, "good");
      pending = null;
      onChange?.();
    }
    if (action === "cancel-upload") {
      pending = null;
      const el = document.getElementById("validation");
      if (el) el.innerHTML = "";
    }
    if (action === "clear-uploads") {
      if (!storedUploadsCount()) { toast("Nenhuma importação local para remover."); return; }
      clearUploads();
      toast("Importações locais removidas.");
      onChange?.();
    }
  }), clickBound = true;

  if (!drop || !input || drop.dataset.bound === "1") return;
  drop.dataset.bound = "1";
  drop.addEventListener("click", (e) => { if (!e.target.closest("button")) input.click(); });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    const f = e.dataTransfer?.files?.[0];
    handleFile(f);
  });
  input.addEventListener("change", () => { handleFile(input.files?.[0]); input.value = ""; });
}
