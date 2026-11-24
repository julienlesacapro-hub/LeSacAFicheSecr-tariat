"""Production des documents remplis et historique des visites."""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from pathlib import Path

from . import balises, chemins, docx_moteur, regles
from .modeles import Inventaire


class SaisieIncomplete(Exception):
    def __init__(self, alertes):
        super().__init__("\n".join(a["message"] for a in alertes if a["niveau"] == "erreur"))
        self.alertes = alertes


def gabarit(modele: str, valeurs: dict, format_date="jj/mm/aaaa") -> str:
    """« {DATE_RDV:aaaa-mm-jj} {NOM} » → « 2026-11-21 DUPONT »."""
    def remplacer(m):
        b = balises.analyser("{{" + m.group(1) + "}}")
        if not b:
            return m.group(0)
        return balises.resoudre(b, valeurs, format_date)[0]
    texte = re.sub(r"\{([^{}]+)\}", remplacer, modele)
    texte = re.sub(r"\(\s*\)", "", texte)
    return nettoyer_nom(texte)


def nettoyer_nom(nom: str, longueur=110) -> str:
    nom = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", nom)
    nom = re.sub(r"\s+", " ", nom).strip(" .-")
    return (nom[:longueur].rstrip(" .-")) or "document"


def predicat_cases(cfg: dict, types_document: list[str]):
    g = cfg["general"]
    prefixe = re.compile(g.get("motif_case_aptitude") or r"^aptitude\b", re.I)
    motifs = []
    for t in cfg["types_visite"]:
        if t["code"] in types_document and (t.get("cases") or "").strip():
            motifs.append(re.compile(t["cases"], re.I))

    def choisir(libelle: str) -> bool:
        return bool(prefixe.search(libelle)) and any(m.search(libelle) for m in motifs)
    return choisir


def generer(cfg: dict, travail: Path, inventaire: Inventaire, saisie: dict) -> dict:
    calcul = regles.calculer(cfg, saisie, inventaire)
    if calcul["bloquant"]:
        raise SaisieIncomplete(calcul["alertes"])
    g = cfg["general"]
    fmt = g.get("format_date", "jj/mm/aaaa")
    valeurs = calcul["valeurs"]
    sortie = chemins.resoudre(travail, g.get("dossier_sortie", "Documents générés"))
    dossier = sortie / gabarit(g.get("nom_dossier_visite", "{DATE_RDV:aaaa-mm-jj} {NOM} {PRENOM}"), valeurs, fmt)
    dossier.mkdir(parents=True, exist_ok=True)

    fichiers, alertes = [], []
    numero = 0
    for d in calcul["documents"]:
        if not d["inclus"]:
            continue
        numero += 1
        doc = docx_moteur.DocumentWord(inventaire.chemin(d["chemin"]))
        inconnues = docx_moteur.remplacer_balises(doc, valeurs, fmt)
        cochees = []
        if g.get("cocher_cases_aptitude", True) and d["types"]:
            cochees = docx_moteur.cocher_cases(doc, predicat_cases(cfg, d["types"]))
        nom = gabarit(g.get("nom_fichier", "{NUMERO} {TITRE}"),
                      {**valeurs, "NUMERO": numero, "TITRE": d["titre"]}, fmt) + ".docx"
        cible = dossier / nom
        try:
            doc.enregistrer(cible)
        except PermissionError:
            cible = dossier / f"{cible.stem} ({datetime.now():%H%M%S}).docx"
            doc.enregistrer(cible)
            alertes.append({"niveau": "attention", "message": f"« {nom} » était ouvert dans Word : "
                                                              f"enregistré sous « {cible.name} »."})
        if inconnues:
            alertes.append({"niveau": "attention", "message": f"{d['titre']} : balises sans valeur "
                                                              f"{', '.join(sorted(inconnues))} (laissées vides)."})
        fichiers.append({"titre": d["titre"], "chemin": str(cible), "nom": cible.name,
                         "categorie": d["categorie"], "cases_cochees": cochees})

    entree = None
    if g.get("historique_actif", True):
        entree = Historique(travail).ajouter(saisie, calcul, dossier, fichiers, int(g.get("historique_max", 500)))
    return {"dossier": str(dossier), "fichiers": fichiers, "alertes": calcul["alertes"] + alertes,
            "historique": entree}


class Historique:
    def __init__(self, travail: Path):
        self.fichier = travail / "donnees" / "historique.json"

    def lire(self) -> list[dict]:
        try:
            return json.loads(self.fichier.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []

    def _ecrire(self, entrees):
        self.fichier.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.fichier.with_suffix(".tmp")
        tmp.write_text(json.dumps(entrees, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(self.fichier)

    def ajouter(self, saisie, calcul, dossier, fichiers, maximum=500) -> dict:
        a = calcul["affichage"]
        entree = {
            "id": uuid.uuid4().hex[:12],
            "horodatage": datetime.now().isoformat(timespec="seconds"),
            "nom": a.get("NOM", ""), "prenom": a.get("PRENOM", ""),
            "dossier_patient": a.get("DOSSIER", ""),
            "date_rdv": a.get("DATE_RDV", ""), "date_vq": a.get("DATE_VQ") or "",
            "type_venue": a.get("TYPE_VENUE", ""),
            "dossier": str(dossier), "fichiers": [f["chemin"] for f in fichiers],
            "saisie": {k: saisie.get(k) for k in ("champs", "motifs", "surcharges")},
        }
        entrees = [entree] + self.lire()
        self._ecrire(entrees[:maximum])
        return entree

    def supprimer(self, ident: str):
        self._ecrire([e for e in self.lire() if e.get("id") != ident])

    def vider(self):
        self._ecrire([])
