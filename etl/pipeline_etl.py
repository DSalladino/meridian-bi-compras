#!/usr/bin/env python3
"""
Pipeline ETL do Meridian BI — da camada raw (CSV) à camada gold (PostgreSQL).

Etapas:
  1. EXTRACT   lê os CSVs versionados em /data
  2. VALIDATE  aplica regras de qualidade (schema, chaves, domínios, regras de negócio)
  3. TRANSFORM deriva colunas, normaliza tipos e deduplica
  4. LOAD      staging temporário + validação + swap atômico (TRUNCATE sem CASCADE + INSERT)
  5. REPORT    grava um relatório de qualidade em JSON e imprime o resumo

Uso:
    python etl/pipeline_etl.py --validate-only
    python etl/pipeline_etl.py --dsn "postgresql://postgres:postgres@localhost:5432/meridian"
    python etl/pipeline_etl.py --dsn "$DATABASE_URL" --report-dir etl/out

Dependências: pandas, psycopg2-binary (ver etl/requirements.txt)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"

# Ordem de carga respeitando as FKs
TABLES = [
    ("dim_unidade", "dim_unidades.csv", "id_unidade"),
    ("dim_comprador", "dim_compradores.csv", "id_comprador"),
    ("dim_categoria", "dim_categorias.csv", "id_categoria"),
    ("dim_item", "dim_itens.csv", "id_item"),
    ("dim_fornecedor", "dim_fornecedores.csv", "id_fornecedor"),
    ("dim_contrato", "dim_contratos.csv", "id_contrato"),
    ("fato_pedido", "fato_pedidos.csv", "id_pedido"),
    ("fato_cotacao", "fato_cotacoes.csv", None),
    ("fato_preco", "fato_precos.csv", None),
    ("fato_orcamento", "fato_orcamento.csv", None),
]

DATE_COLS = ["data_emissao", "data_entrega_prevista", "data_entrega_real", "data_cotacao",
             "data_homologacao", "data_inicio", "data_fim"]
NUM_COLS = ["quantidade", "valor_unitario", "frete", "valor_total", "preco_referencia",
            "saving_valor", "atraso_dias", "qtd_recebida", "qtd_defeito", "otif", "nota_qualidade",
            "preco_unitario", "prazo_entrega_dias", "prazo_pagamento_dias", "selecionada",
            "preco_medio", "indice_categoria", "variacao_mm_pct", "orcamento", "forecast",
            "peso_spend", "drift_mensal", "lead_time_base_dias", "rating_cadastral",
            "lead_time_medio_dias", "valor_anual", "reajuste_pct"]

STATUS_PEDIDO = {"Entregue", "Em trânsito", "Parcial", "Atrasado", "Cancelado"}


@dataclass
class Report:
    started_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    checks: list[dict] = field(default_factory=list)
    rows: dict[str, int] = field(default_factory=dict)

    def add(self, table: str, rule: str, passed: bool, detail: str = "", severity: str = "error"):
        self.checks.append({
            "table": table, "rule": rule, "severity": severity,
            "passed": bool(passed), "detail": detail,
        })
        return passed

    @property
    def errors(self):
        return [c for c in self.checks if not c["passed"] and c["severity"] == "error"]

    @property
    def warnings(self):
        return [c for c in self.checks if not c["passed"] and c["severity"] == "warning"]

    def to_dict(self):
        return {
            "started_at": self.started_at,
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "rows": self.rows,
            "summary": {
                "checks": len(self.checks),
                "passed": sum(1 for c in self.checks if c["passed"]),
                "errors": len(self.errors),
                "warnings": len(self.warnings),
            },
            "checks": self.checks,
        }


def extract(data_dir: Path) -> dict[str, pd.DataFrame]:
    frames: dict[str, pd.DataFrame] = {}
    for table, filename, _ in TABLES:
        path = data_dir / filename
        if not path.exists():
            raise FileNotFoundError(f"CSV não encontrado: {path}")
        df = pd.read_csv(path, sep=";", dtype=str, keep_default_na=False, na_values=[""])
        for col in df.columns:
            if col in NUM_COLS:
                df[col] = pd.to_numeric(df[col], errors="coerce")
            elif col in DATE_COLS:
                df[col] = pd.to_datetime(df[col], errors="coerce", format="mixed")
        frames[table] = df
    return frames


def validate(frames: dict[str, pd.DataFrame], rep: Report) -> None:
    for table, _, pk in TABLES:
        df = frames[table]
        rep.rows[table] = len(df)
        rep.add(table, "não vazio", len(df) > 0, f"{len(df)} linhas")
        if pk:
            dup = int(df[pk].duplicated().sum())
            rep.add(table, "chave primária única", dup == 0, f"{dup} duplicidades em {pk}")

    # Integridade referencial
    fk_map = {
        "fato_pedido": [("id_fornecedor", "dim_fornecedor"), ("id_item", "dim_item"),
                        ("id_categoria", "dim_categoria"), ("id_comprador", "dim_comprador"),
                        ("id_unidade", "dim_unidade")],
        "fato_cotacao": [("id_fornecedor", "dim_fornecedor"), ("id_item", "dim_item"),
                         ("id_categoria", "dim_categoria")],
        "fato_preco": [("id_item", "dim_item"), ("id_categoria", "dim_categoria")],
        "fato_orcamento": [("id_categoria", "dim_categoria"), ("id_unidade", "dim_unidade")],
        "dim_fornecedor": [("id_categoria", "dim_categoria")],
        "dim_item": [("id_categoria", "dim_categoria")],
        "dim_contrato": [("id_fornecedor", "dim_fornecedor"), ("id_categoria", "dim_categoria")],
        "dim_comprador": [("id_unidade", "dim_unidade")],
    }
    for table, rels in fk_map.items():
        for col, ref in rels:
            orfaos = int((~frames[table][col].isin(frames[ref].iloc[:, 0])).sum())
            rep.add(table, f"FK {col} → {ref}", orfaos == 0, f"{orfaos} órfãos")

    ped = frames["fato_pedido"]

    # Domínios
    invalidos = int((~ped["status"].isin(STATUS_PEDIDO)).sum())
    rep.add("fato_pedido", "domínio de status", invalidos == 0, f"{invalidos} inválidos")
    rep.add("fato_pedido", "OTIF binário", ped["otif"].isin([0, 1]).all(), "")
    rep.add("fato_pedido", "datas de emissão válidas", ped["data_emissao"].notna().all(), "")
    mes_calc = ped["data_emissao"].dt.strftime("%Y-%m")
    mes_inconsistente = int((ped["mes_ref"].astype(str) != mes_calc).sum())
    rep.add("fato_pedido", "mes_ref coerente com data_emissao", mes_inconsistente == 0,
            f"{mes_inconsistente} competências divergentes")
    rep.add("fato_pedido", "entrega ≥ emissão",
            bool((ped["data_entrega_real"].isna() | (ped["data_entrega_real"] >= ped["data_emissao"])).all()), "")
    rep.add("fato_pedido", "valores positivos", bool((ped[["quantidade", "valor_unitario", "valor_total"]] > 0).all().all()), "")

    # Regras de negócio
    rep.add("fato_pedido", "quantidade recebida ≤ pedida",
            bool((ped["qtd_recebida"] <= ped["quantidade"] * 1.05).all()), "")
    rep.add("fato_pedido", "defeitos ≤ recebido",
            bool((ped["qtd_defeito"] <= ped["qtd_recebida"]).all()), "")
    esperado_saving = (ped["preco_referencia"] - ped["valor_unitario"]) * ped["quantidade"]
    divergencia = (ped["saving_valor"] - esperado_saving).abs()
    rep.add("fato_pedido", "saving consistente com o baseline", bool((divergencia <= 1).all()),
            f"{int((divergencia > 1).sum())} divergências > R$ 1")
    acima_ref = int((ped["saving_valor"] < 0).sum())
    rep.add("fato_pedido", "compras acima da referência", acima_ref / max(1, len(ped)) < 0.2,
            f"{acima_ref} pedidos ({acima_ref / max(1, len(ped)) * 100:.1f}%) — savings negativo", severity="warning")

    otif_esperado = ((ped["status"] == "Entregue") & (ped["atraso_dias"] == 0)
                     & (ped["qtd_recebida"] >= ped["quantidade"])
                     & (ped["qtd_defeito"] == 0))
    otif_inconsistente = int((otif_esperado != (ped["otif"] == 1)).sum())
    rep.add("fato_pedido", "OTIF coerente com prazo, completude e qualidade", otif_inconsistente == 0,
            f"{otif_inconsistente} divergências", severity="warning")
    parciais_com_otif = int(((ped["qtd_recebida"] < ped["quantidade"]) & (ped["otif"] == 1)).sum())
    rep.add("fato_pedido", "entrega parcial nunca é OTIF", parciais_com_otif == 0,
            f"{parciais_com_otif} entregas parciais marcadas como OTIF")

    cot = frames["fato_cotacao"]
    selecionadas = cot.groupby("id_requisicao")["selecionada"].sum()
    rep.add("fato_cotacao", "1 proposta selecionada por requisição",
            bool(selecionadas.eq(1).all()),
            f"{int((selecionadas != 1).sum())} requisições fora da regra")
    rep.add("fato_cotacao", "referência presente", bool((cot["preco_referencia"] > 0).all()), "")

    # Cobertura do orçamento
    chaves_orc = set(map(tuple, frames["fato_orcamento"][["mes_ref", "id_categoria", "id_unidade"]].values))
    chaves_ped = set(map(tuple, ped[["mes_ref", "id_categoria", "id_unidade"]].drop_duplicates().values))
    sem_orcamento = len(chaves_ped - chaves_orc)
    rep.add("fato_orcamento", "cobertura de todas as combinações mês/categoria/unidade",
            sem_orcamento == 0, f"{sem_orcamento} combinações sem orçamento", severity="warning")

    # Atualidade e volume
    rep.add("fato_pedido", "competência atual", ped["mes_ref"].max() >= "2026-10",
            f"máximo {ped['mes_ref'].max()}", severity="warning")
    rep.add("fato_pedido", "volume mínimo de pedidos", len(ped) >= 1000, f"{len(ped)} pedidos")

    # Duplicidade de propostas por requisição/fornecedor
    dup_cot = int(cot.duplicated(subset=["id_requisicao", "id_fornecedor", "id_item"]).sum())
    rep.add("fato_cotacao", "sem propostas duplicadas", dup_cot == 0, f"{dup_cot} duplicidades")


def transform(frames: dict[str, pd.DataFrame]) -> dict[str, pd.DataFrame]:
    out = {k: v.copy() for k, v in frames.items()}
    ped = out["fato_pedido"]
    ped["tem_contrato"] = ped["tem_contrato"].astype(int)
    # Recalcula a flag canônica; o PostgreSQL também a gera como STORED.
    ped["otif"] = ((ped["status"] == "Entregue")
                   & (ped["atraso_dias"] == 0)
                   & (ped["qtd_recebida"] >= ped["quantidade"])
                   & (ped["qtd_defeito"] == 0)).astype(int)
    ped["mes_calendario"] = ped["data_emissao"].dt.to_period("M").astype(str)
    # valor_total é a fonte da verdade; recomputa o frete implícito quando divergir
    esperado = ped["quantidade"] * ped["valor_unitario"]
    ped["frete"] = (ped["valor_total"] - esperado).clip(lower=0).round(2)
    out["fato_cotacao"]["saving_potencial"] = (
        out["fato_cotacao"]["quantidade"]
        * (out["fato_cotacao"]["preco_referencia"] - out["fato_cotacao"]["preco_unitario"])
    ).round(2)
    return out


UPSERT_KEYS = {
    "dim_unidade": ["id_unidade"],
    "dim_comprador": ["id_comprador"],
    "dim_categoria": ["id_categoria"],
    "dim_item": ["id_item"],
    "dim_fornecedor": ["id_fornecedor"],
    "dim_contrato": ["id_contrato"],
    "fato_pedido": ["id_pedido"],
    "fato_cotacao": ["id_requisicao", "id_fornecedor", "id_item"],
    "fato_preco": ["mes_ref", "id_item"],
    "fato_orcamento": ["mes_ref", "id_categoria", "id_unidade"],
}

RUN_LOG_DDL = """
CREATE TABLE IF NOT EXISTS dw.etl_run_log (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz,
    mode            varchar(12) NOT NULL CHECK (mode IN ('full', 'incremental')),
    status          varchar(12) NOT NULL CHECK (status IN ('running', 'success', 'failed')),
    since_date      date,
    rows_loaded     jsonb NOT NULL DEFAULT '{}'::jsonb,
    message         text
)
"""


def filter_since(frames: dict[str, pd.DataFrame], since: str) -> dict[str, pd.DataFrame]:
    """Recorte incremental por data para fatos; dimensões permanecem completas."""
    out = {k: v.copy() for k, v in frames.items()}
    since_date = pd.Timestamp(since)
    since_month = since_date.strftime("%Y-%m")
    if "fato_pedido" in out:
        out["fato_pedido"] = out["fato_pedido"][out["fato_pedido"]["data_emissao"] >= since_date]
    if "fato_cotacao" in out:
        out["fato_cotacao"] = out["fato_cotacao"][out["fato_cotacao"]["data_cotacao"] >= since_date]
    if "fato_preco" in out:
        out["fato_preco"] = out["fato_preco"][out["fato_preco"]["mes_ref"] >= since_month]
    if "fato_orcamento" in out:
        out["fato_orcamento"] = out["fato_orcamento"][out["fato_orcamento"]["mes_ref"] >= since_month]
    return out


def load(frames: dict[str, pd.DataFrame], dsn: str, mode: str = "full", since: str | None = None) -> None:
    """Carga transacional.

    mode=full        staging + TRUNCATE explícito (sem CASCADE) + swap atômico.
    mode=incremental staging + INSERT ... ON CONFLICT DO UPDATE por chave natural.
                     Dimensões são upsert; fatos são upsert pelas chaves do modelo.
                     `since` reduz o volume extraído, mas atualizações em registros
                     antigos exigem reenvio explícito (ou CDC na origem).
    """
    import psycopg2  # import local: permite rodar --validate-only sem o driver
    from psycopg2.extras import execute_values, Json

    cols = {
        "dim_unidade": ["id_unidade", "unidade", "cidade", "uf", "tipo"],
        "dim_comprador": ["id_comprador", "comprador", "id_unidade", "categoria_responsavel"],
        "dim_categoria": ["id_categoria", "categoria", "grupo", "criticidade", "peso_spend",
                          "drift_mensal", "lead_time_base_dias", "natureza"],
        "dim_item": ["id_item", "descricao", "id_categoria", "unidade_medida", "preco_referencia", "criticidade"],
        "dim_fornecedor": ["id_fornecedor", "razao_social", "id_categoria", "uf", "porte", "status",
                           "data_homologacao", "prazo_pagamento_dias", "iso9001", "rating_cadastral",
                           "risco", "lead_time_medio_dias"],
        "dim_contrato": ["id_contrato", "id_fornecedor", "id_categoria", "data_inicio", "data_fim",
                         "valor_anual", "reajuste_pct", "indice_reajuste", "status"],
        "fato_pedido": ["id_pedido", "id_requisicao", "data_emissao", "mes_ref", "id_fornecedor",
                        "id_item", "id_categoria", "id_comprador", "id_unidade", "quantidade",
                        "valor_unitario", "frete", "valor_total", "preco_referencia", "saving_valor",
                        "modalidade", "tem_contrato", "data_entrega_prevista", "data_entrega_real",
                        "atraso_dias", "qtd_recebida", "qtd_defeito", "status", "nota_qualidade"],
        # otif é GENERATED ALWAYS no PostgreSQL: não é carregado.
        "fato_cotacao": ["id_requisicao", "data_cotacao", "id_item", "id_categoria", "id_fornecedor",
                         "quantidade", "preco_unitario", "frete", "valor_total", "prazo_entrega_dias",
                         "prazo_pagamento_dias", "selecionada", "preco_referencia"],
        "fato_preco": ["mes_ref", "id_item", "id_categoria", "preco_medio", "indice_categoria", "variacao_mm_pct"],
        "fato_orcamento": ["mes_ref", "id_categoria", "id_unidade", "orcamento", "forecast"],
    }
    targets = [table for table, _, _ in TABLES]
    counts: dict[str, int] = {}

    with psycopg2.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(RUN_LOG_DDL)
            # Serializa cargas concorrentes sem bloquear leituras até o swap.
            cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s)::bigint)", ("meridian.etl.load.v1",))

            # Fase 1 — staging: nada no destino é alterado ainda.
            print(f"  staging ({mode}; nenhuma tabela de destino foi alterada)")
            for table in targets:
                df = frames[table][cols[table]].copy()
                for col in df.columns:
                    if str(df[col].dtype).startswith("datetime"):
                        df[col] = df[col].dt.date
                values = [tuple(None if pd.isna(v) else (v.item() if hasattr(v, "item") else v) for v in row)
                          for row in df.itertuples(index=False, name=None)]
                stg = f"stg_{table}"
                cur.execute(f"CREATE TEMP TABLE {stg} (LIKE dw.{table} INCLUDING DEFAULTS) ON COMMIT DROP")
                execute_values(
                    cur,
                    f"INSERT INTO {stg} ({', '.join(cols[table])}) VALUES %s",
                    values,
                    page_size=2000,
                )
                cur.execute(f"SELECT count(*) FROM {stg}")
                staged = int(cur.fetchone()[0])
                if staged != len(values):
                    raise RuntimeError(f"staging de {table}: {staged} linhas, esperado {len(values)}")
                counts[table] = staged
                print(f"  staging {stg:<22} {staged:>6} linhas validadas")

            if mode == "incremental":
                print("  merge incremental (INSERT ... ON CONFLICT DO UPDATE)")
                for table in targets:
                    columns = ", ".join(cols[table])
                    keys = UPSERT_KEYS[table]
                    updates = [c for c in cols[table] if c not in keys]
                    action = ", ".join(f"{c} = EXCLUDED.{c}" for c in updates) or "NOTHING"
                    conflict = f"ON CONFLICT ({', '.join(keys)}) DO UPDATE SET {action}"
                    cur.execute(
                        f"INSERT INTO dw.{table} ({columns}) "
                        f"SELECT {columns} FROM stg_{table} {conflict}"
                    )
                    cur.execute(f"ANALYZE dw.{table}")
                    print(f"  merge   dw.{table:<16} {counts[table]:>6} linhas")
            else:
                # Fase 2 — swap atômico. A lista explícita evita CASCADE.
                print("  swap atômico (TRUNCATE sem CASCADE + INSERT ... SELECT)")
                cur.execute("TRUNCATE TABLE " + ", ".join(f"dw.{table}" for table in targets))
                for table in targets:
                    columns = ", ".join(cols[table])
                    cur.execute(
                        f"INSERT INTO dw.{table} ({columns}) "
                        f"SELECT {columns} FROM stg_{table}"
                    )
                    cur.execute(f"SELECT count(*) FROM dw.{table}")
                    loaded = int(cur.fetchone()[0])
                    if loaded != len(frames[table]):
                        raise RuntimeError(f"carga de {table}: {loaded} linhas, esperado {len(frames[table])}")
                    cur.execute(f"ANALYZE dw.{table}")
                    print(f"  carregado dw.{table:<16} {loaded:>6} linhas")

            cur.execute(
                "INSERT INTO dw.etl_run_log (finished_at, mode, status, since_date, rows_loaded, message) "
                "VALUES (now(), %s, 'success', %s, %s, %s)",
                (mode, since, Json(counts), "carga concluída"),
            )
        # Commit único: staging, swap/merge e log entram juntos.
        conn.commit()


def record_failure(dsn: str, mode: str, since: str | None, counts: dict[str, int], message: str) -> None:
    """Registra a falha fora da transação desfeita (log não é perdido no rollback)."""
    try:
        import psycopg2
        from psycopg2.extras import Json
        with psycopg2.connect(dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(RUN_LOG_DDL)
                cur.execute(
                    "INSERT INTO dw.etl_run_log (finished_at, mode, status, since_date, rows_loaded, message) "
                    "VALUES (now(), %s, 'failed', %s, %s, %s)",
                    (mode, since, Json(counts), message[:4000]),
                )
            conn.commit()
    except Exception as exc:  # log é best-effort; não esconder o erro original
        print(f"  ! não foi possível registrar a falha no etl_run_log: {exc}")

def main() -> int:
    parser = argparse.ArgumentParser(description="ETL Meridian BI")
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR)
    parser.add_argument("--dsn", default=os.getenv("DATABASE_URL", ""),
                        help="DSN PostgreSQL. Sem DSN, executa apenas extração + validação.")
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--mode", choices=["full", "incremental"], default="full",
                        help="full = swap atômico; incremental = merge por chave natural")
    parser.add_argument("--since", default=None,
                        help="Data ISO (YYYY-MM-DD) para recorte incremental dos fatos")
    parser.add_argument("--report-dir", type=Path, default=ROOT / "etl" / "out")
    args = parser.parse_args()
    mode = "incremental" if args.since else args.mode

    rep = Report()
    print("→ EXTRACT")
    frames = extract(args.data_dir)
    print("→ VALIDATE")
    validate(frames, rep)
    print("→ TRANSFORM")
    frames = transform(frames)
    if args.since:
        print(f"→ INCREMENTAL desde {args.since} (dimensões completas)")
        frames = filter_since(frames, args.since)

    if args.dsn and not args.validate_only:
        print(f"→ LOAD ({mode})")
        try:
            load(frames, args.dsn, mode=mode, since=args.since)
        except Exception as exc:
            record_failure(args.dsn, mode, args.since, {}, str(exc))
            raise

    args.report_dir.mkdir(parents=True, exist_ok=True)
    report_path = args.report_dir / "quality_report.json"
    report_path.write_text(json.dumps(rep.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")

    print("\nResumo da qualidade")
    print(f"  verificações : {len(rep.checks)}")
    print(f"  erros        : {len(rep.errors)}")
    print(f"  avisos       : {len(rep.warnings)}")
    print(f"  relatório    : {report_path}")
    for issue in rep.errors:
        print(f"  ✗ [{issue['table']}] {issue['rule']}: {issue['detail']}")
    for issue in rep.warnings:
        print(f"  ! [{issue['table']}] {issue['rule']}: {issue['detail']}")

    return 1 if rep.errors else 0


if __name__ == "__main__":
    sys.exit(main())
