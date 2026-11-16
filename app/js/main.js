/* Bootstrap da aplicação: navegação, filtros globais e exportações. */
import { store, loadData, defaultFilters, monthsBetween } from "./data.js";
import { renderPage, ui, buildContext } from "./pages.js";
import { bindTooltips, toast, monthLabel, dateBR, num } from "./util.js";
import { exportExcel, exportPDF, exportPedidos, exportCotacoes } from "./report.js";
import { initUpload } from "./upload.js";

const PAGES = {
  exec: ["Visão executiva", "Desempenho de compras, economia e fornecedores"],
  cotacoes: ["Cotações & economia", "Negociação, competitividade e savings capturados"],
  fornecedores: ["Fornecedores", "Scorecard, risco e concentração de fornecimento"],
  prazos: ["Prazos & qualidade", "OTIF, lead time e confiabilidade das entregas"],
  precos: ["Preços & reajustes", "Índices, variações e exposição a reajustes"],
  dados: ["Dados & exportação", "Ingestão, qualidade, dicionário e relatórios"],
};

let current = "exec";
const $ = (id) => document.getElementById(id);

function populateFilters() {
  const mk = (sel, items, value, labelFn) => {
    sel.insertAdjacentHTML("beforeend", items.map((x) => `<option value="${x[value]}">${labelFn(x)}</option>`).join(""));
  };
  mk($("f-unidade"), store.dim.unidades, "id_unidade", (u) => `${u.unidade}`);
  mk($("f-categoria"), store.dim.categorias, "id_categoria", (c) => c.categoria);
  mk($("f-comprador"), store.dim.compradores, "id_comprador", (c) => c.comprador);
  mk($("f-fornecedor"), [...store.dim.fornecedores].sort((a, b) => a.razao_social.localeCompare(b.razao_social)), "id_fornecedor", (f) => f.razao_social);
}

function readFilters() {
  store.filters.unidade = $("f-unidade").value;
  store.filters.categoria = $("f-categoria").value;
  store.filters.comprador = $("f-comprador").value;
  store.filters.fornecedor = $("f-fornecedor").value;
  store.filters.status = $("f-status").value;
  store.filters.period = $("f-periodo").value;
  if (store.filters.period === "custom") {
    store.filters.from = $("f-de").value;
    store.filters.to = $("f-ate").value;
  }
}

function toggleCustomDates() {
  const custom = $("f-periodo").value === "custom";
  $("date-from-wrap").style.display = custom ? "" : "none";
  $("date-to-wrap").style.display = custom ? "" : "none";
  if (custom && !$("f-de").value) {
    const b = buildPeriodPreview("12");
    $("f-de").value = b.from;
    $("f-ate").value = b.to;
  }
}

function buildPeriodPreview(period) {
  const max = store.maxDate.slice(0, 7);
  const [y, m] = max.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  if (period === "all") return { from: "2024-01-01", to: end };
  if (period === "ytd") return { from: `${y}-01-01`, to: end };
  const n = Number(period) || 12;
  const start = new Date(Date.UTC(y, m - 1 - (n - 1), 1)).toISOString().slice(0, 7);
  return { from: `${start}-01`, to: end };
}

function updateSidebar() {
  const f = store.filters;
  const first = store.fato.pedidos.reduce((m, p) => (p.data_emissao < m ? p.data_emissao : m), store.maxDate);
  $("src-status").textContent = `Dataset carregado · ${num(store.fato.pedidos.length)} pedidos`;
  $("src-detail").innerHTML = `Base ${monthLabel(first.slice(0, 7))} → ${monthLabel(store.maxDate.slice(0, 7))}<br />Última carga ${store.loadedAt ? store.loadedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"} · camada gold`;
  const pills = document.querySelectorAll(".chip[data-filter]");
  pills.forEach((p) => p.remove());
}

function refresh() {
  try {
    renderPage(current);
    updateSidebar();
    if (current === "dados") initUpload(() => refresh());
  } catch (err) {
    console.error(err);
    $(`page-${current}`).innerHTML = `<div class="card"><div class="empty">Erro ao renderizar a página: ${err.message}</div></div>`;
  }
}

function navigate(page) {
  if (!PAGES[page]) page = "exec";
  current = page;
  ui.page = page;
  document.querySelectorAll("[data-page]").forEach((n) => n.classList.toggle("active", n.dataset.page === page));
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("active", p.id === `page-${page}`));
  $("page-title").textContent = PAGES[page][0];
  $("page-sub").textContent = PAGES[page][1];
  refresh();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function wire() {
  document.querySelectorAll("[data-page]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      history.replaceState(null, "", `#${a.dataset.page}`);
      navigate(a.dataset.page);
      document.querySelector(".mobile-nav")?.scrollIntoView({ block: "nearest" });
    });
  });

  const onFilter = () => { readFilters(); toggleCustomDates(); refresh(); };
  ["f-unidade", "f-categoria", "f-comprador", "f-fornecedor", "f-status", "f-periodo"].forEach((id) => $(id).addEventListener("change", onFilter));
  ["f-de", "f-ate"].forEach((id) => $(id).addEventListener("change", () => { $("f-periodo").value = "custom"; onFilter(); }));

  $("btn-clear").addEventListener("click", () => {
    store.filters = defaultFilters();
    ["f-unidade", "f-categoria", "f-comprador", "f-fornecedor", "f-status"].forEach((id) => { $(id).value = ""; });
    $("f-periodo").value = "12";
    toggleCustomDates();
    refresh();
    toast("Filtros restaurados.");
  });

  $("btn-refresh").addEventListener("click", async () => {
    const btn = $("btn-refresh");
    btn.disabled = true;
    try {
      await loadData();
      refresh();
      toast("Dados recarregados da camada gold.", "good");
    } catch (e) { toast(`Falha ao recarregar: ${e.message}`, "bad"); }
    btn.disabled = false;
  });

  $("btn-xlsx").addEventListener("click", () => {
    try { exportExcel(buildContext()); toast("Excel gerado com 5 abas.", "good"); }
    catch (e) { console.error(e); toast("Falha ao gerar Excel.", "bad"); }
  });

  $("btn-pdf").addEventListener("click", () => {
    try { exportPDF(buildContext()); }
    catch (e) { console.error(e); toast("Falha ao gerar relatório.", "bad"); }
  });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const a = btn.dataset.action;
    if (a === "focus-supplier") { ui.supplier = btn.dataset.id; navigate("fornecedores"); }
    if (a === "export-xlsx") { exportExcel(buildContext()); toast("Excel gerado.", "good"); }
    if (a === "export-pdf") { exportPDF(buildContext()); }
    if (a === "export-pedidos") { exportPedidos(buildContext()); toast("CSV de pedidos gerado.", "good"); }
    if (a === "export-cotacoes") { exportCotacoes(buildContext()); toast("CSV de cotações gerado.", "good"); }
    if (a === "export-quotes") { exportCotacoes(buildContext()); toast("CSV de cotações gerado.", "good"); }
  });
}

async function boot() {
  try {
    await loadData();
    store.filters = defaultFilters();
    populateFilters();
    bindTooltips(document);
    wire();
    toggleCustomDates();
    const hash = location.hash.replace("#", "");
    navigate(PAGES[hash] ? hash : "exec");
  } catch (err) {
    console.error(err);
    document.querySelector(".content").innerHTML = `<div class="card"><div class="empty">
      <strong>Não foi possível carregar o dataset.</strong><br />${err.message}<br /><br />
      Execute <span class="mono">npm start</span> na raiz do projeto e abra <span class="mono">http://localhost:4173</span>.</div></div>`;
  }
}

boot();
