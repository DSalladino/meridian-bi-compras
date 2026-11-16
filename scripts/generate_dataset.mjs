import fs from 'node:fs';

/* ------------------------------------------------------------------ */
/* Gerador de dataset sintético — Grupo Meridian (Compras & Fornecedores) */
/* Espelha a especificação de etl/generate_data.py                     */
/* ------------------------------------------------------------------ */

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261116);
const r = () => rnd();
const pick = (a) => a[Math.floor(r() * a.length)];
const rand = (a, b) => a + r() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const norm = () => {
  let u = 0, v = 0;
  while (!u) u = r();
  while (!v) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const escf = (v) => {
  const t = v == null ? "" : String(v);
  return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
};
const csv = (rows) => rows.map((r) => r.map(escf).join(';')).join('\n') + '\n';
const write = (name, header, rows) => {
  fs.writeFileSync(`data/${name}`, csv([header, ...rows]));
  console.log(`${name.padEnd(26)} ${rows.length} linhas`);
};

/* ------------------------------ dimensões ------------------------------ */
const unidades = [
  ['U1', 'Meridian Industrial', 'Campinas', 'SP', 'Indústria'],
  ['U2', 'Meridian Logística', 'Cajamar', 'SP', 'Centro de Distribuição'],
  ['U3', 'Meridian Retail', 'Curitiba', 'PR', 'Varejo'],
];

const compradores = [
  ['C1', 'Ana Beatriz Ferraz', 'U1', 'Matéria-prima Metálica'],
  ['C2', 'Rafael Nogueira', 'U1', 'Componentes Eletrônicos'],
  ['C3', 'Juliana Prado', 'U1', 'Insumos Químicos'],
  ['C4', 'Marcos Vinícius Teles', 'U2', 'Serviços de Logística'],
  ['C5', 'Carla Menezes', 'U1', 'Manutenção e MRO'],
  ['C6', 'Eduardo Kimura', 'U3', 'TI e Software'],
  ['C7', 'Patrícia Lemos', 'U3', 'Embalagens'],
  ['C8', 'Bruno Salgado', 'U3', 'Materiais de Escritório'],
];

const categorias = [
  ['K1', 'Matéria-prima Metálica', 'Produção', 'Alta', 27, 0.0055, 18, 'Custo direto'],
  ['K2', 'Componentes Eletrônicos', 'Produção', 'Alta', 17, 0.0038, 22, 'Custo direto'],
  ['K3', 'Embalagens', 'Produção', 'Média', 9, 0.0028, 10, 'Custo direto'],
  ['K4', 'Insumos Químicos', 'Produção', 'Alta', 12, 0.0045, 14, 'Custo direto'],
  ['K5', 'Serviços de Logística', 'Serviços', 'Alta', 16, 0.0050, 7, 'Despesa operacional'],
  ['K6', 'Manutenção e MRO', 'Serviços', 'Média', 8, 0.0032, 9, 'Despesa operacional'],
  ['K7', 'TI e Software', 'Tecnologia', 'Média', 9, 0.0018, 15, 'Despesa administrativa'],
  ['K8', 'Materiais de Escritório', 'Administrativo', 'Baixa', 2, 0.0026, 5, 'Despesa administrativa'],
];

const itens = [
  ['K1', 'Chapa de aço carbono 1,2 mm', 'kg', 6.85, 'Alta'],
  ['K1', 'Bobina de aço galvanizado', 'kg', 8.4, 'Alta'],
  ['K1', 'Perfil metálico U 100x50', 'm', 24.9, 'Média'],
  ['K1', 'Tubo de aço redondo 2"', 'm', 38.7, 'Média'],
  ['K1', 'Alumínio em barra 6063', 'kg', 21.6, 'Média'],
  ['K2', 'Sensor óptico indutivo', 'un', 148, 'Alta'],
  ['K2', 'Placa controladora CLP', 'un', 1240, 'Alta'],
  ['K2', 'Cabo industrial blindado 4x1,5', 'm', 12.4, 'Média'],
  ['K2', 'Módulo I/O remoto', 'un', 685, 'Média'],
  ['K2', 'Fonte chaveada 24V 10A', 'un', 236, 'Baixa'],
  ['K3', 'Caixa papelão ondulado 40x30x30', 'un', 3.15, 'Média'],
  ['K3', 'Filme stretch 500 mm', 'kg', 14.7, 'Baixa'],
  ['K3', 'Pallet PBR 1,2x1,0', 'un', 56, 'Média'],
  ['K3', 'Etiqueta térmica 100x150', 'milheiro', 89, 'Baixa'],
  ['K4', 'Solvente industrial', 'L', 22.4, 'Alta'],
  ['K4', 'Resina epóxi bicomponente', 'kg', 34.8, 'Alta'],
  ['K4', 'Soda cáustica 98%', 'kg', 5.6, 'Alta'],
  ['K4', 'Óleo lubrificante industrial', 'L', 29.5, 'Média'],
  ['K5', 'Frete rodoviário dedicado', 'viagem', 1250, 'Alta'],
  ['K5', 'Armazenagem em CD', 'palete/mês', 46, 'Média'],
  ['K5', 'Distribuição last mile', 'entrega', 38.5, 'Média'],
  ['K5', 'Locação de empilhadeira', 'mês', 3400, 'Alta'],
  ['K6', 'Rolamento industrial 6205', 'un', 74, 'Média'],
  ['K6', 'Correia dentada HTD', 'un', 39, 'Baixa'],
  ['K6', 'Manutenção preventiva de linha', 'h', 180, 'Alta'],
  ['K6', 'Luva de proteção mecânica', 'par', 9.6, 'Baixa'],
  ['K6', 'Kit hidráulico de vedação', 'kit', 128, 'Média'],
  ['K7', 'Notebook corporativo 14"', 'un', 5200, 'Média'],
  ['K7', 'Licença Microsoft 365 E3', 'usuário/mês', 92, 'Média'],
  ['K7', 'Suporte técnico N2', 'h', 210, 'Alta'],
  ['K7', 'Backup em nuvem', 'TB/mês', 340, 'Média'],
  ['K7', 'Switch 48 portas gerenciável', 'un', 7800, 'Alta'],
  ['K8', 'Resma papel A4 75g', 'un', 27.5, 'Baixa'],
  ['K8', 'Toner laser preto', 'un', 310, 'Baixa'],
  ['K8', 'Café torrado e moído 1 kg', 'kg', 42, 'Baixa'],
].map((x, i) => ({ id: `I${String(i + 1).padStart(3, '0')}`, cat: x[0], desc: x[1], um: x[2], base: x[3], crit: x[4] }));

const nomesBase = {
  K1: ['Aço Vale', 'Metalúrgica Andrade', 'Ferro Norte', 'Siderúrgica Bandeirante', 'Metais Campinas', 'Aliança Aços', 'Ferrotec', 'Sul Metais', 'Metalúrgica Horizonte', 'Aço Forte', 'Vetor Metais', 'Sidera Brasil', 'Ipê Metais', 'Metal Service Paraná', 'Centro Aço Distribuidora'],
  K2: ['TechParts Importadora', 'AutomaSul', 'Electro Minas', 'Sensores Brasil', 'Nexus Automação', 'Delta Componentes', 'Instrutech', 'Power Drive', 'Atlas Eletrônica', 'MicroControl', 'Servotron', 'Lumen Devices', 'Alpha Sensores', 'Conecta Industrial'],
  K3: ['Embalagens Bioma', 'Cartonagem Paulista', 'EcoPack', 'Papel & Forma', 'Caixas do Sul', 'Verde Embalagens', 'Master Pack', 'Onda Certa', 'PlastFlex', 'Embalatec', 'Nova Caixa', 'Recicla Pack'],
  K4: ['Química Paulista', 'Resinor', 'Solventes União', 'Brasquímica', 'Quimisa', 'Elemento Química', 'Petroquímica Sul', 'LabChem', 'Insumos Andrade', 'Croma Química', 'Química Vital', 'Prisma Insumos'],
  K5: ['LogPrime Transportes', 'Rodo Sul Cargas', 'TransBrasil Logística', 'Operador Logístico Atlas', 'Via Rápida Distribuição', 'Carga Certa', 'Movimenta', 'Logística Meridional', 'Prime Frete', 'Rota Azul', 'Expresso Guarani', 'InterLog'],
  K6: ['Manutenção Industrial Premier', 'MRO Brasil', 'Rolamentos Sul', 'Tecno Manutenção', 'Peças & Cia', 'Fixação Industrial', 'Hidráulica Norte', 'Multi MRO', 'Oficina Técnica Alfa', 'ProMaint', 'Suprimentos Industriais BR', 'Vedação Total'],
  K7: ['TI Corporativa Nexus', 'Softline Brasil', 'DataCore Soluções', 'CloudBridge', 'InfraTech', 'Alfa Sistemas', 'Notebooks & Cia', 'Security IT', 'Redes Sul', 'ByteStore', 'Sistema Prime', 'Digital Works'],
  K8: ['OfficeSupplies Brasil', 'Papelaria Central', 'Suprimentos Escritório PR', 'Casa do Papel', 'Grafite Distribuidora', 'Office Prime', 'Papel & Cia', 'Suprimentos Curitiba', 'Toner Express', 'Escritório Total'],
};
const sufixos = ['Ltda', 'S.A.', 'Indústria e Comércio', 'Distribuidora', 'Comércio Ltda', 'Industrial'];
const ufs = ['SP', 'SP', 'SP', 'SP', 'MG', 'PR', 'PR', 'SC', 'RS', 'RJ', 'BA', 'PE', 'CE', 'GO', 'ES'];
const portes = ['EPP', 'EPP', 'Médio', 'Médio', 'Grande', 'Grande', 'MEI'];

const fornecedores = [];
const seq = {};
for (const c of categorias) {
  const nomes = nomesBase[c[0]];
  const n = randInt(14, 18);
  for (let i = 0; i < n; i++) {
    const nome = `${nomes[i % nomes.length]}${i >= nomes.length ? ' Filial ' + (Math.floor(i / nomes.length) + 1) : ''} ${pick(sufixos)}`;
    const cat = c[0];
    seq[cat] = (seq[cat] || 0) + 1;
    const rating = Math.min(98, Math.max(52, Math.round(80 + 9 * norm() - (r() < 0.12 ? 18 : 0))));
    const ativo = r();
    const status = ativo > 0.94 ? 'Inativo' : ativo > 0.90 ? 'Suspenso' : ativo > 0.86 ? 'Em homologação' : 'Ativo';
    const comp = Math.min(1.16, Math.max(0.86, 1 + 0.07 * norm()));
    fornecedores.push({
      id: `F${String(fornecedores.length + 1).padStart(3, '0')}`,
      nome,
      cat,
      uf: pick(ufs),
      porte: pick(portes),
      status,
      homolog: iso(addDays(new Date('2021-03-01'), randInt(0, 1900))),
      pgto: pick([30, 30, 30, 45, 45, 60, 60, 90]),
      iso9001: r() < 0.58 ? 'Sim' : 'Não',
      rating,
      comp,
      lead: Math.max(2, Math.round(c[6] * rand(0.75, 1.35))),
      risco: rating >= 85 ? 'Baixo' : rating >= 70 ? 'Médio' : 'Alto',
      desconto: Math.min(0.14, Math.max(-0.04, 0.055 + 0.05 * norm() + (rating - 80) / 800)),
    });
  }
}

/* --------------------------- pedidos e cotações --------------------------- */
const months = [];
for (let y = 2024, m = 0; y < 2027; m++) {
  if (y === 2026 && m > 9) break;
  months.push([y, m]);
  if (m === 11) { y++; m = -1; }
}
const catWeighted = categorias.flatMap((c) => Array(c[4]).fill(c[0]));
const byCat = {};
for (const f of fornecedores) (byCat[f.cat] ||= []).push(f);

const pedidos = [];
const cotacoes = [];
const contratos = [];
let poSeq = 0;
const modalidades = ['Catálogo', 'Catálogo', 'Contrato', 'Contrato', 'Contrato', 'Emergencial'];

for (const [y, m] of months) {
  const growth = 1 + 0.0035 * (months.findIndex((x) => x[0] === y && x[1] === m));
  const seasonal = m >= 9 ? 1.11 : m === 0 ? 0.93 : m === 6 ? 0.96 : 1;
  const nReq = Math.round(84 * growth * seasonal * rand(0.9, 1.1));
  for (let i = 0; i < nReq; i++) {
    const catId = pick(catWeighted);
    const cat = categorias.find((c) => c[0] === catId);
    const mitens = itens.filter((it) => it.cat === catId);
    const item = pick(mitens);
    const fornecedoresCat = byCat[catId].filter((f) => f.status !== 'Inativo');
    const pool = [];
    const used = new Set();
    const nCot = pick([3, 3, 3, 4, 4, 5]);
    while (pool.length < nCot) {
      const f = pick(fornecedoresCat);
      if (used.has(f.id)) continue;
      used.add(f.id); pool.push(f);
    }
    const day = randInt(1, 27);
    const date = new Date(Date.UTC(y, m, day));
    const midx = months.findIndex((x) => x[0] === y && x[1] === m);
    const infl = (1 + cat[5]) ** midx;
    const refPrice = round(item.base * infl * rand(0.97, 1.03));
    const alvo = { K1: 27000, K2: 19000, K3: 9500, K4: 15500, K5: 31000, K6: 11000, K7: 34000, K8: 4200 }[catId];
    const qty = Math.max(1, Math.round((alvo / refPrice) * rand(0.35, 2.1)));
    const req = `REQ-${y}${String(m + 1).padStart(2, '0')}${String(i + 1).padStart(3, '0')}`;

    let best = null;
    const quotes = pool.map((f) => {
      const fator = f.comp * rand(0.97, 1.04) * (1 - Math.max(0, f.desconto) * 0.35);
      const preco = Math.max(item.base * 0.55, round(refPrice * fator, 2));
      const frete = round(qty * preco * (catId === 'K5' ? 0 : rand(0, 0.035)), 2);
      const total = round(qty * preco + frete, 2);
      const q = {
        req, date, item, cat, f, preco, frete, total, qty,
        prazo: Math.max(2, Math.round(f.lead * rand(0.85, 1.2))),
        pgto: f.pgto,
      };
      if (!best || q.total < best.total) best = q;
      return q;
    });
    // 12% das decisões não escolhem o menor preço (qualidade / relacionamento)
    let win = best;
    if (r() < 0.12) {
      const alts = quotes.filter((q) => q !== best).sort((a, b) => b.f.rating - a.f.rating);
      win = alts[0] || best;
    }
    cotacoes.push(...quotes.map((q) => ({
      req, date, item, cat, f: q.f, preco: q.preco, qty, prazo: q.prazo, pgto: q.pgto,
      frete: q.frete, total: q.total, win: q === win, ref: refPrice,
    })));

    poSeq++;
    const idPo = `PO-${y}-${String(poSeq).padStart(5, '0')}`;
    const modal = pick(modalidades);
    const temContrato = modal === 'Contrato' || (modal === 'Catálogo' && r() < 0.35);
    const prev = addDays(date, win.prazo + randInt(0, 4));
    const ageDays = Math.round((Date.UTC(2026, 9, 31) - date) / 86400000);
    let status, real = null, atraso = 0, receb = 0, defeito = 0;
    const st = r();
    if (modal === 'Emergencial' && st < 0.06) {
      status = 'Cancelado';
    } else if (ageDays < 32) {
      status = st < 0.28 ? 'Atrasado' : 'Em trânsito';
    } else if (ageDays < 62 && st < 0.16) {
      status = 'Parcial';
    } else if (st < 0.02) {
      status = 'Atrasado';
    } else {
      status = 'Entregue';
    }
    const HOJE = new Date(Date.UTC(2026, 9, 31));
    if (status === 'Entregue' || status === 'Parcial' || status === 'Atrasado') {
      const pAtraso = 0.12 + (win.f.rating < 72 ? 0.11 : 0) + (catId === 'K5' ? 0.06 : 0);
      let atrasoReal = r() < pAtraso ? Math.max(1, Math.round(rand(1, 4) + win.prazo * rand(0.05, 0.3))) : 0;
      real = addDays(prev, atrasoReal);
      if (real > HOJE) { real = HOJE; atrasoReal = Math.max(0, Math.round((real - prev) / 86400000)); }
      atraso = atrasoReal;
      receb = status === 'Parcial' ? Math.round(qty * rand(0.55, 0.9)) : qty;
      defeito = r() < 0.028 + (win.f.rating < 72 ? 0.05 : 0) ? Math.max(1, Math.round(qty * rand(0.005, 0.03))) : 0;
    }
    // Definição única: prazo + completude + qualidade.
    const otif = status === 'Entregue' && atraso === 0 && receb >= qty && defeito === 0 ? 1 : 0;
    const valorTotal = win.total;
    const saving = round(qty * (refPrice - win.preco), 2);
    pedidos.push({
      id: idPo, req, data: iso(date), mes: `${y}-${String(m + 1).padStart(2, '0')}`,
      f: win.f, item, cat, comprador: pick(compradores.filter((c) => c[3] === cat[1])),
      unidade: pick(unidades),
      qty, preco: win.preco, frete: win.frete, valor: valorTotal, ref: refPrice, saving,
      modal, temContrato, prev: iso(prev), real: real ? iso(real) : '', atraso,
      receb, defeito, status, otif, nota: Math.min(5, Math.max(1, round(4.3 + 0.5 * norm() - (atraso > 5 ? 0.6 : 0) - (defeito > 0 ? 0.7 : 0), 1))),
    });
  }
}

/* ------------------------------- contratos ------------------------------- */
const ASOF_CONTRATOS = new Date(Date.UTC(2026, 9, 31));
for (const cat of categorias) {
  const pool = byCat[cat[0]].filter((f) => f.status === 'Ativo' && f.rating > 74).slice(0, 5);
  for (const f of pool) {
    // Garante uma carteira realista na data de referência: vigentes, a vencer
    // em até 90 dias e encerrados com histórico. Antes, quase todos venciam
    // antes do início dos fatos e o realizado contratual ficava irreal.
    const cenario = r();
    let fim;
    if (cenario < 0.2) fim = addDays(ASOF_CONTRATOS, randInt(15, 89));
    else if (cenario < 0.55) fim = addDays(ASOF_CONTRATOS, randInt(120, 700));
    else fim = addDays(ASOF_CONTRATOS, -randInt(30, 500));
    const ini = addDays(fim, -randInt(365, 730));
    contratos.push([
      `CT-${ini.getUTCFullYear()}-${String(contratos.length + 1).padStart(3, '0')}`,
      f.id, cat[0], iso(ini), iso(fim), round(rand(420000, 4200000), 2),
      round(rand(2.8, 8.4), 2), pick(['IPCA', 'IGP-M', 'IPCA', 'INCC']),
      fim < ASOF_CONTRATOS ? 'Encerrado' : 'Vigente',
    ]);
  }
}

/* -------------------------- orçamento por categoria ------------------------ */
const agg = {};
for (const p of pedidos) {
  if (p.status === 'Cancelado') continue;
  const k = `${p.mes}|${p.cat[0]}|${p.unidade[0]}`;
  agg[k] = (agg[k] || 0) + p.valor;
}
const orcamento = [];
for (const [k, v] of Object.entries(agg)) {
  const [mes, catId, uni] = k.split('|');
  const f = Math.min(1.13, Math.max(0.9, 1 + 0.055 * norm()));
  orcamento.push([mes, catId, uni, round(v * f, 2), round(v * (1 + rand(0.01, 0.09)), 2)]);
}

/* ------------------------------ série de preços ---------------------------- */
const precos = [];
for (const item of itens) {
  const cat = categorias.find((c) => c[0] === item.cat);
  let prev = item.base;
  months.forEach(([y, m], idx) => {
    const idxCat = round((1 + cat[5]) ** idx * (1 + 0.004 * norm()), 4);
    const preco = round(item.base * idxCat * rand(0.985, 1.015), 2);
    precos.push([`${y}-${String(m + 1).padStart(2, '0')}`, item.id, item.cat, item.desc, preco, idxCat,
      idx === 0 ? 0 : round((preco / prev - 1) * 100, 2)]);
    prev = preco;
  });
}

/* --------------------------------- escrita -------------------------------- */
write('dim_unidades.csv', ['id_unidade', 'unidade', 'cidade', 'uf', 'tipo'], unidades);
write('dim_compradores.csv', ['id_comprador', 'comprador', 'id_unidade', 'categoria_responsavel'], compradores);
write('dim_categorias.csv', ['id_categoria', 'categoria', 'grupo', 'criticidade', 'peso_spend', 'drift_mensal', 'lead_time_base_dias', 'natureza'], categorias);
write('dim_itens.csv', ['id_item', 'descricao', 'id_categoria', 'unidade_medida', 'preco_referencia', 'criticidade'], itens.map((i) => [i.id, i.desc, i.cat, i.um, i.base, i.crit]));
write('dim_fornecedores.csv', ['id_fornecedor', 'razao_social', 'id_categoria', 'uf', 'porte', 'status', 'data_homologacao', 'prazo_pagamento_dias', 'iso9001', 'rating_cadastral', 'risco', 'lead_time_medio_dias'], fornecedores.map((f) => [f.id, f.nome, f.cat, f.uf, f.porte, f.status, f.homolog, f.pgto, f.iso9001, f.rating, f.risco, f.lead]));
write('fato_cotacoes.csv', ['id_requisicao', 'data_cotacao', 'id_item', 'id_categoria', 'id_fornecedor', 'quantidade', 'preco_unitario', 'frete', 'valor_total', 'prazo_entrega_dias', 'prazo_pagamento_dias', 'selecionada', 'preco_referencia'], cotacoes.map((q) => [q.req, iso(q.date), q.item.id, q.cat[0], q.f.id, q.qty, q.preco, q.frete, q.total, q.prazo, q.pgto, q.win ? 1 : 0, q.ref]));
write('fato_pedidos.csv', ['id_pedido', 'id_requisicao', 'data_emissao', 'mes_ref', 'id_fornecedor', 'id_item', 'id_categoria', 'id_comprador', 'id_unidade', 'quantidade', 'valor_unitario', 'frete', 'valor_total', 'preco_referencia', 'saving_valor', 'modalidade', 'tem_contrato', 'data_entrega_prevista', 'data_entrega_real', 'atraso_dias', 'qtd_recebida', 'qtd_defeito', 'status', 'otif', 'nota_qualidade'], pedidos.map((p) => [p.id, p.req, p.data, p.mes, p.f.id, p.item.id, p.cat[0], p.comprador[0], p.unidade[0], p.qty, p.preco, p.frete, p.valor, p.ref, p.saving, p.modal, p.temContrato ? 1 : 0, p.prev, p.real, p.atraso, p.receb, p.defeito, p.status, p.otif, p.nota]));
write('fato_precos.csv', ['mes_ref', 'id_item', 'id_categoria', 'descricao_item', 'preco_medio', 'indice_categoria', 'variacao_mm_pct'], precos);
write('fato_orcamento.csv', ['mes_ref', 'id_categoria', 'id_unidade', 'orcamento', 'forecast'], orcamento);
write('dim_contratos.csv', ['id_contrato', 'id_fornecedor', 'id_categoria', 'data_inicio', 'data_fim', 'valor_anual', 'reajuste_pct', 'indice_reajuste', 'status'], contratos);

const spend = pedidos.filter((p) => p.status !== 'Cancelado').reduce((s, p) => s + p.valor, 0);
const sav = pedidos.filter((p) => p.status !== 'Cancelado').reduce((s, p) => s + p.saving, 0);
console.log('\nSpend total   R$', (spend / 1e6).toFixed(2), 'M');
console.log('Savings total R$', (sav / 1e6).toFixed(2), 'M |', ((sav / spend) * 100).toFixed(1), '%');
console.log('Pedidos', pedidos.length, '| Cotações', cotacoes.length, '| Fornecedores', fornecedores.length);
console.log('OTIF', ((pedidos.filter((p) => p.otif).length / pedidos.filter((p) => p.status === 'Entregue').length) * 100).toFixed(1), '%');
