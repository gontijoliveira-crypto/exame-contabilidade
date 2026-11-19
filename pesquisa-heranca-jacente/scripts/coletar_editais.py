#!/usr/bin/env python3
"""
Coleta de dados para o estudo de viabilidade "heranças jacentes".

Duas fontes públicas do CNJ:

1. DataJud (API pública de metadados processuais) – conta processos da classe
   "Herança Jacente" por tribunal e ano de ajuizamento. Serve para dimensionar o
   mercado (quantos casos existem por ano, em quais estados).
   Doc: https://datajud-wiki.cnj.jus.br/api-publica/

2. DJEN – Diário de Justiça Eletrônico Nacional (comunica.pje.jus.br) – lista as
   publicações (editais) recentes que mencionam "herança jacente". Serve para a
   triagem diária de oportunidades.
   OBS: a API do DJEN bloqueia acessos de fora do Brasil (CloudFront 403).
   Rode este script a partir de uma conexão brasileira.

Uso:
    python3 coletar_editais.py datajud            # contagem por tribunal/ano
    python3 coletar_editais.py djen --dias 30      # editais dos últimos 30 dias

Saída: arquivos CSV na pasta ./dados/
Só usa a biblioteca padrão do Python (3.9+).
"""
import argparse
import csv
import datetime as dt
import json
import os
import sys
import time
import urllib.parse
import urllib.request

# Chave pública divulgada pelo próprio CNJ na wiki do DataJud (pode mudar;
# confira em https://datajud-wiki.cnj.jus.br/api-publica/acesso).
DATAJUD_KEY = "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw=="
DATAJUD_URL = "https://api-publica.datajud.cnj.jus.br/api_publica_{tribunal}/_search"

TRIBUNAIS_ESTADUAIS = [
    "tjac", "tjal", "tjap", "tjam", "tjba", "tjce", "tjdft", "tjes", "tjgo",
    "tjma", "tjmt", "tjms", "tjmg", "tjpa", "tjpb", "tjpr", "tjpe", "tjpi",
    "tjrj", "tjrn", "tjrs", "tjro", "tjrr", "tjsc", "tjse", "tjsp", "tjto",
]

DJEN_URL = "https://comunicaapi.pje.jus.br/api/v1/comunicacao"

PASTA_DADOS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dados")


def _post_json(url, payload, headers, tentativas=5):
    data = json.dumps(payload).encode("utf-8")
    for i in range(tentativas):
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                corpo = json.loads(resp.read().decode("utf-8"))
            falhas = corpo.get("_shards", {}).get("failed", 0)
            if "error" in corpo or falhas:
                raise RuntimeError(f"resposta parcial/erro (shards com falha: {falhas})")
            return corpo
        except Exception as exc:  # noqa: BLE001
            espera = 10 * (i + 1)
            print(f"  tentativa {i + 1} falhou ({exc}); aguardando {espera}s", file=sys.stderr)
            time.sleep(espera)
    return None


def datajud():
    """Conta processos 'Herança Jacente' por tribunal e ano de ajuizamento."""
    headers = {"Authorization": f"APIKey {DATAJUD_KEY}", "Content-Type": "application/json"}
    consulta = {
        "size": 0,
        "track_total_hits": True,
        "query": {"match_phrase": {"classe.nome": "Herança Jacente"}},
        "aggs": {
            "ano": {
                "date_histogram": {
                    "field": "dataAjuizamento",
                    "calendar_interval": "year",
                    "format": "yyyy",
                }
            }
        },
    }
    os.makedirs(PASTA_DADOS, exist_ok=True)
    saida = os.path.join(PASTA_DADOS, "datajud_heranca_jacente_por_ano.csv")
    with open(saida, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["tribunal", "ano", "processos"])
        for trib in TRIBUNAIS_ESTADUAIS:
            print(f"{trib}…", file=sys.stderr)
            r = _post_json(DATAJUD_URL.format(tribunal=trib), consulta, headers)
            if r is None:
                w.writerow([trib, "ERRO", ""])
                continue
            total = r["hits"]["total"]["value"]
            w.writerow([trib, "TOTAL", total])
            for b in r["aggregations"]["ano"]["buckets"]:
                if b["doc_count"]:
                    w.writerow([trib, b["key_as_string"], b["doc_count"]])
            time.sleep(2)
    print(f"Gravado: {saida}")


def djen(dias):
    """Lista comunicações do DJEN que mencionam 'herança jacente'."""
    fim = dt.date.today()
    ini = fim - dt.timedelta(days=dias)
    os.makedirs(PASTA_DADOS, exist_ok=True)
    saida = os.path.join(PASTA_DADOS, f"djen_heranca_jacente_{ini}_{fim}.csv")
    campos = ["tribunal", "data", "tipo", "classe", "processo", "orgao", "link", "trecho"]
    pagina, total = 1, 0
    with open(saida, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(campos)
        while True:
            params = {
                "texto": "herança jacente",
                "dataDisponibilizacaoInicio": ini.isoformat(),
                "dataDisponibilizacaoFim": fim.isoformat(),
                "itensPorPagina": 100,
                "pagina": pagina,
            }
            url = DJEN_URL + "?" + urllib.parse.urlencode(params)
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    d = json.loads(resp.read().decode("utf-8"))
            except Exception as exc:  # noqa: BLE001
                sys.exit(f"Falha ao consultar o DJEN ({exc}). Está rodando de uma conexão no Brasil?")
            itens = d.get("items", [])
            if not itens:
                break
            for it in itens:
                texto = " ".join((it.get("texto") or "").split())
                w.writerow([
                    it.get("siglaTribunal"), it.get("data_disponibilizacao"),
                    it.get("tipoComunicacao"), it.get("nomeClasse"),
                    it.get("numeroprocessocommascara") or it.get("numero_processo"),
                    it.get("nomeOrgao"), it.get("link"), texto[:600],
                ])
                total += 1
            pagina += 1
            time.sleep(1)
    print(f"{total} publicações gravadas em {saida}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("datajud", help="contagem de processos por tribunal/ano")
    pd = sub.add_parser("djen", help="editais recentes no DJEN")
    pd.add_argument("--dias", type=int, default=30)
    a = p.parse_args()
    if a.cmd == "datajud":
        datajud()
    else:
        djen(a.dias)


if __name__ == "__main__":
    main()
