"""Lecture, calcul et mise en forme des dates (format français)."""
from __future__ import annotations

import re
from datetime import date

MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
        "août", "septembre", "octobre", "novembre", "décembre"]


def lire_date(texte, siecle_passe: bool = False) -> date | None:
    """Convertit une saisie en date.

    Formats acceptés : 12/03/1985, 12/3/85, 12-03-1985, 12.03.1985,
    12031985, 120385, 1985-03-12. Retourne None si la saisie est vide ou invalide.
    ``siecle_passe`` : pour une année sur 2 chiffres, force le siècle passé si
    l'année obtenue serait dans le futur (dates de naissance).
    """
    if texte is None:
        return None
    if isinstance(texte, date):
        return texte
    s = str(texte).strip()
    if not s:
        return None
    m = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        a, mo, j = int(m.group(1)), int(m.group(2)), int(m.group(3))
    else:
        m = re.fullmatch(r"(\d{1,2})\s*[/.\- ]\s*(\d{1,2})\s*[/.\- ]\s*(\d{2}|\d{4})", s)
        if m:
            j, mo, a_txt = int(m.group(1)), int(m.group(2)), m.group(3)
        else:
            m = re.fullmatch(r"(\d{2})(\d{2})(\d{4}|\d{2})", s)
            if not m:
                return None
            j, mo, a_txt = int(m.group(1)), int(m.group(2)), m.group(3)
        a = int(a_txt)
        if len(a_txt) == 2:
            a += 2000
            if siecle_passe and a > date.today().year:
                a -= 100
    try:
        return date(a, mo, j)
    except ValueError:
        return None


def ajouter(d: date, annees: int = 0, mois: int = 0, jours: int = 0) -> date:
    """Ajoute des années, des mois puis des jours.

    « Jour pour jour » : le 29 février devient le 28 février si l'année
    d'arrivée n'est pas bissextile ; de même le 31 devient le dernier jour
    du mois quand ce jour n'existe pas.
    """
    from datetime import timedelta
    total_mois = d.month - 1 + mois
    a = d.year + annees + total_mois // 12
    mo = total_mois % 12 + 1
    j = d.day
    while True:
        try:
            resultat = date(a, mo, j)
            break
        except ValueError:
            j -= 1
    return resultat + timedelta(days=jours)


def age(naissance: date, reference: date) -> int:
    """Âge révolu à la date de référence."""
    ans = reference.year - naissance.year
    if (reference.month, reference.day) < (naissance.month, naissance.day):
        ans -= 1
    return ans


def formater(d: date, fmt: str = "jj/mm/aaaa") -> str:
    """Met une date en forme.

    Jetons : jj, j, mm, m, aaaa, aa, mois (novembre), MOIS (NOVEMBRE), Mois (Novembre).
    Tout autre caractère est recopié tel quel.
    """
    if d is None:
        return ""
    jetons = {
        "aaaa": f"{d.year:04d}",
        "aa": f"{d.year % 100:02d}",
        "jj": f"{d.day:02d}",
        "mm": f"{d.month:02d}",
        "MOIS": MOIS[d.month - 1].upper(),
        "Mois": MOIS[d.month - 1].capitalize(),
        "mois": MOIS[d.month - 1],
        "j": str(d.day),
        "m": str(d.month),
    }
    motif = re.compile("|".join(sorted(map(re.escape, jetons), key=len, reverse=True)))
    return motif.sub(lambda m: jetons[m.group(0)], fmt)
