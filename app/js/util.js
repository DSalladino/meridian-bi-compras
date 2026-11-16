/* Utilitários de formatação, CSV, estatística e DOM. */

export const PALETTE = {
  mint: "#7fc8a9", lilac: "#a99bd6", blush: "#e89b93", butter: "#e9c46a",
  sky: "#8fb8de", rose: "#e3a6c4", sage: "#a9c48a", peach: "#dfa589",
};
export const SERIES = [
  PALETTE.mint, PALETTE.lilac, PALETTE.blush, PALETTE.butter,
  PALETTE.sky, PALETTE.rose, PALETTE.sage, PALETTE.peach,
];
export const SOFT = {
  mint: "#dcefe6", lilac: "#ede8f8", blush: "#fbe4e1", butter: "#fbf0d5",
  sky: "#e3eef8", rose: "#f9e8f0", sage: "#ecf2e1", peach: "#faebe2",
};

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export const nfBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
export const nfBRL2 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const nfNum = new Intl.NumberFormat("pt-BR");

/** R$ compacto: R$ 1,2 mi */
export function brl(v, compact = true) {
  if (v == null || Number.isNaN(v)) return "—";
  const a = Math.abs(v);
  if (compact) {
    if (a >= 1e9) return `R$ ${(v / 1e9).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} bi`;
    if (a >= 1e6) return `R$ ${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
    if (a >= 1e3) return `R$ ${(v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  }
  return nfBRL.format(v);
}
export function brlFull(v) {
  if (v == null || Number.isNaN(v)) return "—";
  return nfBRL2.format(v);
}
export function num(v, d = 0) {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
}
/** recebe fração (0.081) */
export function pct(v, d = 1) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })}%`;
}
export function signedPct(v, d = 1) {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = v > 0 ? "+" : "";
  return `${s}${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })}%`;
}
export function signedMoney(v) {
  const s = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${s}${brl(Math.abs(v))}`;
}
export function monthLabel(ym, long = false) {
  if (!ym) return "—";
  const [y, m] = ym.split("-").map(Number);
  if (long) return `${MONTHS_PT[m - 1]}/${y}`;
  return `${MONTHS_PT[m - 1]}/${String(y).slice(2)}`;
}
export function dateBR(iso, short = true) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return short ? `${d}/${m}/${String(y).slice(2)}` : `${d}/${m}/${y}`;
}
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export function initials(name) {
  return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}
export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* --------------------------------- CSV ---------------------------------- */
export function parseCSV(text) {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const firstLine = clean.slice(0, clean.indexOf("\n") === -1 ? clean.length : clean.indexOf("\n"));
  const delim = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return { header: [], rows: [] };
  const header = rows[0].map((h) => h.trim());
  return { header, rows: rows.slice(1).filter((r) => r.some((c) => c.trim() !== "")) };
}

/* ------------------------------ estatística ------------------------------ */
export const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
export const avg = (arr, f = (x) => x) => (arr.length ? sum(arr, f) / arr.length : 0);
export function median(arr, f = (x) => x) {
  if (!arr.length) return 0;
  const v = arr.map((x) => Number(f(x)) || 0).sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
export function weightedAvg(rows, valueFn, weightFn) {
  let s = 0, w = 0;
  for (const r of rows) {
    const wt = weightFn(r) || 0;
    s += (valueFn(r) || 0) * wt; w += wt;
  }
  return w ? s / w : 0;
}
export function groupBy(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}
export function topN(map, n, f = (v) => v) {
  return [...map.entries()].sort((a, b) => f(b[1]) - f(a[1])).slice(0, n);
}
export function quantile(arr, q) {
  if (!arr.length) return 0;
  const v = [...arr].sort((a, b) => a - b);
  const pos = (v.length - 1) * q;
  const b = Math.floor(pos), rest = pos - b;
  return v[b + 1] !== undefined ? v[b] + rest * (v[b + 1] - v[b]) : v[b];
}
export function hhi(values) {
  const t = sum(values);
  if (!t) return 0;
  return values.reduce((s, v) => s + (v / t) ** 2, 0) * 10000;
}
export function correlation(pairs) {
  if (pairs.length < 3) return 0;
  const mx = avg(pairs, (p) => p[0]), my = avg(pairs, (p) => p[1]);
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

/* --------------------------------- DOM ---------------------------------- */
export function toast(msg, kind = "") {
  const wrap = document.getElementById("toasts");
  if (!wrap) return;
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transform = "translateY(8px)"; el.style.transition = "all .3s"; }, 3200);
  setTimeout(() => el.remove(), 3700);
}

export function download(filename, blobOrText, mime = "text/plain;charset=utf-8") {
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export function toCSV(header, rows, sep = ";") {
  const escf = (v) => {
    const s = v == null ? "" : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header.map(escf).join(sep), ...rows.map((r) => r.map(escf).join(sep))].join("\n");
}

export function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/* ------------------------------ tooltip SVG ------------------------------ */
let tipEl = null;
function onOver(e) {
  const t = e.target.closest("[data-tip]");
  if (!t) return;
  if (!tipEl) tipEl = document.getElementById("tip");
  tipEl.textContent = t.getAttribute("data-tip");
  tipEl.classList.add("show");
  const r = t.getBoundingClientRect();
  tipEl.style.left = `${r.left + r.width / 2}px`;
  tipEl.style.top = `${r.top - 6}px`;
}
function onMove(e) {
  if (!tipEl || !tipEl.classList.contains("show")) return;
  const r = e.target.closest("[data-tip]")?.getBoundingClientRect();
  if (!r) return;
  tipEl.style.left = `${r.left + r.width / 2}px`;
  tipEl.style.top = `${r.top - 6}px`;
}
function onOut(e) {
  if (!e.target.closest("[data-tip]")) return;
  tipEl?.classList.remove("show");
}
export function bindTooltips(root = document) {
  root.addEventListener("mouseover", onOver);
  root.addEventListener("mousemove", onMove);
  root.addEventListener("mouseout", onOut);
}
