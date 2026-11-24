"""Tests de l'application (lancer : python -m pytest tests)."""
from __future__ import annotations

import shutil
import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import balises, config, dates, docx_moteur, generation, importation, regles  # noqa: E402
from app.modeles import Inventaire, cle_normalisee  # noqa: E402
from tests import fabrique  # noqa: E402


# --------------------------------------------------------------------------- dates
@pytest.mark.parametrize("saisie,attendu", [
    ("12/03/1985", date(1985, 3, 12)), ("12/3/85", date(1985, 3, 12)), ("12031985", date(1985, 3, 12)),
    ("120385", date(1985, 3, 12)), ("1985-03-12", date(1985, 3, 12)), ("12.03.1985", date(1985, 3, 12)),
    ("31/02/2020", None), ("", None), ("abc", None),
])
def test_lire_date(saisie, attendu):
    assert dates.lire_date(saisie, siecle_passe=True) == attendu


def test_vq_jour_pour_jour():
    assert dates.ajouter(date(2026, 11, 21), annees=4) == date(2030, 11, 21)
    assert dates.ajouter(date(2028, 2, 29), annees=4) == date(2032, 2, 29)
    assert dates.ajouter(date(2096, 2, 29), annees=4) == date(2100, 2, 28)  # 2100 non bissextile
    assert dates.ajouter(date(2026, 1, 31), mois=1) == date(2026, 2, 28)


def test_age():
    assert dates.age(date(1986, 11, 22), date(2026, 11, 21)) == 39
    assert dates.age(date(1986, 11, 21), date(2026, 11, 21)) == 40


def test_formater():
    d = date(2030, 11, 9)
    assert dates.formater(d, "jj/mm/aa") == "09/11/30"
    assert dates.formater(d, "mm") == "11"
    assert dates.formater(d, "j mois aaaa") == "9 novembre 2030"


# --------------------------------------------------------------------------- balises
def test_balises():
    valeurs = {"DATE_RDV": date(2026, 11, 21), "NOM": "dupont", "SSA": True}
    b = balises.analyser("{{DATE_RDV+1a:mm/aaaa}}")
    assert balises.resoudre(b, valeurs)[0] == "11/2027"
    assert balises.resoudre(balises.analyser("{{ nom | maj }}"), valeurs)[0] == "DUPONT"
    assert balises.resoudre(balises.analyser("{{SSA|x}}"), valeurs)[0] == "X"
    assert balises.resoudre(balises.analyser("{{INCONNU}}"), valeurs) == ("", False)
    assert balises.capitaliser("jean-pierre DE LA tour") == "Jean-Pierre De La Tour"


def test_cle_normalisee():
    assert cle_normalisee("initiale réact/Certif  PLB.doc") == cle_normalisee("Initiale React/certif plb.docx")


# --------------------------------------------------------------------------- environnement de test
LIGNES_QUADRI = ["aptitude plongeur de bord - EXPERTISE QUADRIENNALE", "aptitude plongeur de bord - CONTROLE ANNUEL"]


@pytest.fixture()
def travail(tmp_path):
    src = tmp_path / "origine"
    (src / "quadriennale").mkdir(parents=True)
    (src / "initiale").mkdir()
    (src / "FICHES NAVETTE AXONE").mkdir()
    fabrique.certificat(src / "quadriennale/Certif PLB Quadri.docx", LIGNES_QUADRI)
    fabrique.certificat(src / "quadriennale/Certif PLD Quadri.docx",
                        [l.replace("de bord", "démineur") for l in LIGNES_QUADRI])
    fabrique.certificat(src / "initiale/Certif Cat 1 + NC Initiale.docx",
                        ["aptitude plongeur catégorie 1 - EXPERTISE INITIALE", "aptitude nageur de combat - EXPERTISE INITIALE"])
    fabrique.certificat(src / "initiale/Certif CONFLANS.docx",
                        ["aptitude plongeur de bord - EXPERTISE INITIALE"], grade_fixe="CIVIL")
    for nom in ("FICHE QUADRIENNALE MOINS DE 40 ANS", "FICHE QUADRIENNALE 40 ANS ET PLUS",
                "FICHE QUADRIENNALE 50 ANS ET PLUS", "Plongee SATURATION-ENTOPS", "FICHE INITIALE PLD-IO-NC",
                "FICHE NAVETTE - AXONE Vierge", "FICHE  ANNUELLE  40 ANS ET PLUS"):
        fabrique.fiche_axone(src / f"FICHES NAVETTE AXONE/{nom}.docx", ["ECG", "AUDIO"])
    (tmp_path / "config").mkdir()
    rapport = importation.importer(src, tmp_path / "modeles")
    assert rapport["totaux"]["erreur"] == 0
    return tmp_path


def _saisie(**kw):
    s = {"champs": {"NOM": "dupont", "PRENOM": "jean", "DATE_NAISSANCE": "15/06/1980", "DOSSIER": "10832",
                    "GRADE": "mt", "MATRICULE": "2016198", "AFFECTATION": "ban lanvéoc", "DATE_RDV": "21/11/2026"},
         "motifs": [{"type": "VQ", "aptitude": "PLB"}]}
    s.update(kw)
    return s


def test_config_par_defaut_valide():
    assert config.controler(config.defaut()) == []


def test_regles_quadriennale_age(travail):
    cfg = config.defaut()
    inv = Inventaire(travail / "modeles")
    r = regles.calculer(cfg, _saisie(), inv)
    assert r["age"] == 46
    assert r["vq"]["valeur"] == "21/11/2030"
    assert r["type_venue"]["valeur"] == "VQ PLB"
    titres = [d["modele"] for d in r["documents"]]
    assert titres == ["FICHES NAVETTE AXONE/FICHE QUADRIENNALE 40 ANS ET PLUS.docx", "quadriennale/Certif PLB Quadri.docx"]
    assert not r["bloquant"], r["alertes"]
    s = _saisie()
    s["champs"]["DATE_NAISSANCE"] = "22/11/1986"  # 39 ans la veille de ses 40 ans
    assert regles.calculer(cfg, s, inv)["documents"][0]["modele"].endswith("MOINS DE 40 ANS.docx")
    s["champs"]["DATE_NAISSANCE"] = "21/11/1976"  # 50 ans le jour même
    assert regles.calculer(cfg, s, inv)["documents"][0]["modele"].endswith("50 ANS ET PLUS.docx")


def test_regles_double_motif(travail):
    cfg = config.defaut()
    inv = Inventaire(travail / "modeles")
    r = regles.calculer(cfg, _saisie(motifs=[{"type": "VQ", "aptitude": "PLD"}, {"type": "VE", "aptitude": "ENTOPS"}]), inv)
    assert r["type_venue"]["valeur"] == "VQ PLD + VE ENTOPS"
    assert [d["modele"] for d in r["documents"]] == ["FICHES NAVETTE AXONE/Plongee SATURATION-ENTOPS.docx",
                                                     "quadriennale/Certif PLD Quadri.docx"]
    assert r["vq"]["valeur"] == "21/11/2030"
    # certificat combiné
    r = regles.calculer(cfg, _saisie(motifs=[{"type": "VI", "aptitude": "CAT1"}, {"type": "VI", "aptitude": "NC"}]), inv)
    certifs = [d["modele"] for d in r["documents"] if d["categorie"] == "certificat"]
    assert certifs == ["initiale/Certif Cat 1 + NC Initiale.docx"]
    assert r["documents"][0]["modele"].endswith("PLD-IO-NC.docx")


def test_regles_annuelle_vq_a_saisir(travail):
    cfg = config.defaut()
    inv = Inventaire(travail / "modeles")
    r = regles.calculer(cfg, _saisie(motifs=[{"type": "VA", "aptitude": "PLB"}]), inv)
    assert r["vq"]["mode"] == "saisie" and r["vq"]["valeur"] is None
    assert any("prochaine VQ" in a["message"] for a in r["alertes"])
    r = regles.calculer(cfg, _saisie(motifs=[{"type": "VA", "aptitude": "PLB"}], surcharges={"DATE_VQ": "15/02/28"}), inv)
    assert r["vq"]["valeur"] == "15/02/2028"


def test_champs_obligatoires(travail):
    cfg = config.defaut()
    s = _saisie()
    s["champs"]["NOM"] = ""
    r = regles.calculer(cfg, s, Inventaire(travail / "modeles"))
    assert r["bloquant"]


def test_generation_complete(travail):
    cfg = config.defaut()
    inv = Inventaire(travail / "modeles")
    res = generation.generer(cfg, travail, inv, _saisie())
    assert len(res["fichiers"]) == 2
    fiche = docx_moteur.DocumentWord(res["fichiers"][0]["chemin"])
    texte = docx_moteur.texte_complet(fiche)
    assert "Fiche n° 10832" in texte and "Prochaine VQ : 21/11/30" in texte
    assert "DUPONT Jean" in texte and "Né(e) le 15/06/1980" in texte
    assert "Grade : MT" in texte and "Affectation : BAN LANVÉOC" in texte and "AGE: 46 ans" in texte
    assert "9732" not in texte and "FLOPHIB" not in texte and "{{" not in texte
    certif = docx_moteur.DocumentWord(res["fichiers"][1]["chemin"])
    texte = docx_moteur.texte_complet(certif)
    assert "NOM : DUPONT" in texte and "Prénom : Jean" in texte
    assert "Date de naissance : 15/06/1980" in texte
    assert "avant fin 11 / 2030" in texte and "le 21/11/2026" in texte
    cases = {docx_moteur.libelle_case(c): c.est_cochee()
             for r in certif.racines() for c in docx_moteur.champs_formulaire(r) if c.genre == "case"}
    assert cases["aptitude plongeur de bord - EXPERTISE QUADRIENNALE"] is True
    assert cases["aptitude plongeur de bord - CONTROLE ANNUEL"] is False
    assert cases["apte à servir"] is False  # la conclusion reste au médecin
    assert res["fichiers"][1]["cases_cochees"] == ["aptitude plongeur de bord - EXPERTISE QUADRIENNALE"]
    hist = generation.Historique(travail).lire()
    assert hist and hist[0]["nom"] == "DUPONT"


def test_generation_annuelle_coche_controle(travail):
    cfg = config.defaut()
    inv = Inventaire(travail / "modeles")
    res = generation.generer(cfg, travail, inv, _saisie(motifs=[{"type": "VA", "aptitude": "PLB"}],
                                                        surcharges={"DATE_VQ": "15/02/2028"}))
    assert res["fichiers"][1]["cases_cochees"] == ["aptitude plongeur de bord - CONTROLE ANNUEL"]


def test_import_conserve_valeur_fixe(travail):
    texte = docx_moteur.texte_complet(docx_moteur.DocumentWord(travail / "modeles/initiale/Certif CONFLANS.docx"))
    assert "Grade : CIVIL" in texte and "{{NOM}}" in texte


def test_import_doc_par_libreoffice(tmp_path):
    from app import systeme
    if not systeme.trouver_libreoffice():
        pytest.skip("LibreOffice absent")
    import subprocess
    src = tmp_path / "src"
    src.mkdir()
    fabrique.certificat(src / "Certif.docx", LIGNES_QUADRI)
    subprocess.run(["soffice", "--headless", "--convert-to", "doc", "--outdir", str(src), str(src / "Certif.docx")],
                   capture_output=True, timeout=120)
    (src / "Certif.docx").unlink()
    rapport = importation.importer(src, tmp_path / "modeles")
    assert rapport["fichiers"][0]["conversion"] == "LibreOffice"
    assert {"NOM", "PRENOM", "DATE_NAISSANCE", "DATE_RDV", "DATE_VQ"} <= set(rapport["fichiers"][0]["balises"])


def test_balises_decoupees_en_runs(tmp_path):
    from docx import Document
    d = Document()
    p = d.add_paragraph()
    for morceau in ("Nom : {", "{NO", "M}", "} né le {{DATE_NAISSANCE:jj/mm/aa}}"):
        p.add_run(morceau).bold = True
    d.save(tmp_path / "t.docx")
    doc = docx_moteur.DocumentWord(tmp_path / "t.docx")
    assert docx_moteur.lister_balises(doc) == ["NOM", "DATE_NAISSANCE"]
    docx_moteur.remplacer_balises(doc, {"NOM": "DUPONT", "DATE_NAISSANCE": date(1980, 6, 15)})
    doc.enregistrer(tmp_path / "r.docx")
    assert docx_moteur.texte_complet(docx_moteur.DocumentWord(tmp_path / "r.docx")) == "Nom : DUPONT né le 15/06/80"


def test_premier_lancement_mode_installe(tmp_path):
    from app import chemins
    programme = tmp_path / "programme"
    (programme / "initial" / "config").mkdir(parents=True)
    (programme / "initial" / "config" / "config.json").write_text("{}", encoding="utf-8")
    (programme / "initial" / "modeles" / "quadriennale").mkdir(parents=True)
    (programme / "initial" / "modeles" / "quadriennale" / "a.docx").write_bytes(b"x")
    travail = tmp_path / "Documents" / "Visites plongeurs"
    chemins._initialiser(travail, programme)
    assert (travail / "config" / "config.json").exists()
    assert (travail / "modeles" / "quadriennale" / "a.docx").exists()
    (travail / "config" / "config.json").write_text('{"modifie": 1}', encoding="utf-8")
    chemins._initialiser(travail, programme)  # un second lancement n'écrase rien
    assert "modifie" in (travail / "config" / "config.json").read_text(encoding="utf-8")


def test_export_paquet_parametrage(travail):
    import io
    import json
    import zipfile
    from app.serveur import Application
    app = Application(travail)
    with zipfile.ZipFile(io.BytesIO(app.exporter_paquet())) as z:
        noms = z.namelist()
        assert json.loads(z.read("config/config.json"))["general"]["ville"] == app.cfg["general"]["ville"]
    assert "modeles/quadriennale/Certif PLB Quadri.docx" in noms
    assert not any("_sauvegardes" in n for n in noms)
