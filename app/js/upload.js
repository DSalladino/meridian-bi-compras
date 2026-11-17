/* Importação de CSV com validação e recálculo dos indicadores. */
import { esc, num, brl, toast, download, toCSV } from "./util.js";
import { store, addUploadedOrders, clearUploads, storedUploadsCount } from "./data.js";
import { normalizeImport, TEMPLATE_HEADER } from "./import-core.js";

export { TEMPLATE_HEADER };

let pending = null;

/** Em produção o servidor valida e persiste; em demo/GitHub Pages fica no navegador. */
async function salvarImportacao(rows) {
  if (!store.api) return { ...addUploadedOrders(rows), local: true };
  const res = await fetch("../api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
    body: JSON.stringify({ rows }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.errors?.[0] || body.erro || `Falha ao importar (${res.status}).`);
  return { ...body, local: false };
}

const PAPEIS_IMPORTACAO = ["admin", "analista", "comprador"];
const podeImportar = () => !store.api || PAPEIS_IMPORTACAO.includes(store.usuario?.papel);

export function validateCSV(text, filename) {
  return normalizeImport({
    text, filename,
    dims: store.dim,
    minDate: store.minDate,
    maxDate: store.maxDate,
    maxRows: store.limites?.linhasUpload || 5000,
  });
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
  if (!podeImportar()) { toast("Seu papel permite consultar, mas não importar dados.", "bad"); return; }
  if (file.size > (store.limites?.tamanhoUploadMb || 5) * 1024 * 1024) { toast(`Arquivo acima de ${store.limites?.tamanhoUploadMb || 5} MB.`, "bad"); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const v = validateCSV(String(reader.result), file.name);
    renderValidation(v);
    if (v.errors.length) toast(`${v.errors.length} erro(s) de validação encontrados.`, "bad");
    else toast(`${v.rows.length} registros validados com sucesso.`, "good");
  };
  reader.readAsText(file, "utf-8");
}

function addDaysISO(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

let clickBound = false;

export function initUpload(onChange) {
  const input = document.getElementById("file-input");
  const drop = document.getElementById("drop");

  if (!clickBound) document.addEventListener("click", async (e) => {
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
      if (!podeImportar()) { toast("Seu papel permite consultar, mas não importar dados.", "bad"); return; }
      const btn = e.target.closest("[data-action]");
      if (btn) btn.disabled = true;
      try {
        const res = await salvarImportacao(pending);
        toast(`Importação aplicada: ${res.novos} novos, ${res.atualizados} atualizados${res.local ? " (neste navegador)" : " (salva no servidor)"}.`, "good");
        pending = null;
        await onChange?.();
      } catch (err) {
        console.error(err);
        toast(`Falha ao salvar importação: ${err.message}`, "bad");
        if (btn) btn.disabled = false;
      }
    }
    if (action === "cancel-upload") {
      pending = null;
      const el = document.getElementById("validation");
      if (el) el.innerHTML = "";
    }
    if (action === "clear-uploads") {
      if (store.api && !confirm("Remover todas as importações persistidas no servidor? A operação fica registrada na auditoria.")) return;
      if (!storedUploadsCount() && !store.api) { toast("Nenhuma importação local para remover."); return; }
      const remover = async () => {
        if (store.api) {
          const res = await fetch("../api/import", { method: "DELETE", headers: { "X-Requested-With": "fetch" } });
          if (!res.ok) throw new Error(`falha ${res.status}`);
        }
        clearUploads();
        toast("Importações removidas.");
        onChange?.();
      };
      remover().catch((err) => toast(`Falha ao remover importações: ${err.message}`, "bad"));
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
