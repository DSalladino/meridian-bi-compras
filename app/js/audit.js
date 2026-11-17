/* Auditoria de exportações do navegador.
 *
 * O Excel/PDF/CSV é gerado localmente, mas o servidor de produção registra
 * quem exportou, o tipo e os filtros ativos — sem bloquear o download caso a
 * API esteja indisponível.
 */
import { store } from "./data.js";

export function registrarExportacao(tipo, ctx) {
  if (!store.api) return;
  const filtros = ctx?.filters || {};
  const detalhe = {
    tipo,
    periodo: { de: ctx?.bounds?.from || "", ate: ctx?.bounds?.to || "" },
    unidade: String(filtros.unidade || "").slice(0, 80),
    categoria: String(filtros.categoria || "").slice(0, 80),
    comprador: String(filtros.comprador || "").slice(0, 80),
    fornecedor: String(filtros.fornecedor || "").slice(0, 80),
    status: String(filtros.status || "").slice(0, 40),
  };
  const body = JSON.stringify(detalhe);
  try {
    fetch("../api/audit/export", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
      body,
      keepalive: true,
    }).catch(() => { /* auditoria é best-effort */ });
  } catch {
    /* ambiente sem fetch/keepalive */
  }
}
