/* Perfil da empresa: leitura, normalização e publicação do data/config.json. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, normalizeConfig } from "../../app/js/config.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const EXAMPLE_PATH = path.join(ROOT, "config", "empresa.example.json");
export const CONFIG_PATH = path.join(ROOT, "config", "empresa.json");

export function lerJSON(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

/** Carrega config/empresa.json (ou o exemplo) e separa perfil de mapeamento. */
export function carregarEmpresa(file = CONFIG_PATH) {
  const chosen = fs.existsSync(file) ? file : EXAMPLE_PATH;
  const raw = lerJSON(chosen);
  const perfil = normalizeConfig(raw);
  return {
    arquivo: chosen,
    exemplo: chosen === EXAMPLE_PATH,
    perfil,
    origem: raw.origem || {},
    rotulos: raw.rotulos || {},
    raw,
  };
}

/** Publica somente o perfil (sem mapeamento) em data/config.json. */
export function publicarConfig(outDir, empresa) {
  const dest = path.join(outDir, "config.json");
  const { empresa: emp, metas, limites } = empresa.perfil;
  fs.writeFileSync(dest, `${JSON.stringify({ versao: 1, empresa: emp, metas, limites }, null, 2)}\n`, "utf8");
  return dest;
}

export { DEFAULT_CONFIG, normalizeConfig };
