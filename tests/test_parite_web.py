"""Parité entre le moteur Python (logiciel Windows) et le moteur JavaScript (navigateur,
téléphone, tablette) : mêmes règles, mêmes documents Word, octet XML pour octet XML.

Nécessite Node.js et Playwright (Chromium) ; les tests sont ignorés sinon.
"""
from __future__ import annotations

import base64
import functools
import http.server
import io
import json
import shutil
import subprocess
import sys
import threading
import zipfile
from datetime import date
from pathlib import Path

import pytest
from lxml import etree

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import config, dates, generation, regles  # noqa: E402
from app.modeles import Inventaire  # noqa: E402
from outils.construire_web import construire  # noqa: E402
from tests.test_application import _saisie, travail  # noqa: E402,F401  (fixture partagée)

EXECUTEUR = Path(__file__).resolve().parent / "web" / "executer.cjs"


def _playwright_disponible() -> bool:
    if not shutil.which("node"):
        return False
    r = subprocess.run(["node", "-e", "require('playwright')"], capture_output=True, cwd=EXECUTEUR.parent)
    return r.returncode == 0


pytestmark = pytest.mark.skipif(not _playwright_disponible(), reason="Node.js + Playwright absents")


@pytest.fixture(scope="module")
def site(tmp_path_factory):
    dossier = construire(tmp_path_factory.mktemp("site") / "site")
    class Silencieux(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    gestionnaire = functools.partial(Silencieux, directory=str(dossier))
    serveur = http.server.ThreadingHTTPServer(("127.0.0.1", 0), gestionnaire)
    threading.Thread(target=serveur.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{serveur.server_address[1]}"
    serveur.shutdown()


def executer_js(site, taches, tmp_path):
    fichier = tmp_path / "taches.json"
    fichier.write_text(json.dumps({"taches": taches}, default=str), encoding="utf-8")
    r = subprocess.run(["node", str(EXECUTEUR), site, str(fichier)], capture_output=True, text=True, timeout=300,
                       cwd=EXECUTEUR.parent)
    assert r.returncode == 0, r.stderr
    resultats = json.loads(Path(str(fichier) + ".resultat.json").read_text(encoding="utf-8"))
    for res in resultats:
        assert not (isinstance(res, dict) and "exception" in res), res.get("exception")
    return resultats


def b64(octets: bytes) -> str:
    return base64.b64encode(octets).decode()


def parties_canoniques(octets: bytes) -> dict[str, bytes]:
    """XML canonique (C14N) des parties Word modifiables : insensible à l'ordre des attributs
    et aux déclarations d'espaces de noms redondantes, sensible à tout le reste."""
    res = {}
    with zipfile.ZipFile(io.BytesIO(octets)) as z:
        for nom in z.namelist():
            if nom.endswith(".xml") and nom.startswith("word/") and "/" not in nom[5:]:
                res[nom] = etree.tostring(etree.fromstring(z.read(nom)), method="c14n")
            elif not nom.endswith(".xml"):
                res[nom] = z.read(nom)
        res["__liste__"] = "\n".join(z.namelist()).encode()
    return res


def comparer_docx(python: bytes, js: bytes, nom: str):
    a, b = parties_canoniques(python), parties_canoniques(js)
    assert a.keys() == b.keys(), nom
    for partie in a:
        assert a[partie] == b[partie], f"{nom} : {partie} différent"


# --------------------------------------------------------------------------- dates et balises
def test_parite_dates_balises(site, tmp_path):
    saisies = ["12/03/1985", "12/3/85", "12031985", "120385", "1985-03-12", "12.03.1985", "31/02/2020", "", "abc",
               "29/02/2024", "1 2 99", "01-01-30"]
    formats = ["jj/mm/aaaa", "jj/mm/aa", "mm", "aaaa", "j mois aaaa", "Mois aaaa", "MOIS", "le j/m"]
    balises_test = ["{{DATE_RDV+1a:mm/aaaa}}", "{{ nom | maj }}", "{{SSA|x}}", "{{SSA}}", "{{INCONNU}}", "{{PRENOM|cap}}",
                    "{{DATE_RDV-1m+3j}}", "{{DATE_NAISSANCE+4a:j mois aaaa|maj}}", "{{AGE}}"]
    code = """(async () => {
      const lire = %s.map((s) => { const d = dates.lireDate(s, true); return d ? d.iso() : null; });
      const d = dates.lireDate("09/11/2030");
      const fmt = %s.map((f) => dates.formater(d, f));
      const aj = [["2026-11-21", 4, 0], ["2028-02-29", 4, 0], ["2096-02-29", 4, 0], ["2026-01-31", 0, 1], ["2026-12-31", 0, 2]]
        .map(([s, a, m]) => dates.ajouter(dates.lireDate(s), { annees: a, mois: m }).iso());
      const valeurs = { DATE_RDV: dates.lireDate("21/11/2026"), DATE_NAISSANCE: dates.lireDate("29/02/1980"),
                        NOM: "dupont", PRENOM: "jean-pierre DE la tour", SSA: true, AGE: 46 };
      const bal = %s.map((t) => balises.resoudre(balises.analyser(t), valeurs));
      const gab = gen.gabarit("{DATE_RDV:aaaa-mm-jj} {NOM|maj} {PRENOM} ({DOSSIER}) : / ?", valeurs);
      return { lire, fmt, aj, bal, gab, age: [dates.age(dates.lireDate("22/11/1986"), dates.lireDate("21/11/2026")),
                                              dates.age(dates.lireDate("21/11/1986"), dates.lireDate("21/11/2026"))] };
    })()""" % (json.dumps(saisies), json.dumps(formats), json.dumps(balises_test))
    js = executer_js(site, [{"type": "evaluer", "code": code}], tmp_path)[0]

    from app import balises
    assert js["lire"] == [(d.isoformat() if d else None) for d in (dates.lire_date(s, True) for s in saisies)]
    d = date(2030, 11, 9)
    assert js["fmt"] == [dates.formater(d, f) for f in formats]
    attendu = [dates.ajouter(date(2026, 11, 21), annees=4), dates.ajouter(date(2028, 2, 29), annees=4),
               dates.ajouter(date(2096, 2, 29), annees=4), dates.ajouter(date(2026, 1, 31), mois=1),
               dates.ajouter(date(2026, 12, 31), mois=2)]
    assert js["aj"] == [x.isoformat() for x in attendu]
    valeurs = {"DATE_RDV": date(2026, 11, 21), "DATE_NAISSANCE": date(1980, 2, 29), "NOM": "dupont",
               "PRENOM": "jean-pierre DE la tour", "SSA": True, "AGE": 46}
    assert js["bal"] == [list(balises.resoudre(balises.analyser(t), valeurs)) for t in balises_test]
    assert js["gab"] == generation.gabarit("{DATE_RDV:aaaa-mm-jj} {NOM|maj} {PRENOM} ({DOSSIER}) : / ?", valeurs)
    assert js["age"] == [39, 40]


# --------------------------------------------------------------------------- import (pose des balises)
def test_parite_preparation_des_modeles(site, travail, tmp_path):  # noqa: F811
    origine = travail / "origine"
    fichiers = sorted(p for p in origine.rglob("*.docx"))
    taches = [{"type": "preparer", "nom": p.relative_to(origine).as_posix(), "octets": b64(p.read_bytes())} for p in fichiers]
    resultats = executer_js(site, taches, tmp_path)
    for p, r in zip(fichiers, resultats):
        rel = p.relative_to(origine).as_posix()
        python = (travail / "modeles" / rel).read_bytes()
        comparer_docx(python, base64.b64decode(r["octets"]), rel)


# --------------------------------------------------------------------------- règles et génération
SCENARIOS = [
    {},
    {"motifs": [{"type": "VQ", "aptitude": "PLD"}, {"type": "VE", "aptitude": "ENTOPS"}]},
    {"motifs": [{"type": "VI", "aptitude": "CAT1"}, {"type": "VI", "aptitude": "NC"}]},
    {"motifs": [{"type": "VA", "aptitude": "PLB"}], "surcharges": {"DATE_VQ": "15/02/28"}},
    {"motifs": [{"type": "VA", "aptitude": "PLB"}]},
    {"motifs": [{"type": "VQ", "aptitude": "PLB"}], "surcharges": {"TYPE_VENUE": "VQ spéciale", "DATE_VQ": "01/01/2031"}},
    {"champs": {"NOM": "o'brien", "PRENOM": "  élodie   marie ", "DATE_NAISSANCE": "21/11/1976", "DOSSIER": "1",
                "DATE_RDV": "21/11/2026", "AFFECTATION": "x" * 30, "GRADE": ""}},
    {"champs": {"NOM": "x", "PRENOM": "y", "DATE_NAISSANCE": "", "DOSSIER": "2", "DATE_RDV": "211126"}},
    {"champs": {"NOM": "", "PRENOM": "y", "DATE_NAISSANCE": "32/01/1980", "DOSSIER": "3", "DATE_RDV": "21/11/2026"}},
    {"motifs": [{"type": "VQ", "aptitude": "CAT3"}], "champs": {"NOM": "a", "PRENOM": "b", "DATE_NAISSANCE": "01/01/1990",
                                                                 "DOSSIER": "4", "DATE_RDV": "21/11/2026", "SSA": True}},
    {"documents_exclus": ["axone:FICHES NAVETTE AXONE/FICHE QUADRIENNALE 40 ANS ET PLUS.docx"],
     "documents_ajoutes": ["initiale/Certif CONFLANS.docx"]},
    {"motifs": [{"type": "CABAT", "aptitude": ""}]},
]


@pytest.mark.parametrize("n", range(len(SCENARIOS)))
def test_parite_regles_et_documents(site, travail, tmp_path, n):  # noqa: F811
    cfg = config.defaut()
    saisie = _saisie(**SCENARIOS[n])
    inv = Inventaire(travail / "modeles")
    calcul = regles.calculer(cfg, saisie, inv)
    calcul.pop("valeurs")
    calcul_py = json.loads(json.dumps(calcul, default=str))
    modeles = [{"chemin": rel, "octets": b64((travail / "modeles" / rel).read_bytes())} for rel in inv.fichiers]
    js = executer_js(site, [{"type": "generer", "config": cfg, "saisie": saisie, "modeles": modeles}], tmp_path)[0]
    assert js["calcul"] == calcul_py

    if calcul["bloquant"]:
        assert js["erreur"] and not js["fichiers"]
        return
    res = generation.generer(cfg, travail, inv, saisie)
    assert js["erreur"] is None
    assert js["dossier"] == Path(res["dossier"]).name
    assert [f["nom"] for f in js["fichiers"]] == [f["nom"] for f in res["fichiers"]]
    assert [f["cases_cochees"] for f in js["fichiers"]] == [f["cases_cochees"] for f in res["fichiers"]]
    for f_js, f_py in zip(js["fichiers"], res["fichiers"]):
        comparer_docx(Path(f_py["chemin"]).read_bytes(), base64.b64decode(f_js["octets"]), f_py["nom"])


def test_parite_controle_parametrage(site, tmp_path):
    cfg = config.defaut()
    casse = json.loads(json.dumps(cfg))
    casse["champs"].append({"cle": "date test", "libelle": "x", "type": "autre"})
    casse["champs"].append({"cle": "AGE", "libelle": "x", "type": "texte"})
    casse["types_visite"][0]["cases"] = "(non fermée"
    casse["types_visite"].append(dict(casse["types_visite"][1]))
    casse["certificats"][0]["types"] = ["ZZ"]
    casse["fiches_axone"][0]["modele"] = " "
    code = "gen.controler(%s)"
    resultats = executer_js(site, [{"type": "evaluer", "code": code % json.dumps(c)} for c in (cfg, casse)], tmp_path)
    assert resultats[0] == [] == config.controler(cfg)
    py = config.controler(casse)
    # le texte de l'erreur d'expression régulière vient du moteur de chaque langage
    assert [e.split(" (")[0] for e in resultats[1]] == [e.split(" (")[0] for e in py]


# --------------------------------------------------------------------------- parcours complet sur téléphone
@pytest.mark.parametrize("appareil", ["Pixel 7", "iPad (gen 7)"])
def test_parcours_telephone_tablette(site, travail, tmp_path, appareil):  # noqa: F811
    """Paquet exporté par le logiciel Windows → application mobile → documents identiques."""
    from app.serveur import Application
    paquet = tmp_path / "paquet.zip"
    app = Application(travail)
    paquet.write_bytes(app.exporter_paquet())
    sortie = tmp_path / "sortie"
    sortie.mkdir()
    r = subprocess.run(["node", str(EXECUTEUR.parent / "parcours.cjs"), site, str(paquet), str(sortie), appareil],
                       capture_output=True, text=True, timeout=300, cwd=EXECUTEUR.parent)
    assert r.returncode == 0, r.stderr
    rapport = json.loads((sortie / "rapport.json").read_text(encoding="utf-8"))
    assert rapport["erreurs"] == []
    assert all(v <= 0 for v in rapport["debordements"].values()), rapport["debordements"]  # pas de défilement horizontal
    assert rapport["age"].startswith("46") and rapport["vq"] == "21/11/2030"
    assert rapport["historique"] == 1 and rapport["modeles_apres_rechargement"] is True
    assert rapport["hors_ligne_documents"] == 2  # fonctionne sans connexion

    res = generation.generer(app.cfg, travail, app.inventaire, _saisie())
    assert rapport["zip"] == Path(res["dossier"]).name + ".zip"
    with zipfile.ZipFile(sortie / "documents.zip") as z:
        assert sorted(z.namelist()) == sorted(f["nom"] for f in res["fichiers"])
        for f in res["fichiers"]:
            comparer_docx(Path(f["chemin"]).read_bytes(), z.read(f["nom"]), f["nom"])
