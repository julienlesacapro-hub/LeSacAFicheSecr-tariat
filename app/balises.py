"""Grammaire des balises placées dans les modèles Word.

Syntaxe :  {{CLE}}  {{CLE:format}}  {{CLE+1a:format}}  {{CLE|maj}}

* CLE      : nom du champ en majuscules (NOM, PRENOM, DATE_RDV…)
* +Na/+Nm/+Nj : décalage d'une date en années / mois / jours (ex. DATE_RDV+1a)
* :format  : mise en forme d'une date (jj/mm/aaaa, jj/mm/aa, mm, aaaa, mois…)
* |filtre  : maj (MAJUSCULES), min (minuscules), cap (Première lettre), x (case : « X » si vrai)
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

from . import dates

MOTIF = re.compile(
    r"\{\{\s*(?P<cle>[A-Za-z][A-Za-z0-9_]*)"
    r"(?P<decalage>(?:\s*[+-]\s*\d+\s*[ajmAJM])*)"
    r"\s*(?::(?P<format>[^|{}]*?))?"
    r"\s*(?P<filtres>(?:\|\s*[A-Za-z]+\s*)*)\}\}"
)
DECALAGE = re.compile(r"([+-])\s*(\d+)\s*([ajmAJM])")


@dataclass
class Balise:
    brut: str
    cle: str
    decalages: list = field(default_factory=list)
    format: str | None = None
    filtres: list = field(default_factory=list)


def analyser(texte: str) -> Balise | None:
    m = MOTIF.fullmatch(texte.strip())
    if not m:
        return None
    return _depuis_match(m)


def _depuis_match(m: re.Match) -> Balise:
    decalages = [(signe, int(n), unite.lower()) for signe, n, unite in DECALAGE.findall(m.group("decalage") or "")]
    filtres = [f.strip().lower() for f in (m.group("filtres") or "").split("|") if f.strip()]
    fmt = m.group("format")
    return Balise(brut=m.group(0), cle=m.group("cle").upper(), decalages=decalages,
                  format=fmt.strip() if fmt and fmt.strip() else None, filtres=filtres)


def trouver(texte: str):
    """Itère sur les balises d'un texte : (début, fin, Balise)."""
    for m in MOTIF.finditer(texte):
        yield m.start(), m.end(), _depuis_match(m)


def cles(texte: str) -> set[str]:
    return {b.cle for _, _, b in trouver(texte)}


def resoudre(b: Balise, valeurs: dict, format_date_defaut: str = "jj/mm/aaaa") -> tuple[str, bool]:
    """Retourne (texte, connue). ``connue`` est faux si la clé n'existe pas."""
    if b.cle not in valeurs:
        return "", False
    v = valeurs[b.cle]
    if isinstance(v, date):
        for signe, n, unite in b.decalages:
            n = n if signe == "+" else -n
            v = dates.ajouter(v, annees=n if unite == "a" else 0,
                              mois=n if unite == "m" else 0,
                              jours=n if unite == "j" else 0)
        texte = dates.formater(v, b.format or format_date_defaut)
    elif isinstance(v, bool):
        if "x" in b.filtres:
            texte = "X" if v else ""
        else:
            texte = "Oui" if v else "Non"
    elif v is None:
        texte = ""
    else:
        texte = str(v)
    for f in b.filtres:
        if f == "maj":
            texte = texte.upper()
        elif f == "min":
            texte = texte.lower()
        elif f == "cap":
            texte = capitaliser(texte)
    return texte, True


def capitaliser(texte: str) -> str:
    """« jean-pierre de la tour » → « Jean-Pierre De La Tour »."""
    return re.sub(r"[^\W\d_]+", lambda m: m.group(0)[0].upper() + m.group(0)[1:].lower(), texte)
