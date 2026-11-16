"""Testes unitários do ETL (executar: python -m unittest discover -s etl -p 'test_*.py')."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pipeline_etl as etl  # noqa: E402


class PipelineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frames = etl.extract(etl.DATA_DIR)
        cls.report = etl.Report()
        etl.validate(cls.frames, cls.report)

    def test_dataset_extrai_todas_as_tabelas(self):
        for table, _, _ in etl.TABLES:
            self.assertIn(table, self.frames)
            self.assertGreater(len(self.frames[table]), 0, table)

    def test_validacao_sem_erros(self):
        self.assertEqual([c for c in self.report.errors if not c["passed"]], [])

    def test_transform_recalcula_otif_canonico(self):
        out = etl.transform(self.frames)
        ped = out["fato_pedido"]
        esperado = (
            (ped["status"] == "Entregue")
            & (ped["atraso_dias"] == 0)
            & (ped["qtd_recebida"] >= ped["quantidade"])
            & (ped["qtd_defeito"] == 0)
        ).astype(int)
        self.assertTrue((ped["otif"] == esperado).all())

    def test_transform_preserva_saving_negativo(self):
        out = etl.transform(self.frames)
        self.assertGreater((out["fato_pedido"]["saving_valor"] < 0).sum(), 0)

    def test_transform_reconstroi_frete(self):
        out = etl.transform(self.frames)
        ped = out["fato_pedido"]
        self.assertTrue((ped["frete"] >= 0).all())
        calc = ped["quantidade"] * ped["valor_unitario"] + ped["frete"]
        self.assertTrue(((calc - ped["valor_total"]).abs() <= 0.02).all())

    def test_filter_since_reduz_apenas_fatos(self):
        out = etl.filter_since(self.frames, "2026-01-01")
        self.assertGreater(len(self.frames["fato_pedido"]), len(out["fato_pedido"]))
        self.assertEqual(len(self.frames["dim_fornecedor"]), len(out["dim_fornecedor"]))
        self.assertTrue((out["fato_pedido"]["data_emissao"] >= pd.Timestamp("2026-01-01")).all())
        self.assertTrue((out["fato_cotacao"]["data_cotacao"] >= pd.Timestamp("2026-01-01")).all())

    def test_upsert_keys_cobrem_todas_as_tabelas(self):
        for table, _, _ in etl.TABLES:
            self.assertIn(table, etl.UPSERT_KEYS)


if __name__ == "__main__":
    unittest.main()
