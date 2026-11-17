/* Perfil da empresa: marca, metas e limites.
 *
 * O arquivo `data/config.json` é gerado pelo importador a partir de
 * `config/empresa.json` (ou usado como padrão no dataset demo). A ausência do
 * arquivo nunca quebra o painel: os valores abaixo são o fallback canônico.
 */
export const DEFAULT_CONFIG = Object.freeze({
  versao: 1,
  empresa: {
    nome: "Grupo Meridian",
    marca: "Meridian BI",
    subtitulo: "Procurement Suite",
    moeda: "BRL",
    locale: "pt-BR",
  },
  metas: {
    otif: 0.9,
    saving: 0.06,
    aderencia: 1,
    coberturaContrato: 0.85,
    cotacoesPorRequisicao: 3,
    hhiCompetitivo: 1500,
    hhiModerado: 2500,
    alertaContratoDias: 90,
    reajusteLimite: 5,
    otifCriticoCategoria: 0.85,
    scoreMinimo: 70,
  },
  limites: {
    linhasUpload: 5000,
    tamanhoUploadMb: 5,
  },
});

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** Mescla o perfil recebido com os padrões, ignorando campos inválidos. */
export function normalizeConfig(raw) {
  if (!raw || typeof raw !== "object") return structuredClone(DEFAULT_CONFIG);
  const emp = raw.empresa && typeof raw.empresa === "object" ? raw.empresa : {};
  const metas = raw.metas && typeof raw.metas === "object" ? raw.metas : {};
  const lim = raw.limites && typeof raw.limites === "object" ? raw.limites : {};
  const str = (v, fallback) => (typeof v === "string" && v.trim() ? v.trim() : fallback);
  const pct = (v, fallback) => {
    const n = num(v, fallback);
    // Aceita 90 (percentual) ou 0,9 (fração), sempre normalizando para fração.
    return n > 1 && n <= 100 ? n / 100 : n;
  };
  return {
    versao: num(raw.versao, 1),
    empresa: {
      nome: str(emp.nome, DEFAULT_CONFIG.empresa.nome),
      marca: str(emp.marca, DEFAULT_CONFIG.empresa.marca),
      subtitulo: str(emp.subtitulo, DEFAULT_CONFIG.empresa.subtitulo),
      moeda: str(emp.moeda, DEFAULT_CONFIG.empresa.moeda),
      locale: str(emp.locale, DEFAULT_CONFIG.empresa.locale),
    },
    metas: {
      otif: pct(metas.otif, DEFAULT_CONFIG.metas.otif),
      saving: pct(metas.saving, DEFAULT_CONFIG.metas.saving),
      aderencia: pct(metas.aderencia, DEFAULT_CONFIG.metas.aderencia),
      coberturaContrato: pct(metas.coberturaContrato, DEFAULT_CONFIG.metas.coberturaContrato),
      cotacoesPorRequisicao: num(metas.cotacoesPorRequisicao, DEFAULT_CONFIG.metas.cotacoesPorRequisicao),
      hhiCompetitivo: num(metas.hhiCompetitivo, DEFAULT_CONFIG.metas.hhiCompetitivo),
      hhiModerado: num(metas.hhiModerado, DEFAULT_CONFIG.metas.hhiModerado),
      alertaContratoDias: num(metas.alertaContratoDias, DEFAULT_CONFIG.metas.alertaContratoDias),
      reajusteLimite: num(metas.reajusteLimite, DEFAULT_CONFIG.metas.reajusteLimite),
      otifCriticoCategoria: pct(metas.otifCriticoCategoria, DEFAULT_CONFIG.metas.otifCriticoCategoria),
      scoreMinimo: num(metas.scoreMinimo, DEFAULT_CONFIG.metas.scoreMinimo),
    },
    limites: {
      linhasUpload: num(lim.linhasUpload, DEFAULT_CONFIG.limites.linhasUpload),
      tamanhoUploadMb: num(lim.tamanhoUploadMb, DEFAULT_CONFIG.limites.tamanhoUploadMb),
    },
  };
}

/** Busca o perfil publicado junto ao dataset. Nunca lança. */
export async function loadConfig() {
  try {
    const res = await fetch("../data/config.json", { cache: "no-store" });
    if (!res.ok) return structuredClone(DEFAULT_CONFIG);
    return normalizeConfig(await res.json());
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}
