#!/usr/bin/env python3
"""
Geração do dataset sintético do Grupo Meridian (Compras & Fornecedores).

- Dados fictícios, porém realistas: sazonalidade, inflação por categoria,
  concentração de fornecedores, atrasos, defeitos e economia de negociação.
- Determinístico (seed fixa), reprodutível e compatível com o modelo estrela
  definido em sql/01_ddl.sql.
- Saída: CSVs com separador ';' em ../data (ou --out).

Uso:
    python etl/generate_data.py --out data
"""
from __future__ import annotations

import argparse
import csv
import math
import random
from datetime import date, timedelta
from pathlib import Path

SEED = 20261116
RNG = random.Random(SEED)
HOJE = date(2026, 10, 31)
INICIO = date(2024, 1, 1)

UNIDADES = [
    ("U1", "Meridian Industrial", "Campinas", "SP", "Indústria"),
    ("U2", "Meridian Logística", "Cajamar", "SP", "Centro de Distribuição"),
    ("U3", "Meridian Retail", "Curitiba", "PR", "Varejo"),
]

COMPRADORES = [
    ("C1", "Ana Beatriz Ferraz", "U1", "Matéria-prima Metálica"),
    ("C2", "Rafael Nogueira", "U1", "Componentes Eletrônicos"),
    ("C3", "Juliana Prado", "U1", "Insumos Químicos"),
    ("C4", "Marcos Vinícius Teles", "U2", "Serviços de Logística"),
    ("C5", "Carla Menezes", "U1", "Manutenção e MRO"),
    ("C6", "Eduardo Kimura", "U3", "TI e Software"),
    ("C7", "Patrícia Lemos", "U3", "Embalagens"),
    ("C8", "Bruno Salgado", "U3", "Materiais de Escritório"),
]

# id, nome, grupo, criticidade, peso, drift mensal, lead time base, natureza
CATEGORIAS = [
    ("K1", "Matéria-prima Metálica", "Produção", "Alta", 27, 0.0055, 18, "Custo direto"),
    ("K2", "Componentes Eletrônicos", "Produção", "Alta", 17, 0.0038, 22, "Custo direto"),
    ("K3", "Embalagens", "Produção", "Média", 9, 0.0028, 10, "Custo direto"),
    ("K4", "Insumos Químicos", "Produção", "Alta", 12, 0.0045, 14, "Custo direto"),
    ("K5", "Serviços de Logística", "Serviços", "Alta", 16, 0.0050, 7, "Despesa operacional"),
    ("K6", "Manutenção e MRO", "Serviços", "Média", 8, 0.0032, 9, "Despesa operacional"),
    ("K7", "TI e Software", "Tecnologia", "Média", 9, 0.0018, 15, "Despesa administrativa"),
    ("K8", "Materiais de Escritório", "Administrativo", "Baixa", 2, 0.0026, 5, "Despesa administrativa"),
]

ITENS = [
    ("K1", "Chapa de aço carbono 1,2 mm", "kg", 6.85, "Alta"),
    ("K1", "Bobina de aço galvanizado", "kg", 8.40, "Alta"),
    ("K1", "Perfil metálico U 100x50", "m", 24.90, "Média"),
    ("K1", 'Tubo de aço redondo 2"', "m", 38.70, "Média"),
    ("K1", "Alumínio em barra 6063", "kg", 21.60, "Média"),
    ("K2", "Sensor óptico indutivo", "un", 148.00, "Alta"),
    ("K2", "Placa controladora CLP", "un", 1240.00, "Alta"),
    ("K2", "Cabo industrial blindado 4x1,5", "m", 12.40, "Média"),
    ("K2", "Módulo I/O remoto", "un", 685.00, "Média"),
    ("K2", "Fonte chaveada 24V 10A", "un", 236.00, "Baixa"),
    ("K3", "Caixa papelão ondulado 40x30x30", "un", 3.15, "Média"),
    ("K3", "Filme stretch 500 mm", "kg", 14.70, "Baixa"),
    ("K3", "Pallet PBR 1,2x1,0", "un", 56.00, "Média"),
    ("K3", "Etiqueta térmica 100x150", "milheiro", 89.00, "Baixa"),
    ("K4", "Solvente industrial", "L", 22.40, "Alta"),
    ("K4", "Resina epóxi bicomponente", "kg", 34.80, "Alta"),
    ("K4", "Soda cáustica 98%", "kg", 5.60, "Alta"),
    ("K4", "Óleo lubrificante industrial", "L", 29.50, "Média"),
    ("K5", "Frete rodoviário dedicado", "viagem", 1250.00, "Alta"),
    ("K5", "Armazenagem em CD", "palete/mês", 46.00, "Média"),
    ("K5", "Distribuição last mile", "entrega", 38.50, "Média"),
    ("K5", "Locação de empilhadeira", "mês", 3400.00, "Alta"),
    ("K6", "Rolamento industrial 6205", "un", 74.00, "Média"),
    ("K6", "Correia dentada HTD", "un", 39.00, "Baixa"),
    ("K6", "Manutenção preventiva de linha", "h", 180.00, "Alta"),
    ("K6", "Luva de proteção mecânica", "par", 9.60, "Baixa"),
    ("K6", "Kit hidráulico de vedação", "kit", 128.00, "Média"),
    ("K7", 'Notebook corporativo 14"', "un", 5200.00, "Média"),
    ("K7", "Licença Microsoft 365 E3", "usuário/mês", 92.00, "Média"),
    ("K7", "Suporte técnico N2", "h", 210.00, "Alta"),
    ("K7", "Backup em nuvem", "TB/mês", 340.00, "Média"),
    ("K7", "Switch 48 portas gerenciável", "un", 7800.00, "Alta"),
    ("K8", "Resma papel A4 75g", "un", 27.50, "Baixa"),
    ("K8", "Toner laser preto", "un", 310.00, "Baixa"),
    ("K8", "Café torrado e moído 1 kg", "kg", 42.00, "Baixa"),
]

NOMES = {
    "K1": ["Aço Vale", "Metalúrgica Andrade", "Ferro Norte", "Siderúrgica Bandeirante",
           "Metais Campinas", "Aliança Aços", "Ferrotec", "Sul Metais",
           "Metalúrgica Horizonte", "Aço Forte", "Vetor Metais", "Sidera Brasil",
           "Ipê Metais", "Metal Service Paraná", "Centro Aço Distribuidora"],
    "K2": ["TechParts Importadora", "AutomaSul", "Electro Minas", "Sensores Brasil",
           "Nexus Automação", "Delta Componentes", "Instrutech", "Power Drive",
           "Atlas Eletrônica", "MicroControl", "Servotron", "Lumen Devices",
           "Alpha Sensores", "Conecta Industrial"],
    "K3": ["Embalagens Bioma", "Cartonagem Paulista", "EcoPack", "Papel & Forma",
           "Caixas do Sul", "Verde Embalagens", "Master Pack", "Onda Certa",
           "PlastFlex", "Embalatec", "Nova Caixa", "Recicla Pack"],
    "K4": ["Química Paulista", "Resinor", "Solventes União", "Brasquímica", "Quimisa",
           "Elemento Química", "Petroquímica Sul", "LabChem", "Insumos Andrade",
           "Croma Química", "Química Vital", "Prisma Insumos"],
    "K5": ["LogPrime Transportes", "Rodo Sul Cargas", "TransBrasil Logística",
           "Operador Logístico Atlas", "Via Rápida Distribuição", "Carga Certa",
           "Movimenta", "Logística Meridional", "Prime Frete", "Rota Azul",
           "Expresso Guarani", "InterLog"],
    "K6": ["Manutenção Industrial Premier", "MRO Brasil", "Rolamentos Sul",
           "Tecno Manutenção", "Peças & Cia", "Fixação Industrial", "Hidráulica Norte",
           "Multi MRO", "Oficina Técnica Alfa", "ProMaint",
           "Suprimentos Industriais BR", "Vedação Total"],
    "K7": ["TI Corporativa Nexus", "Softline Brasil", "DataCore Soluções", "CloudBridge",
           "InfraTech", "Alfa Sistemas", "Notebooks & Cia", "Security IT",
           "Redes Sul", "ByteStore", "Sistema Prime", "Digital Works"],
    "K8": ["OfficeSupplies Brasil", "Papelaria Central", "Suprimentos Escritório PR",
           "Casa do Papel", "Grafite Distribuidora", "Office Prime", "Papel & Cia",
           "Suprimentos Curitiba", "Toner Express", "Escritório Total"],
}
SUFIXOS = ["Ltda", "S.A.", "Indústria e Comércio", "Distribuidora", "Comércio Ltda", "Industrial"]
UFS = ["SP"] * 4 + ["MG", "PR", "PR", "SC", "RS", "RJ", "BA", "PE", "CE", "GO", "ES"]
PORTES = ["EPP", "EPP", "Médio", "Médio", "Grande", "Grande", "MEI"]
STATUS_FORNECEDOR = ["Ativo"] * 7 + ["Em homologação", "Suspenso", "Inativo"]
ALVOS = {"K1": 27000, "K2": 19000, "K3": 9500, "K4": 15500, "K5": 31000, "K6": 11000, "K7": 34000, "K8": 4200}
MODALIDADES = ["Catálogo", "Catálogo", "Contrato", "Contrato", "Contrato", "Emergencial"]


def d(dt: date | str) -> str:
    return dt.isoformat() if isinstance(dt, date) else dt


def add_days(dt: date, days: int) -> date:
    return dt + timedelta(days=days)


def brl(v: float) -> float:
    return round(v, 2)


def build_suppliers():
    fornecedores = []
    for (cid, categoria, *_rest) in CATEGORIAS:
        base_names = NOMES[cid]
        qtd = RNG.randint(14, 18)
        for i in range(qtd):
            nome = f"{base_names[i % len(base_names)]}"
            if i >= len(base_names):
                nome += f" Filial {i // len(base_names) + 1}"
            nome += " " + RNG.choice(SUFIXOS)
            rating = max(52, min(98, round(80 + 9 * RNG.gauss(0, 1) - (18 if RNG.random() < 0.12 else 0))))
            status = RNG.choices(STATUS_FORNECEDOR, k=1)[0]
            fornecedores.append({
                "id": f"F{len(fornecedores) + 1:03d}",
                "nome": nome,
                "categoria": cid,
                "uf": RNG.choice(UFS),
                "porte": RNG.choice(PORTES),
                "status": status,
                "homolog": d(add_days(date(2021, 3, 1), RNG.randint(0, 1900))),
                "pgto": RNG.choice([30, 30, 30, 45, 45, 60, 60, 90]),
                "iso": "Sim" if RNG.random() < 0.58 else "Não",
                "rating": rating,
                "risco": "Baixo" if rating >= 85 else "Médio" if rating >= 70 else "Alto",
                "lead": max(2, round(next(c[6] for c in CATEGORIAS if c[0] == cid) * RNG.uniform(0.75, 1.35))),
                "comp": min(1.16, max(0.86, 1 + 0.07 * RNG.gauss(0, 1))),
                "desconto": min(0.14, max(-0.04, 0.055 + 0.05 * RNG.gauss(0, 1) + (rating - 80) / 800)),
            })
    return fornecedores


def write_csv(path: Path, header, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh, delimiter=";", quoting=csv.QUOTE_MINIMAL)
        writer.writerow(header)
        writer.writerows(rows)
    print(f"{path.name:<26} {len(rows)} linhas")


def main(out: Path):
    itens = [{"id": f"I{i + 1:03d}", "cat": c, "desc": desc, "um": um, "base": preco, "crit": crit}
             for i, (c, desc, um, preco, crit) in enumerate(ITENS)]
    fornecedores = build_suppliers()
    por_cat = {c[0]: [f for f in fornecedores if f["categoria"] == c[0]] for c in CATEGORIAS}

    months = []
    y, m = INICIO.year, INICIO.month
    while (y, m) <= (2026, 10):
        months.append((y, m))
        m += 1
        if m == 13:
            m, y = 1, y + 1

    pedidos, cotacoes, contratos = [], [], []
    po_seq = 0

    for idx, (ano, mes) in enumerate(months):
        crescimento = 1 + 0.0035 * idx
        sazonal = 1.11 if mes >= 10 else 0.93 if mes == 1 else 0.96 if mes == 7 else 1
        n_req = round(84 * crescimento * sazonal * RNG.uniform(0.9, 1.1))
        for i in range(n_req):
            cat = RNG.choices(CATEGORIAS, weights=[c[4] for c in CATEGORIAS], k=1)[0]
            cid, drift, lead_base = cat[0], cat[5], cat[6]
            item = RNG.choice([x for x in itens if x["cat"] == cid])
            pool = [f for f in por_cat[cid] if f["status"] != "Inativo"]
            escolhidos, n_cot = [], RNG.choice([3, 3, 3, 4, 4, 5])
            while len(escolhidos) < n_cot:
                f = RNG.choice(pool)
                if f not in escolhidos:
                    escolhidos.append(f)
            dia = RNG.randint(1, 27)
            data = date(ano, mes, dia)
            ref = brl(item["base"] * (1 + drift) ** idx * RNG.uniform(0.97, 1.03))
            qtd = max(1, round(ALVOS[cid] / ref * RNG.uniform(0.35, 2.1)))
            req = f"REQ-{ano}{mes:02d}{i + 1:03d}"

            propostas = []
            for f in escolhidos:
                fator = f["comp"] * RNG.uniform(0.97, 1.04) * (1 - max(0, f["desconto"]) * 0.35)
                preco = max(item["base"] * 0.55, brl(ref * fator))
                frete = brl(qtd * preco * (0 if cid == "K5" else RNG.uniform(0, 0.035)))
                total = brl(qtd * preco + frete)
                propostas.append({
                    "fornecedor": f, "preco": preco, "frete": frete, "total": total,
                    "prazo": max(2, round(f["lead"] * RNG.uniform(0.85, 1.2))),
                    "pgto": f["pgto"],
                })
            melhor = min(propostas, key=lambda p: p["total"])
            ganhadora = melhor
            if RNG.random() < 0.12:  # decisão por qualidade/relacionamento
                alternativas = sorted((p for p in propostas if p is not melhor),
                                      key=lambda p: p["fornecedor"]["rating"], reverse=True)
                if alternativas:
                    ganhadora = alternativas[0]

            for p in propostas:
                cotacoes.append([req, d(data), item["id"], cid, p["fornecedor"]["id"], qtd,
                                 p["preco"], p["frete"], p["total"], p["prazo"], p["pgto"],
                                 1 if p is ganhadora else 0, ref])

            po_seq += 1
            id_po = f"PO-{ano}-{po_seq:05d}"
            modal = RNG.choice(MODALIDADES)
            tem_contrato = 1 if modal == "Contrato" or (modal == "Catálogo" and RNG.random() < 0.35) else 0
            prevista = add_days(data, ganhadora["prazo"] + RNG.randint(0, 4))
            idade = (HOJE - data).days
            st = RNG.random()
            if modal == "Emergencial" and st < 0.06:
                status = "Cancelado"
            elif idade < 32:
                status = "Atrasado" if st < 0.28 else "Em trânsito"
            elif idade < 62 and st < 0.16:
                status = "Parcial"
            elif st < 0.02:
                status = "Atrasado"
            else:
                status = "Entregue"

            real, atraso, recebido, defeito = None, 0, 0, 0
            if status in ("Entregue", "Parcial", "Atrasado"):
                p_atraso = 0.12 + (0.11 if ganhadora["fornecedor"]["rating"] < 72 else 0) + (0.06 if cid == "K5" else 0)
                atraso = max(1, round(RNG.uniform(1, 4) + ganhadora["prazo"] * RNG.uniform(0.05, 0.3))) if RNG.random() < p_atraso else 0
                real = add_days(prevista, atraso)
                if real > HOJE:
                    real = HOJE
                    atraso = max(0, (real - prevista).days)
                recebido = round(qtd * RNG.uniform(0.55, 0.9)) if status == "Parcial" else qtd
                defeito = max(1, round(qtd * RNG.uniform(0.005, 0.03))) if RNG.random() < 0.028 + (0.05 if ganhadora["fornecedor"]["rating"] < 72 else 0) else 0
            # Definição única: prazo + completude + qualidade.
            otif = 1 if (status == "Entregue" and atraso == 0
                         and recebido >= qtd and defeito == 0) else 0
            nota = min(5, max(1, round(4.3 + 0.5 * RNG.gauss(0, 1) - (0.6 if atraso > 5 else 0) - (0.7 if defeito else 0), 1)))
            pedidos.append([
                id_po, req, d(data), f"{ano}-{mes:02d}", ganhadora["fornecedor"]["id"], item["id"], cid,
                next(k for k in COMPRADORES if k[3] == cat[1])[0], RNG.choice(UNIDADES)[0], qtd,
                ganhadora["preco"], ganhadora["frete"], ganhadora["total"], ref,
                brl(qtd * (ref - ganhadora["preco"])), modal, tem_contrato, d(prevista),
                d(real) if real else "", atraso, recebido, defeito, status, otif, nota,
            ])

    for (cid, *_rest) in CATEGORIAS:
        pool = [f for f in por_cat[cid] if f["status"] == "Ativo" and f["rating"] > 74][:5]
        for f in pool:
            # Carteira realista na data de referência: vigentes, a vencer em
            # até 90 dias e encerrados com histórico.
            cenario = RNG.random()
            if cenario < 0.2:
                fim = add_days(HOJE, RNG.randint(15, 89))
            elif cenario < 0.55:
                fim = add_days(HOJE, RNG.randint(120, 700))
            else:
                fim = add_days(HOJE, -RNG.randint(30, 500))
            inicio = add_days(fim, -RNG.randint(365, 730))
            contratos.append([
                f"CT-{inicio.year}-{len(contratos) + 1:03d}", f["id"], cid, d(inicio), d(fim),
                brl(RNG.uniform(420000, 4200000)), round(RNG.uniform(2.8, 8.4), 2),
                RNG.choice(["IPCA", "IGP-M", "IPCA", "INCC"]),
                "Encerrado" if fim < HOJE else "Vigente",
            ])

    # orçamento mensal por categoria/unidade derivado do realizado
    agregado: dict[tuple, float] = {}
    for p in pedidos:
        if p[22] == "Cancelado":
            continue
        chave = (p[3], p[6], p[8])
        agregado[chave] = agregado.get(chave, 0) + p[12]
    orcamento = []
    for (mes_ref, cid, uid), valor in agregado.items():
        fator = min(1.13, max(0.90, 1 + 0.055 * RNG.gauss(0, 1)))
        orcamento.append([mes_ref, cid, uid, brl(valor * fator), brl(valor * RNG.uniform(1.01, 1.09))])

    precos = []
    for item in itens:
        drift = next(c[5] for c in CATEGORIAS if c[0] == item["cat"])
        anterior = item["base"]
        for i, (ano, mes) in enumerate(months):
            indice = (1 + drift) ** i * (1 + 0.004 * RNG.gauss(0, 1))
            preco = brl(item["base"] * indice * RNG.uniform(0.985, 1.015))
            precos.append([f"{ano}-{mes:02d}", item["id"], item["cat"], item["desc"], preco,
                           round(indice, 4), 0 if i == 0 else round((preco / anterior - 1) * 100, 2)])
            anterior = preco

    write_csv(out / "dim_unidades.csv", ["id_unidade", "unidade", "cidade", "uf", "tipo"], UNIDADES)
    write_csv(out / "dim_compradores.csv", ["id_comprador", "comprador", "id_unidade", "categoria_responsavel"], COMPRADORES)
    write_csv(out / "dim_categorias.csv",
              ["id_categoria", "categoria", "grupo", "criticidade", "peso_spend", "drift_mensal", "lead_time_base_dias", "natureza"],
              CATEGORIAS)
    write_csv(out / "dim_itens.csv",
              ["id_item", "descricao", "id_categoria", "unidade_medida", "preco_referencia", "criticidade"],
              [[i["id"], i["desc"], i["cat"], i["um"], i["base"], i["crit"]] for i in itens])
    write_csv(out / "dim_fornecedores.csv",
              ["id_fornecedor", "razao_social", "id_categoria", "uf", "porte", "status", "data_homologacao",
               "prazo_pagamento_dias", "iso9001", "rating_cadastral", "risco", "lead_time_medio_dias"],
              [[f["id"], f["nome"], f["categoria"], f["uf"], f["porte"], f["status"], f["homolog"],
                f["pgto"], f["iso"], f["rating"], f["risco"], f["lead"]] for f in fornecedores])
    write_csv(out / "fato_cotacoes.csv",
              ["id_requisicao", "data_cotacao", "id_item", "id_categoria", "id_fornecedor", "quantidade",
               "preco_unitario", "frete", "valor_total", "prazo_entrega_dias", "prazo_pagamento_dias",
               "selecionada", "preco_referencia"], cotacoes)
    write_csv(out / "fato_pedidos.csv",
              ["id_pedido", "id_requisicao", "data_emissao", "mes_ref", "id_fornecedor", "id_item",
               "id_categoria", "id_comprador", "id_unidade", "quantidade", "valor_unitario", "frete",
               "valor_total", "preco_referencia", "saving_valor", "modalidade", "tem_contrato",
               "data_entrega_prevista", "data_entrega_real", "atraso_dias", "qtd_recebida",
               "qtd_defeito", "status", "otif", "nota_qualidade"], pedidos)
    write_csv(out / "fato_precos.csv",
              ["mes_ref", "id_item", "id_categoria", "descricao_item", "preco_medio", "indice_categoria",
               "variacao_mm_pct"], precos)
    write_csv(out / "fato_orcamento.csv", ["mes_ref", "id_categoria", "id_unidade", "orcamento", "forecast"], orcamento)
    write_csv(out / "dim_contratos.csv",
              ["id_contrato", "id_fornecedor", "id_categoria", "data_inicio", "data_fim", "valor_anual",
               "reajuste_pct", "indice_reajuste", "status"], contratos)

    spend = sum(p[12] for p in pedidos if p[22] != "Cancelado")
    saving = sum(p[14] for p in pedidos if p[22] != "Cancelado")
    print(f"\nSpend total   R$ {spend / 1e6:.2f} mi")
    print(f"Savings total R$ {saving / 1e6:.2f} mi ({saving / spend * 100:.1f}%)")
    print(f"Pedidos {len(pedidos)} | Cotações {len(cotacoes)} | Fornecedores {len(fornecedores)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Gera o dataset sintético do Meridian BI")
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "data")
    args = parser.parse_args()
    main(args.out)
