/* Biblioteca de gráficos SVG — sem dependências externas. */
import { brl, num, pct, monthLabel, esc, SERIES, SOFT } from "./util.js";

let uid = 0;
const id = (p) => `${p}${++uid}`;
const fmtAxis = (v) => (Math.abs(v) >= 1000 ? brl(v) : num(v, Math.abs(v) < 10 && v % 1 ? 1 : 0));
const axisLabel = (v) => (/^\d{4}-\d{2}$/.test(String(v)) ? monthLabel(v) : String(v ?? ""));

function niceStep(x) {
  if (!Number.isFinite(x) || x <= 0) return 1;
  const exp = Math.floor(Math.log10(x));
  const f = x / 10 ** exp;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return n * 10 ** exp;
}
function scaleY(max, top, bottom) {
  const step = niceStep(max / 4 || 1);
  const top2 = Math.max(step, Math.ceil(max / step) * step);
  const ticks = [];
  for (let v = 0; v <= top2 + step * 0.01; v += step) ticks.push(v);
  return {
    ticks,
    max: top2,
    y: (v) => bottom - (v / top2) * (bottom - top),
  };
}
function smoothPath(pts) {
  if (!pts.length) return "";
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d;
}
export function legend(items) {
  return `<div class="legend">${items.map((i) => `<span><i style="background:${i.color}"></i>${esc(i.label)}</span>`).join("")}</div>`;
}

/* -------------------------------- linha ---------------------------------- */
export function lineChart({ labels, series, height = 230, yFmt = fmtAxis, area = true, target = null, yMax = null, xLabelEvery = 0 }) {
  const W = 780, H = height;
  const m = { t: 18, r: 16, b: 28, l: 54 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const all = series.flatMap((s) => s.values.filter((v) => Number.isFinite(v)));
  const rawMax = Math.max(yMax || 0, ...all, target ? target.value : 0);
  const sc = scaleY(rawMax, m.t, H - m.b);
  const x = (i) => m.l + (labels.length <= 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
  const every = xLabelEvery || Math.ceil(labels.length / 10);

  let grid = "";
  for (const t of sc.ticks) {
    const y = sc.y(t);
    grid += `<line class="grid-line" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/>`;
    grid += `<text x="${m.l - 9}" y="${y + 3.5}" text-anchor="end">${yFmt(t)}</text>`;
  }

  let paths = "";
  series.forEach((s, si) => {
    const pts = s.values.map((v, i) => (Number.isFinite(v) ? [x(i), sc.y(v)] : null)).filter(Boolean);
    if (!pts.length) return;
    const color = s.color || SERIES[si % SERIES.length];
    if (area && series.length <= 2) {
      const gid = id("g");
      const d = smoothPath(pts);
      paths += `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="${si === 0 ? 0.3 : 0.16}"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
        <path d="${d} L${pts[pts.length - 1][0]},${H - m.b} L${pts[0][0]},${H - m.b} Z" fill="url(#${gid})"/>`;
    }
    paths += `<path d="${smoothPath(pts)}" fill="none" stroke="${color}" stroke-width="${s.dashed ? 1.8 : 2.4}"
      ${s.dashed ? 'stroke-dasharray="5 4"' : ""} stroke-linecap="round" stroke-linejoin="round"/>`;
    if (labels.length <= 14) {
      paths += pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${s.dashed ? 2.6 : 3.4}" fill="#fff" stroke="${color}" stroke-width="2"/>`).join("");
    }
    paths += s.values.map((v, i) => (Number.isFinite(v)
      ? `<circle cx="${x(i)}" cy="${sc.y(v)}" r="11" fill="transparent" data-tip="${esc(s.name)} · ${esc(axisLabel(labels[i]))}\n${yFmt(v)}"/>`
      : "")).join("");
  });

  let tgt = "";
  if (target) {
    const y = sc.y(target.value);
    tgt = `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="#b9a9e2" stroke-width="1.3" stroke-dasharray="4 4"/>
      <text x="${W - m.r}" y="${y - 5}" text-anchor="end" fill="#8b7cb5" font-size="10">${esc(target.label)}</text>`;
  }

  let xlab = "";
  labels.forEach((l, i) => {
    if (i % every !== 0 && i !== labels.length - 1) return;
    xlab += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(axisLabel(l))}</text>`;
  });

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Série temporal">
    ${grid}${tgt}${paths}
    <line class="axis-line" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>
    ${xlab}</svg>${series.length > 1 ? legend(series.map((s, i) => ({ label: s.name, color: s.color || SERIES[i % SERIES.length] }))) : ""}`;
}

/* -------------------------------- colunas -------------------------------- */
export function barChart({ labels, series, height = 230, yFmt = fmtAxis, stacked = false, target = null, colors = SERIES }) {
  const W = 780, H = height;
  const m = { t: 18, r: 16, b: 28, l: 54 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const sums = labels.map((_, i) => series.reduce((s, x) => s + (x.values[i] || 0), 0));
  const maxV = stacked ? Math.max(...sums) : Math.max(...series.flatMap((s) => s.values));
  const sc = scaleY(Math.max(maxV, target ? target.value : 0), m.t, H - m.b);
  const slot = iw / labels.length;
  const groupW = slot * 0.62;
  const bw = stacked ? groupW : groupW / series.length;
  const every = Math.ceil(labels.length / 12);

  let grid = "";
  for (const t of sc.ticks) {
    grid += `<line class="grid-line" x1="${m.l}" x2="${W - m.r}" y1="${sc.y(t)}" y2="${sc.y(t)}"/>`;
    grid += `<text x="${m.l - 9}" y="${sc.y(t) + 3.5}" text-anchor="end">${yFmt(t)}</text>`;
  }
  let bars = "";
  labels.forEach((lab, i) => {
    let acc = 0;
    series.forEach((s, si) => {
      const v = s.values[i] || 0;
      const color = s.color || colors[si % colors.length];
      const x0 = m.l + slot * i + (slot - groupW) / 2 + (stacked ? 0 : si * bw);
      const y0 = stacked ? sc.y(acc + v) : sc.y(v);
      const h = Math.max(0, sc.y(acc) - y0);
      acc += v;
      bars += `<rect x="${x0 + 0.6}" y="${y0}" width="${Math.max(1, bw - 1.2)}" height="${Math.max(0.6, h)}" rx="${Math.min(4, bw / 3)}"
        fill="${color}" data-tip="${esc(s.name)} · ${esc(axisLabel(lab))}\n${yFmt(v)}"/>`;
    });
  });
  let tgt = "";
  if (target) {
    const y = sc.y(target.value);
    tgt = `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="#d0786f" stroke-width="1.2" stroke-dasharray="4 4"/>
      <text x="${W - m.r}" y="${y - 5}" text-anchor="end" fill="#b06a62" font-size="10">${esc(target.label)}</text>`;
  }
  let xlab = "";
  labels.forEach((l, i) => {
    if (i % every !== 0 && i !== labels.length - 1) return;
    xlab += `<text x="${m.l + slot * i + slot / 2}" y="${H - 8}" text-anchor="middle">${esc(axisLabel(l))}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${grid}${bars}${tgt}
    <line class="axis-line" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>${xlab}</svg>
    ${series.length > 1 ? legend(series.map((s, i) => ({ label: s.name, color: s.color || colors[i % colors.length] }))) : ""}`;
}

/* ------------------------------ barras horizon. --------------------------- */
export function hbar({ items, fmt = brl, height = null, labelWidth = 190, showValue = true, color = SERIES[0], extra = null }) {
  const W = 780;
  const rowH = 27;
  const H = height || items.length * rowH + 8;
  const m = { l: labelWidth, r: showValue ? 82 : 16, t: 4 };
  const iw = W - m.l - m.r;
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  let body = "";
  items.forEach((it, i) => {
    const y = m.t + i * rowH;
    const w = Math.max(2, (Math.abs(it.value) / max) * iw);
    const c = it.color || color;
    body += `<text x="${m.l - 10}" y="${y + 13.5}" text-anchor="end" class="label-strong" font-size="11">${esc(it.label.length > 32 ? it.label.slice(0, 30) + "…" : it.label)}</text>
      <rect x="${m.l}" y="${y + 5}" width="${iw}" height="13" rx="6.5" fill="#f6f3f9"/>
      <rect x="${m.l}" y="${y + 5}" width="${w}" height="13" rx="6.5" fill="${c}" opacity="${it.dim ? 0.45 : 0.9}" data-tip="${esc(it.label)}\n${(it.tip || fmt(it.value))}"/>
      ${showValue ? `<text x="${W - 4}" y="${y + 14.5}" text-anchor="end" class="label-strong" font-size="11">${esc(it.display || fmt(it.value))}</text>` : ""}
      ${it.marker != null ? `<line x1="${m.l + (it.marker / max) * iw}" x2="${m.l + (it.marker / max) * iw}" y1="${y + 2}" y2="${y + 21}" stroke="#4a4557" stroke-width="1.4" stroke-dasharray="3 2"/>` : ""}`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${body}</svg>`;
}

/* --------------------------------- donut --------------------------------- */
export function donut({ items, center, size = 240, fmt = brl, thickness = 26 }) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const r = size / 2, cx = r, cy = r;
  const R = r - 6, rIn = R - thickness;
  let a0 = -Math.PI / 2, arcs = "";
  items.forEach((it, i) => {
    const frac = it.value / total;
    const a1 = a0 + frac * Math.PI * 2;
    const large = frac > 0.5 ? 1 : 0;
    const p = (ang, rad) => [cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad];
    const s1 = p(a0, R), e1 = p(a1, R), s2 = p(a1, rIn), e2 = p(a0, rIn);
    const color = it.color || SERIES[i % SERIES.length];
    arcs += `<path d="M${s1[0]},${s1[1]} A${R},${R} 0 ${large} 1 ${e1[0]},${e1[1]} L${s2[0]},${s2[1]} A${rIn},${rIn} 0 ${large} 0 ${e2[0]},${e2[1]} Z"
      fill="${color}" stroke="#fff" stroke-width="1.4" data-tip="${esc(it.label)}\n${fmt(it.value)} · ${pct(frac)}" opacity="${it.dim ? 0.45 : 0.95}"/>`;
    a0 = a1;
  });
  const c1 = center?.value || brl(total), c2 = center?.label || "total";
  return `<svg class="chart" viewBox="0 0 ${size} ${size}" style="max-height:${size}px">
    ${arcs}
    <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="19" font-weight="650" fill="#2f2b3a">${esc(c1)}</text>
    <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="10" fill="#8d8699" letter-spacing=".08em">${esc(String(c2).toUpperCase())}</text>
  </svg>`;
}

/* -------------------------------- dispersão -------------------------------- */
export function scatter({ points, height = 350, xLabel = "", yLabel = "", xFmt = brl, yFmt = (v) => num(v, 0), quadrants = null, yMax = null, xMax = null, logX = false }) {
  const W = 780, H = height;
  const m = { t: 18, r: 20, b: 42, l: 62 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const xMaxV = xMax || Math.max(...xs, 1) * 1.06;
  const yMaxV = yMax || Math.max(...ys, 0.001) * 1.1;
  const X = (v) => m.l + (v / xMaxV) * iw;
  const Y = (v) => m.t + ih - (v / yMaxV) * ih;
  const sc = scaleY(yMaxV, m.t, m.t + ih);

  let grid = "";
  for (const t of sc.ticks) {
    grid += `<line class="grid-line" x1="${m.l}" x2="${W - m.r}" y1="${sc.y(t)}" y2="${sc.y(t)}"/>
      <text x="${m.l - 9}" y="${sc.y(t) + 3.5}" text-anchor="end">${yFmt(t)}</text>`;
  }
  let qd = "";
  if (quadrants) {
    const qx = X(quadrants.x), qy = Y(quadrants.y);
    qd = `<line x1="${qx}" x2="${qx}" y1="${m.t}" y2="${m.t + ih}" stroke="#cfc7dd" stroke-dasharray="4 4"/>
      <line x1="${m.l}" x2="${W - m.r}" y1="${qy}" y2="${qy}" stroke="#cfc7dd" stroke-dasharray="4 4"/>
      <text x="${W - m.r - 4}" y="${m.t + 14}" text-anchor="end" font-size="9.5" fill="#a49cb4">${esc(quadrants.tr || "")}</text>
      <text x="${m.l + 4}" y="${m.t + 14}" font-size="9.5" fill="#a49cb4">${esc(quadrants.tl || "")}</text>
      <text x="${W - m.r - 4}" y="${m.t + ih - 6}" text-anchor="end" font-size="9.5" fill="#a49cb4">${esc(quadrants.br || "")}</text>
      <text x="${m.l + 4}" y="${m.t + ih - 6}" font-size="9.5" fill="#a49cb4">${esc(quadrants.bl || "")}</text>`;
  }
  let dots = "";
  for (const p of points) {
    const r = Math.max(3.5, Math.min(15, p.r || 5));
    dots += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${r}" fill="${p.color || SERIES[1]}" fill-opacity="0.62"
      stroke="${p.color || SERIES[1]}" stroke-width="1.3" data-tip="${esc(p.tip || p.label || "")}"/>`;
    if (p.highlight) {
      dots += `<text x="${X(p.x)}" y="${Y(p.y) - r - 5}" text-anchor="middle" font-size="9.5" fill="#4a4557">${esc(p.label || "")}</text>`;
    }
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">
    ${grid}${qd}${dots}
    <line class="axis-line" x1="${m.l}" x2="${W - m.r}" y1="${m.t + ih}" y2="${m.t + ih}"/>
    <text x="${W - m.r}" y="${H - 10}" text-anchor="end" font-size="10">${esc(xLabel)}</text>
    <text x="${m.l - 46}" y="${m.t + 10}" font-size="10" transform="rotate(-90 ${m.l - 46} ${m.t + 10})" text-anchor="end">${esc(yLabel)}</text>
    <text x="${m.l}" y="${H - 10}" font-size="10">${xFmt(0)}</text>
    <text x="${W - m.r}" y="${H - 24}" text-anchor="end" font-size="10">${xFmt(xMaxV)}</text>
  </svg>`;
}

/* -------------------------------- heatmap -------------------------------- */
export function heatmap({ rows, cols, values, fmt = brl, height = null, max = null, color = "#7fc8a9" }) {
  const W = 780;
  const labelW = 150;
  const rowH = 25;
  const top = 22;
  const H = height || top + rows.length * rowH + 6;
  const cw = (W - labelW - 8) / cols.length;
  const all = values.flat().filter((v) => Number.isFinite(v));
  const mx = max || Math.max(...all, 0.0001);
  let cells = "";
  cols.forEach((c, j) => {
    if (cols.length <= 18 || j % 2 === 0) {
      cells += `<text x="${labelW + cw * j + cw / 2}" y="13" text-anchor="middle" font-size="9.5">${esc(monthLabel(c))}</text>`;
    }
  });
  rows.forEach((rw, i) => {
    const y = top + i * rowH;
    const label = typeof rw === "string" ? rw : rw.label;
    cells += `<text x="${labelW - 9}" y="${y + 15}" text-anchor="end" class="label-strong" font-size="10.5">${esc(label.length > 24 ? label.slice(0, 22) + "…" : label)}</text>`;
    cols.forEach((c, j) => {
      const v = values[i][j];
      const t = Number.isFinite(v) ? Math.min(1, v / mx) : -1;
      const fill = t < 0 ? "#faf8fc" : color;
      const op = t < 0 ? 1 : 0.08 + t * 0.82;
      cells += `<rect x="${labelW + cw * j + 1}" y="${y + 1}" width="${cw - 2}" height="${rowH - 3}" rx="3"
        fill="${fill}" fill-opacity="${op}" data-tip="${esc(label)} · ${esc(monthLabel(c))}\n${v == null ? "sem dados" : fmt(v)}"/>`;
    });
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${cells}</svg>`;
}

/* ---------------------------------- radar --------------------------------- */
export function radar({ axes, series, size = 260 }) {
  const cx = size / 2, cy = size / 2, R = size / 2 - 34;
  const n = axes.length;
  const pt = (i, v) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v];
  };
  let rings = "";
  [0.25, 0.5, 0.75, 1].forEach((k) => {
    const p = axes.map((_, i) => pt(i, k));
    rings += `<polygon points="${p.map((q) => q.join(",")).join(" ")}" fill="none" stroke="#eee9f4" stroke-width="1"/>`;
  });
  let spokes = "";
  axes.forEach((ax, i) => {
    const [x, y] = pt(i, 1);
    spokes += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#eee9f4"/>
      <text x="${cx + Math.cos(-Math.PI / 2 + (i / n) * Math.PI * 2) * (R + 15)}"
            y="${cy + Math.sin(-Math.PI / 2 + (i / n) * Math.PI * 2) * (R + 15) + 3}"
            text-anchor="middle" font-size="9.5" fill="#7d7689">${esc(ax)}</text>`;
  });
  let polys = "";
  series.forEach((s, si) => {
    const color = s.color || SERIES[si % SERIES.length];
    const pts = s.values.map((v, i) => pt(i, Math.max(0, Math.min(1, v))));
    polys += `<polygon points="${pts.map((q) => q.join(",")).join(" ")}" fill="${color}" fill-opacity="0.26" stroke="${color}" stroke-width="2"/>
      ${pts.map((q, i) => `<circle cx="${q[0]}" cy="${q[1]}" r="3.4" fill="#fff" stroke="${color}" stroke-width="1.8"
        data-tip="${esc(s.name)} · ${esc(axes[i])}\n${pct(s.values[i])}"/>`).join("")}`;
  });
  return `<svg class="chart" viewBox="0 0 ${size} ${size}" style="max-height:${size}px">${rings}${spokes}${polys}</svg>`;
}

/* --------------------------------- gauge ---------------------------------- */
export function gauge({ value, max = 1, label = "", sub = "", color = "#7fc8a9", size = 200 }) {
  const cx = size / 2, cy = size / 2 + 12, R = size / 2 - 18;
  const t = Math.max(0, Math.min(1, value / max));
  const a0 = Math.PI, a1 = Math.PI + t * Math.PI;
  const p = (a) => [cx + Math.cos(a) * R, cy + Math.sin(a) * R];
  const [sx, sy] = p(a0), [ex, ey] = p(a1);
  const large = t > 0.5 ? 1 : 0;
  return `<svg class="chart" viewBox="0 0 ${size} ${size * 0.68}" style="max-height:${size * 0.72}px">
    <path d="M${sx},${sy} A${R},${R} 0 0 1 ${cx + R},${cy}" fill="none" stroke="#f1edf6" stroke-width="13" stroke-linecap="round"/>
    <path d="M${sx},${sy} A${R},${R} 0 ${large} 1 ${ex},${ey}" fill="none" stroke="${color}" stroke-width="13" stroke-linecap="round"/>
    <text x="${cx}" y="${cy - 14}" text-anchor="middle" font-size="22" font-weight="650" fill="#2f2b3a">${esc(label)}</text>
    <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="9.5" fill="#8d8699">${esc(sub)}</text>
  </svg>`;
}

/* ------------------------------- sparkline -------------------------------- */
export function sparkline(values, color = SERIES[0], w = 92, h = 26) {
  const mn = Math.min(...values), mx = Math.max(...values);
  const pts = values.map((v, i) => [
    (i / Math.max(1, values.length - 1)) * w,
    h - 2 - ((v - mn) / (mx - mn || 1)) * (h - 4),
  ]);
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" style="width:${w}px;height:${h}px">
    <path d="${smoothPath(pts)}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/></svg>`;
}

/* ------------------------- barras divergentes (variação) ------------------- */
export function divergingBars({ items, fmt = (v) => `${(v * 100).toFixed(1)}%`, height = 250 }) {
  const W = 780, H = height;
  const m = { t: 12, r: 60, b: 10, l: 230 };
  const rowH = Math.min(30, (H - m.t - m.b) / Math.max(1, items.length));
  const iw = W - m.l - m.r;
  const mx = Math.max(...items.map((i) => Math.abs(i.value)), 0.01);
  const zero = m.l + iw / 2;
  let out = `<line x1="${zero}" x2="${zero}" y1="${m.t}" y2="${H - m.b}" stroke="#e5dfee"/>`;
  items.forEach((it, i) => {
    const y = m.t + i * rowH;
    const w = (Math.abs(it.value) / mx) * (iw / 2 - 6);
    const pos = it.value >= 0;
    const c = it.color || (pos ? "#e89b93" : "#7fc8a9");
    out += `<text x="${m.l - 10}" y="${y + rowH / 2 + 4}" text-anchor="end" class="label-strong" font-size="10.5">${esc(it.label.length > 30 ? it.label.slice(0, 28) + "…" : it.label)}</text>
      <rect x="${pos ? zero : zero - w}" y="${y + rowH / 2 - 6}" width="${Math.max(2, w)}" height="12" rx="4" fill="${c}" fill-opacity="0.85"
        data-tip="${esc(it.label)}\n${fmt(it.value)}"/>
      <text x="${pos ? zero + w + 8 : zero - w - 8}" y="${y + rowH / 2 + 4}" text-anchor="${pos ? "start" : "end"}" font-size="10.5" fill="#4a4557">${fmt(it.value)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${out}</svg>`;
}

export { SOFT };
