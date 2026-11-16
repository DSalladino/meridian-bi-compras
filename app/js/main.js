/* Bootstrap da aplicação: navegação, filtros globais e exportações. */
import { store, loadData, defaultFilters, DATA_MODES } from "./data.js";
import { renderPage, ui, buildContext } from "./pages.js";
import { bindTooltips, toast, monthLabel, num, esc } from "./util.js";
import { exportExcel, exportPDF, exportPedidos, exportCotacoes } from "./report.js";
import { initUpload } from "./upload.js";

const PAGES = {
  exec: ["Visão executiva", "Desempenho de compras, economia e fornecedores"],
  cotacoes: ["Cotações & economia", "Negociação, competitividade e savings capturados"],
  fornecedores: ["Fornecedores", "Scorecard, risco e concentração de fornecimento"],
  prazos: ["Prazos & qualidade", "OTIF, lead time e confiabilidade das entregas"],
  precos: ["Preços & reajustes", "Índices, variações e exposição a reajustes"],
  contratos: ["Contratos & riscos", "Vigências, saldo contratual, reajustes e exposição"],
  dados: ["Dados & exportação", "Ingestão, qualidade, dicionário e relatórios"],
};

let current = "exec";
const $ = (id) => document.getElementById(id);

function populateFilters() {
  const mk = (sel, items, value, labelFn) => {
    sel.querySelectorAll("option:not(:first-child)").forEach((o) => o.remove());
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
  if (period === "all") return { from: store.minDate || `${y - 3}-01-01`, to: end };
  if (period === "ytd") return { from: `${y}-01-01`, to: end };
  const n = Number(period) || 12;
  const start = new Date(Date.UTC(y, m - 1 - (n - 1), 1)).toISOString().slice(0, 7);
  return { from: `${start}-01`, to: end };
}

function updateSidebar() {
  const mode = DATA_MODES[store.mode] || DATA_MODES.demo;
  const orders = store.fato.pedidos.length;
  $("src-status").textContent = orders
    ? `${mode.label} · ${num(orders)} pedidos`
    : `${mode.label} · sem resultados`;
  const range = orders || store.fato.precos.length || store.fato.orcamento.length
    ? `Base ${monthLabel(store.minDate.slice(0, 7))} → ${monthLabel(store.maxDate.slice(0, 7))}`
    : "Nenhum fato carregado";
  $("src-detail").innerHTML = `${range}<br />Última carga ${store.loadedAt ? store.loadedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"} · fonte ${esc(mode.short)}`;
}

function hasFacts() {
  return store.fato.pedidos.length > 0 || store.fato.cotacoes.length > 0 || store.fato.precos.length > 0;
}

function resetFilters() {
  store.filters = defaultFilters();
  ["f-unidade", "f-categoria", "f-comprador", "f-fornecedor", "f-status"].forEach((id) => { if ($(id)) $(id).value = ""; });
  if ($("f-periodo")) $("f-periodo").value = "12";
  toggleCustomDates();
}

async function applyDataMode(mode, successMessage) {
  try {
    await loadData(mode);
    resetFilters();
    populateFilters();
    refresh();
    toast(successMessage || `Fonte alterada para ${DATA_MODES[store.mode].label}.`, "good");
  } catch (err) {
    console.error(err);
    toast(`Falha ao alterar a fonte: ${err.message}`, "bad");
  }
}

/**
 * Dá nome acessível a cada gráfico: leitor de tela anuncia a seção do card.
 * Feito no DOM (e não em cada chart) para valer também para gráficos futuros.
 */
function annotateCharts() {
  document.querySelectorAll("svg.chart").forEach((svg) => {
    const card = svg.closest(".card");
    const heading = card?.querySelector("h3, h2, .card-head strong");
    const label = (heading?.textContent || "Gráfico do painel").trim().replace(/\s+/g, " ");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", svg.getAttribute("aria-label") || label);
    if (!svg.querySelector("title")) {
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = label;
      svg.prepend(title);
    }
    if (!svg.hasAttribute("focusable")) svg.setAttribute("focusable", "false");
  });
}

function refresh() {
  try {
    renderPage(current);
    annotateCharts();
    updateSidebar();
    if (current === "dados") initUpload(() => refresh());
  } catch (err) {
    console.error(err);
    $(`page-${current}`).innerHTML = `<div class="card"><div class="empty">Erro ao renderizar a página: ${esc(err.message)}</div></div>`;
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
  window.addEventListener("hashchange", () => {
    const page = location.hash.replace("#", "");
    if (PAGES[page] && page !== current) navigate(page);
  });

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
      await loadData(store.mode);
      refresh();
      toast(`Dados recarregados · ${DATA_MODES[store.mode].label}.`, "good");
    } catch (e) { toast(`Falha ao recarregar: ${e.message}`, "bad"); }
    btn.disabled = false;
  });

  $("btn-xlsx").addEventListener("click", () => {
    if (!hasFacts()) { toast("Sem dados para exportar. Gere ou importe uma base.", "bad"); return; }
    try { exportExcel(buildContext()); toast("Excel gerado com 5 abas.", "good"); }
    catch (e) { console.error(e); toast("Falha ao gerar Excel.", "bad"); }
  });

  $("btn-pdf").addEventListener("click", () => {
    if (!hasFacts()) { toast("Sem dados para gerar o relatório.", "bad"); return; }
    try { exportPDF(buildContext()); }
    catch (e) { console.error(e); toast("Falha ao gerar relatório.", "bad"); }
  });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const a = btn.dataset.action;
    if (a === "focus-supplier") { ui.supplier = btn.dataset.id; navigate("fornecedores"); }
    if (a === "set-mode") { applyDataMode(btn.dataset.mode); }
    if (a === "restore-demo") { applyDataMode("demo", "Dataset demo restaurado."); }
    if (a === "empty-data") {
      if (!window.confirm("Zerar os fatos da base? As dimensões e os cadastros serão mantidos, e as importações salvas não serão apagadas. Esta ação pode ser desfeita restaurando o dataset demo.")) return;
      applyDataMode("empty", "Base zerada. Dimensões preservadas.");
    }
    if (a === "export-xlsx") {
      if (!hasFacts()) { toast("Sem dados para exportar.", "bad"); return; }
      exportExcel(buildContext()); toast("Excel gerado.", "good");
    }
    if (a === "export-pdf") {
      if (!hasFacts()) { toast("Sem dados para gerar o relatório.", "bad"); return; }
      exportPDF(buildContext());
    }
    if (a === "export-pedidos") {
      if (!store.fato.pedidos.length) { toast("Sem pedidos para exportar.", "bad"); return; }
      exportPedidos(buildContext()); toast("CSV de pedidos gerado.", "good");
    }
    if (a === "export-cotacoes" || a === "export-quotes") {
      if (!store.fato.cotacoes.length) { toast("Sem cotações para exportar.", "bad"); return; }
      exportCotacoes(buildContext()); toast("CSV de cotações gerado.", "good");
    }
  });
}

async function boot() {
  try {
    await loadData(store.mode);
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
      <strong>Não foi possível carregar o dataset.</strong><br />${esc(err.message)}<br /><br />
      Execute <span class="mono">npm start</span> na raiz do projeto e abra <span class="mono">http://localhost:4173</span>.</div></div>`;
  }
}

boot();
