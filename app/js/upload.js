/* Importação de CSV com validação e recálculo dos indicadores. */
import { parseCSV, esc, num, brl, dateBR, toast, download, toCSV } from "./util.js";
import { store, addUploadedOrders, clearUploads, uploadsCount } from "./data.js";

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
  const minDate = "2023-01-01";
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
    if (data < minDate || data > "2027-12-31") warnings.push(`Linha ${line}: data fora da janela histórica (${dateBR(data)}).`);

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
    const ref = item?.preco_referencia || unit;
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
      saving_valor: Math.max(0, (ref - unit) * qtd),
      tem_contrato: Number(o.tem_contrato) === 1 ? 1 : 0,
      data_entrega_prevista: prev,
      data_entrega_real: real,
      atraso_dias: atraso,
      qtd_recebida: normNum(o.qtd_recebida) || (status === "Entregue" || status === "Atrasado" ? qtd : 0),
      qtd_defeito: normNum(o.qtd_defeito) || 0,
      otif: status === "Entregue" && atraso === 0 ? 1 : 0,
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

function renderValidation(v, onApply) {
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

function handleFile(file, onChange) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast("Arquivo acima de 5 MB.", "bad"); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const v = validateCSV(String(reader.result), file.name);
    renderValidation(v, onChange);
    if (v.errors.length) toast(`${v.errors.length} erro(s) de validação encontrados.`, "bad");
    else toast(`${v.rows.length} registros validados com sucesso.`, "good");
  };
  reader.readAsText(file, "utf-8");
}

export const TEMPLATE_HEADER = [
  "id_pedido", "id_requisicao", "data_emissao", "id_fornecedor", "id_item", "id_categoria",
  "id_comprador", "id_unidade", "quantidade", "valor_unitario", "frete", "valor_total",
  "status", "data_entrega_prevista", "data_entrega_real", "qtd_recebida", "qtd_defeito", "tem_contrato",
];

let clickBound = false;
let dropBound = false;

export function initUpload(onChange) {
  const input = document.getElementById("file-input");
  const drop = document.getElementById("drop");

  if (!clickBound) document.addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "pick-file") { input?.click(); }
    if (action === "download-template") {
      const example = [
        ["PO-2026-09999", "REQ-202610901", "2026-10-15", "F001", "I001", "K1", "C1", "U1", 2500, 7.12, 180, 17980, "Entregue", "2026-10-28", "2026-10-27", 2500, 0, 1],
        ["PO-2026-10000", "REQ-202610902", "2026-10-18", "F015", "I006", "K2", "C2", "U1", 40, 139.9, 0, 5596, "Em trânsito", "2026-11-04", "", 0, 0, 0],
      ];
      download("modelo_importacao_pedidos.csv", "\uFEFF" + toCSV(TEMPLATE_HEADER, example));
      toast("Modelo CSV baixado.", "good");
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
      if (!uploadsCount()) { toast("Nenhuma importação local para remover."); return; }
      clearUploads();
      toast("Importações locais removidas.");
      onChange?.();
    }
  }), clickBound = true;

  if (!drop || !input || dropBound) return;
  dropBound = true;
  drop.addEventListener("click", (e) => { if (!e.target.closest("button")) input.click(); });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    const f = e.dataTransfer?.files?.[0];
    handleFile(f, onChange);
  });
  input.addEventListener("change", () => { handleFile(input.files?.[0], onChange); input.value = ""; });
}
