"""Chargement, contrôle et enregistrement du paramétrage (config/config.json)."""
from __future__ import annotations

import copy
import json
import re
import shutil
from datetime import datetime
from pathlib import Path

from . import chemins

FICHIER = "config.json"


def defaut() -> dict:
    with open(chemins.dossier_ressources() / "defaut_config.json", encoding="utf-8") as f:
        return json.load(f)


def chemin_config(travail: Path) -> Path:
    return travail / "config" / FICHIER


def charger(travail: Path) -> dict:
    """Lit config/config.json ; le crée à partir des valeurs par défaut s'il manque."""
    p = chemin_config(travail)
    base = defaut()
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(base, ensure_ascii=False, indent=2), encoding="utf-8")
        return base
    with open(p, encoding="utf-8") as f:
        cfg = json.load(f)
    # complète les réglages généraux ajoutés dans une version plus récente
    for cle, valeur in base["general"].items():
        cfg.setdefault("general", {}).setdefault(cle, valeur)
    for cle in ("champs", "types_visite", "aptitudes", "fiches_axone", "certificats"):
        cfg.setdefault(cle, base[cle])
    return cfg


def controler(cfg: dict) -> list[str]:
    """Liste des erreurs bloquantes du paramétrage (vide si tout va bien)."""
    erreurs = []

    def uniques(liste, nom):
        vus = set()
        for el in liste:
            code = str(el.get("code") or el.get("cle") or "").strip()
            if not code:
                erreurs.append(f"{nom} : une ligne n'a pas de code.")
            elif code in vus:
                erreurs.append(f"{nom} : le code « {code} » est en double.")
            vus.add(code)
        return vus

    cles = uniques(cfg.get("champs", []), "Champs")
    for c in cfg.get("champs", []):
        if c.get("cle") and not re.fullmatch(r"[A-Z][A-Z0-9_]*", c["cle"]):
            erreurs.append(f"Champs : « {c['cle']} » doit être en MAJUSCULES sans espace ni accent (ex. DATE_TEST).")
        if c.get("type") not in ("texte", "date", "case", "nombre"):
            erreurs.append(f"Champs : type inconnu pour « {c.get('cle')} » (texte, date, case ou nombre).")
    reserves = {"DATE_RDV", "DATE_VQ", "AGE", "TYPE_VENUE"}
    for c in cles & reserves:
        erreurs.append(f"Champs : « {c} » est calculé par l'application, choisissez un autre code.")
    types = uniques(cfg.get("types_visite", []), "Types de visite")
    aptitudes = uniques(cfg.get("aptitudes", []), "Aptitudes")
    for t in cfg.get("types_visite", []):
        if t.get("calcul_vq") not in ("rdv", "saisie", "aucun"):
            erreurs.append(f"Types de visite : calcul de la VQ inconnu pour « {t.get('code')} ».")
        try:
            re.compile(t.get("cases") or "")
        except re.error as e:
            erreurs.append(f"Types de visite : motif de case invalide pour « {t.get('code')} » ({e}).")
    try:
        re.compile(cfg.get("general", {}).get("motif_case_aptitude") or "")
    except re.error as e:
        erreurs.append(f"Général : motif des cases d'aptitude invalide ({e}).")
    for nom, liste in (("Fiches AXONE", cfg.get("fiches_axone", [])), ("Certificats", cfg.get("certificats", []))):
        for i, r in enumerate(liste, start=1):
            if not str(r.get("modele", "")).strip():
                erreurs.append(f"{nom} : la ligne {i} n'indique pas de modèle.")
            for t in r.get("types", []):
                if t not in types:
                    erreurs.append(f"{nom} : ligne {i}, type de visite « {t} » inconnu.")
            for a in r.get("aptitudes", []):
                if a not in aptitudes:
                    erreurs.append(f"{nom} : ligne {i}, aptitude « {a} » inconnue.")
    return erreurs


def enregistrer(travail: Path, cfg: dict) -> Path:
    """Enregistre après contrôle, en gardant une copie datée de l'ancienne version."""
    erreurs = controler(cfg)
    if erreurs:
        raise ValueError("\n".join(erreurs))
    p = chemin_config(travail)
    p.parent.mkdir(parents=True, exist_ok=True)
    if p.exists():
        archives = p.parent / "anciennes_versions"
        archives.mkdir(exist_ok=True)
        shutil.copy2(p, archives / f"config_{datetime.now():%Y%m%d_%H%M%S}.json")
        anciennes = sorted(archives.glob("config_*.json"))
        for vieux in anciennes[:-30]:
            vieux.unlink(missing_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(p)
    return p


def copie(cfg: dict) -> dict:
    return copy.deepcopy(cfg)
