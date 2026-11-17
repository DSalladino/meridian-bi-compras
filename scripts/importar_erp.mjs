#!/usr/bin/env node
/**
 * Importa exportações reais do ERP para o contrato canônico do Meridian BI.
 *
 * Uso:
 *   node scripts/importar_erp.mjs --novo
 *   node scripts/importar_erp.mjs --config config/empresa.json --origem ./erp --saida data_empresa
 *   node scripts/importar_erp.mjs --simular --origem ./erp
 *
 * O diretório de saída fica pronto para:
 *   python etl/pipeline_etl.py --data-dir data_empresa --dsn "$DATABASE_URL"
 *   # ou, para o painel estático local:
 *   node scripts/importar_erp.mjs --saida data --forcar
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { carregarEmpresa, publicarConfig, EXAMPLE_PATH, CONFIG_PATH, ROOT } from "./lib/empresa.mjs";
import { importarEmpresa, validateDataset, writeDataset, TABLES } from "./lib/erp.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};

if (flag("ajuda") || flag("help")) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].replace(/^#!.*\n/, "").replace("/**", "").trim());
  process.exit(0);
}

if (flag("novo")) {
  if (fs.existsSync(CONFIG_PATH)) {
    console.log(`  ${path.relative(ROOT, CONFIG_PATH)} já existe — edite-o em vez de sobrescrever.`);
  } else {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.copyFileSync(EXAMPLE_PATH, CONFIG_PATH);
    console.log(`  criado ${path.relative(ROOT, CONFIG_PATH)}`);
  }
  console.log(`
  Próximos passos:
  1. Edite "empresa" e "metas" (metas em fração: 0,9 = 90%).
  2. Ajuste "origem.tabelas.*.colunas" para os nomes de coluna do seu ERP.
  3. Coloque os arquivos em ./erp (ou use --origem /caminho).
  4. Rode: node scripts/importar_erp.mjs --origem ./erp --saida data_empresa
  5. Confira o relatório e carregue no PostgreSQL com o pipeline Python.
`);
  process.exit(0);
}

const configPath = value("config", CONFIG_PATH);
const empresa = carregarEmpresa(configPath);
if (empresa.exemplo) {
  console.warn("  ! config/empresa.json não encontrado; usando config/empresa.example.json");
}

const sourceDir = path.resolve(ROOT, value("origem", empresa.origem.diretorio || "erp"));
const outDir = path.resolve(ROOT, value("saida", "data_empresa"));
const simular = flag("simular");
const forcar = flag("forcar");

if (!fs.existsSync(sourceDir)) {
  console.error(`\n  ✗ diretório de origem não encontrado: ${sourceDir}`);
  console.error("    Crie ./erp ou aponte com --origem /caminho/da/exportacao\n");
  process.exit(2);
}
if (outDir === path.join(ROOT, "data") && !forcar) {
  console.error("\n  ✗ --saida data sobrescreve o dataset demo. Use outro diretório ou --forcar.\n");
  process.exit(2);
}
if (!simular && fs.existsSync(outDir) && fs.readdirSync(outDir).length && !forcar) {
  console.error(`\n  ✗ ${path.relative(ROOT, outDir)} já contém arquivos. Use --forcar para substituir.\n`);
  process.exit(2);
}

const report = { tabelas: {}, erros: [], avisos: [] };
const started = Date.now();
console.log("\n  Meridian BI · importação de ERP");
console.log(`  origem   ${sourceDir}`);
console.log(`  saída    ${simular ? "(simulação — nada será gravado)" : outDir}`);
console.log(`  perfil   ${empresa.perfil.empresa.nome}\n`);

const { dims, facts, loaded } = importarEmpresa({
  config: empresa.raw,
  sourceDir,
  rotulos: empresa.rotulos,
  report,
});

const validation = validateDataset(dims, facts);
report.erros.push(...validation.errors);
report.avisos.push(...validation.warnings);
report.rows = Object.fromEntries(Object.entries({ ...dims, ...facts }).map(([k, v]) => [k, v.length]));
report.resumo = {
  arquivosLidos: [...loaded],
  fornecedores: dims.dim_fornecedores.length,
  itens: dims.dim_itens.length,
  categorias: dims.dim_categorias.length,
  pedidos: facts.fato_pedidos.length,
  propostas: facts.fato_cotacoes.length,
  contratos: dims.dim_contratos.length,
  meses: [...new Set(facts.fato_pedidos.map((p) => p.mes_ref))].sort(),
};

console.log("  Tabelas");
for (const [name, info] of Object.entries(report.tabelas)) {
  console.log(`    ${name.padEnd(20)} ${String(info.linhas).padStart(7)}  ${info.arquivo}`);
}
const missing = Object.keys(TABLES).filter((n) => !loaded.has(n) && n !== "fato_pedidos");
if (missing.length) console.log(`    derivadas/vazias    ${missing.length}  ${missing.join(", ")}`);

const meses = report.resumo.meses;
console.log("\n  Resumo");
console.log(`    pedidos            ${report.resumo.pedidos}`);
console.log(`    propostas          ${report.resumo.propostas}`);
console.log(`    fornecedores       ${report.resumo.fornecedores}`);
console.log(`    itens / categorias ${report.resumo.itens} / ${report.resumo.categorias}`);
console.log(`    contratos          ${report.resumo.contratos}`);
console.log(`    período            ${meses[0] || "—"} → ${meses[meses.length - 1] || "—"}`);

if (report.avisos.length) {
  console.log(`\n  Avisos (${report.avisos.length})`);
  for (const a of report.avisos.slice(0, 20)) console.log(`    ! ${a}`);
  if (report.avisos.length > 20) console.log(`    ! +${report.avisos.length - 20} avisos — veja o relatório JSON.`);
}
if (report.erros.length) {
  console.log(`\n  Erros bloqueantes (${report.erros.length})`);
  for (const e of report.erros.slice(0, 30)) console.log(`    ✗ ${e}`);
  if (report.erros.length > 30) console.log(`    ✗ +${report.erros.length - 30} erros — veja o relatório JSON.`);
}

if (!simular) {
  writeDataset(outDir, dims, facts);
  publicarConfig(outDir, empresa);
  const reportPath = path.join(outDir, "relatorio_importacao.json");
  fs.writeFileSync(reportPath, `${JSON.stringify({
    geradoEm: new Date().toISOString(),
    duracaoMs: Date.now() - started,
    origem: sourceDir,
    config: empresa.arquivo,
    resumo: report.resumo,
    tabelas: report.tabelas,
    erros: report.erros,
    avisos: report.avisos,
  }, null, 2)}\n`, "utf8");
  console.log(`\n  Dataset gravado em ${path.relative(ROOT, outDir)}`);
  console.log(`  Relatório: ${path.relative(ROOT, reportPath)}\n`);
  console.log("  Próximo passo:");
  console.log(`    python etl/pipeline_etl.py --data-dir ${path.relative(ROOT, outDir) || "."} --dsn "$DATABASE_URL"`);
  console.log(`    # ou painel demo: node scripts/importar_erp.mjs --saida data --forcar\n`);
}

process.exit(report.erros.length ? 1 : 0);
