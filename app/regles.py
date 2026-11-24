"""Règles métier : âge, date de la prochaine VQ, type de venue, choix des documents."""
from __future__ import annotations

import re
from datetime import date
from pathlib import Path

from . import balises, dates
from .modeles import Inventaire

CLES_CALCULEES = {
    "DATE_RDV", "DATE_VQ", "AGE", "TYPE_VENUE", "TYPE_VISITE", "APTITUDE", "APTITUDE_LIBELLE",
    "VILLE", "NOM_SERVICE", "DATE_JOUR", "NOM_PRENOM", "IDENTITE",
}


def _alerte(liste, niveau, message):
    liste.append({"niveau": niveau, "message": message})


def _texte(v, transformation=None):
    s = "" if v is None else str(v).strip()
    s = re.sub(r"\s+", " ", s)
    if transformation == "maj":
        s = s.upper()
    elif transformation == "min":
        s = s.lower()
    elif transformation == "cap":
        s = balises.capitaliser(s)
    return s


def _vrai(v) -> bool:
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "oui", "vrai", "on", "x")
    return bool(v)


def lire_valeurs(cfg: dict, saisie: dict, alertes: list) -> dict:
    """Valeurs saisies, converties selon le type de chaque champ."""
    brut = saisie.get("champs", {}) or {}
    valeurs: dict = {}
    for c in cfg["champs"]:
        cle, v = c["cle"], brut.get(c["cle"])
        if c["type"] == "date":
            d = dates.lire_date(v, siecle_passe=(cle == "DATE_NAISSANCE"))
            if v not in (None, "") and d is None:
                _alerte(alertes, "erreur", f"{c['libelle']} : date illisible « {v} » (format jj/mm/aaaa).")
            valeurs[cle] = d
        elif c["type"] == "case":
            valeurs[cle] = _vrai(v)
        elif c["type"] == "nombre":
            s = _texte(v)
            valeurs[cle] = s
            if s and not re.fullmatch(r"-?\d+([.,]\d+)?", s):
                _alerte(alertes, "attention", f"{c['libelle']} : « {s} » n'est pas un nombre.")
        else:
            valeurs[cle] = _texte(v, c.get("transformation"))
    # champs libres demandés par un modèle mais non déclarés dans le paramétrage
    for cle, v in brut.items():
        if cle not in valeurs and cle not in CLES_CALCULEES and re.fullmatch(r"[A-Z][A-Z0-9_]*", cle):
            valeurs[cle] = _texte(v)
    return valeurs


def appliquer_defauts(cfg: dict, valeurs: dict):
    for c in cfg["champs"]:
        defaut = c.get("defaut")
        if defaut in (None, "") or valeurs.get(c["cle"]) not in (None, ""):
            continue
        if isinstance(defaut, str) and defaut.startswith("="):
            valeurs[c["cle"]] = valeurs.get(defaut[1:].strip().upper())
        elif c["type"] == "date":
            valeurs[c["cle"]] = dates.lire_date(defaut)
        elif c["type"] == "case":
            valeurs[c["cle"]] = _vrai(defaut)
        else:
            valeurs[c["cle"]] = _texte(defaut, c.get("transformation"))


def motifs_valides(cfg: dict, saisie: dict, alertes: list) -> list[dict]:
    types = {t["code"]: t for t in cfg["types_visite"]}
    apts = {a["code"]: a for a in cfg["aptitudes"]}
    motifs = []
    for i, m in enumerate(saisie.get("motifs", []) or [], start=1):
        t, a = (m.get("type") or "").strip(), (m.get("aptitude") or "").strip()
        if not t and not a:
            continue
        if t not in types:
            _alerte(alertes, "erreur", f"Motif {i} : choisissez le type de visite.")
            continue
        if not a and types[t].get("aptitude_requise", True):
            _alerte(alertes, "erreur", f"Motif {i} : choisissez l'aptitude.")
            continue
        if a and a not in apts:
            _alerte(alertes, "erreur", f"Motif {i} : aptitude « {a} » inconnue.")
            continue
        motifs.append({"type": t, "aptitude": a})
    return motifs


def aptitudes_par_type(cfg: dict) -> dict[str, list[str]]:
    """Aptitudes proposées pour chaque type : déduites des certificats et des fiches."""
    ordre = [a["code"] for a in cfg["aptitudes"]]
    resultat: dict[str, set] = {t["code"]: set() for t in cfg["types_visite"]}
    for liste in (cfg["certificats"], cfg["fiches_axone"]):
        for r in liste:
            for t in r.get("types", []):
                if t in resultat:
                    resultat[t].update(r.get("aptitudes", []))
    return {t: [a for a in ordre if a in s] for t, s in resultat.items()}


def date_vq(cfg: dict, motifs: list, rdv: date | None, surcharge, alertes: list):
    types = {t["code"]: t for t in cfg["types_visite"]}
    modes = [types[m["type"]].get("calcul_vq", "aucun") for m in motifs]
    auto, mode = None, "aucun"
    if "rdv" in modes:
        mode = "calcul"
        if rdv:
            auto = dates.ajouter(rdv, annees=int(cfg["general"].get("annees_vq", 4)))
    elif "saisie" in modes:
        mode = "saisie"
    valeur = auto
    if surcharge not in (None, ""):
        d = dates.lire_date(surcharge)
        if d is None:
            _alerte(alertes, "erreur", f"Prochaine VQ : date illisible « {surcharge} ».")
        else:
            valeur, mode = d, ("manuel" if mode != "saisie" else "saisie")
    if mode == "saisie" and valeur is None:
        _alerte(alertes, "attention", "Visite annuelle ou d'expertise : saisissez la date de la prochaine VQ "
                                      "déjà programmée (elle n'est pas recalculée).")
    return valeur, auto, mode


def type_venue(cfg: dict, motifs: list) -> str:
    types = {t["code"]: t for t in cfg["types_visite"]}
    apts = {a["code"]: a for a in cfg["aptitudes"]}
    morceaux = []
    for m in motifs:
        t = types[m["type"]].get("sigle") or m["type"]
        a = apts[m["aptitude"]].get("sigle") or m["aptitude"] if m.get("aptitude") else ""
        morceaux.append(f"{t} {a}".strip())
    return cfg["general"].get("separateur_types", " + ").join(morceaux)


# --------------------------------------------------------------------------- #
#  Choix des documents
# --------------------------------------------------------------------------- #
def _regle_axone(r: dict, motifs: list, valeurs: dict, age):
    """Retourne (correspond, raison_si_indecidable)."""
    types, apts = r.get("types") or [], r.get("aptitudes") or []
    if not any((not types or m["type"] in types) and (not apts or m.get("aptitude") in apts) for m in motifs):
        return False, None
    amin, amax = r.get("age_min"), r.get("age_max")
    if amin not in (None, "") or amax not in (None, ""):
        if age is None:
            return False, "age"
        if amin not in (None, "") and age < int(amin):
            return False, None
        if amax not in (None, "") and age > int(amax):
            return False, None
    for cle, attendu in (r.get("conditions") or {}).items():
        v = valeurs.get(cle)
        if isinstance(attendu, bool):
            if bool(v) != attendu:
                return False, None
        elif str(v or "").strip().upper() != str(attendu).strip().upper():
            return False, None
    return True, None


def choisir_axone(cfg: dict, motifs: list, valeurs: dict, age, alertes: list):
    if not motifs:
        return None
    meilleure, age_manquant = None, False
    for ordre, r in enumerate(cfg["fiches_axone"]):
        ok, raison = _regle_axone(r, motifs, valeurs, age)
        if raison == "age":
            age_manquant = True
        if ok and (meilleure is None or int(r.get("priorite", 0)) > int(meilleure.get("priorite", 0))):
            meilleure = r
    if age_manquant and (meilleure is None or meilleure.get("a_verifier")):
        _alerte(alertes, "attention", "Renseignez la date de naissance : la fiche navette dépend de l'âge.")
    return meilleure


def choisir_certificats(cfg: dict, motifs: list, alertes: list):
    apts = {a["code"]: a for a in cfg["aptitudes"]}
    types = {t["code"]: t for t in cfg["types_visite"]}
    restants = list(range(len(motifs)))
    choisis = []
    entrees = sorted(enumerate(cfg["certificats"]), key=lambda e: (-len(e[1].get("aptitudes", [])), e[0]))
    for _, e in entrees:
        voulues = e.get("aptitudes", [])
        if not voulues:
            continue
        pris = []
        for a in voulues:
            i = next((i for i in restants if i not in pris and motifs[i].get("aptitude") == a
                      and motifs[i]["type"] in e.get("types", [])), None)
            if i is None:
                break
            pris.append(i)
        if len(pris) == len(voulues):
            choisis.append((e, [motifs[i] for i in pris]))
            restants = [i for i in restants if i not in pris]
    for i in restants:
        m = motifs[i]
        apt = apts.get(m.get("aptitude"), {})
        if apt.get("sans_certificat") or not types[m["type"]].get("aptitude_requise", True):
            continue
        _alerte(alertes, "attention",
                f"Aucun certificat paramétré pour {types[m['type']].get('sigle', m['type'])} "
                f"{apt.get('sigle', m.get('aptitude'))}. Ajoutez-le dans Paramètres › Certificats.")
    return choisis


def _doc(categorie, modele, titre, inventaire: Inventaire, types, regle=None):
    chemin = inventaire.trouver(modele) if modele else None
    return {
        "cle": f"{categorie}:{modele}",
        "categorie": categorie,
        "modele": modele,
        "chemin": chemin,
        "existe": chemin is not None,
        "titre": titre or Path(modele).stem,
        "types": types,
        "a_verifier": bool(regle and regle.get("a_verifier")),
        "note": (regle or {}).get("note", ""),
    }


# --------------------------------------------------------------------------- #
#  Calcul complet d'une visite
# --------------------------------------------------------------------------- #
def calculer(cfg: dict, saisie: dict, inventaire: Inventaire) -> dict:
    g = cfg["general"]
    alertes: list = []
    valeurs = lire_valeurs(cfg, saisie, alertes)
    brut = saisie.get("champs", {}) or {}
    rdv = dates.lire_date(brut.get("DATE_RDV"))
    if not rdv:
        _alerte(alertes, "erreur", "Date du rendez-vous manquante ou illisible.")
    valeurs["DATE_RDV"] = rdv
    appliquer_defauts(cfg, valeurs)

    ddn = valeurs.get("DATE_NAISSANCE")
    age = dates.age(ddn, rdv) if ddn and rdv else None
    if age is not None and not 14 <= age <= 75:
        _alerte(alertes, "attention", f"Âge calculé inhabituel : {age} ans. Vérifiez la date de naissance.")
    valeurs["AGE"] = "" if age is None else age

    motifs = motifs_valides(cfg, saisie, alertes)
    if not motifs:
        _alerte(alertes, "erreur", "Choisissez au moins un type de visite.")
    surcharges = saisie.get("surcharges", {}) or {}
    vq, vq_auto, mode_vq = date_vq(cfg, motifs, rdv, surcharges.get("DATE_VQ"), alertes)
    valeurs["DATE_VQ"] = vq
    tv_auto = type_venue(cfg, motifs)
    valeurs["TYPE_VENUE"] = (surcharges.get("TYPE_VENUE") or "").strip() or tv_auto

    types = {t["code"]: t for t in cfg["types_visite"]}
    apts = {a["code"]: a for a in cfg["aptitudes"]}
    sep = g.get("separateur_types", " + ")
    valeurs["TYPE_VISITE"] = sep.join(dict.fromkeys(types[m["type"]].get("sigle", m["type"]) for m in motifs))
    valeurs["APTITUDE"] = sep.join(apts[m["aptitude"]].get("sigle", m["aptitude"]) for m in motifs if m["aptitude"])
    valeurs["APTITUDE_LIBELLE"] = sep.join(apts[m["aptitude"]].get("libelle", m["aptitude"]) for m in motifs if m["aptitude"])
    valeurs["VILLE"] = g.get("ville", "")
    valeurs["NOM_SERVICE"] = g.get("nom_service", "")
    valeurs["DATE_JOUR"] = date.today()
    nom, prenom = valeurs.get("NOM", ""), valeurs.get("PRENOM", "")
    valeurs["NOM_PRENOM"] = f"{nom} {prenom}".strip()
    ligne_ddn = f"Né(e) le {dates.formater(ddn, g.get('format_date', 'jj/mm/aaaa'))}" if ddn else ""
    valeurs["IDENTITE"] = "\n".join(x for x in (valeurs["NOM_PRENOM"], ligne_ddn) if x)

    # documents proposés automatiquement
    documents = []
    regle = choisir_axone(cfg, motifs, valeurs, age, alertes)
    if regle:
        documents.append(_doc("axone", regle["modele"], regle.get("titre"), inventaire,
                              [m["type"] for m in motifs], regle))
    for entree, couverts in choisir_certificats(cfg, motifs, alertes):
        documents.append(_doc("certificat", entree["modele"], entree.get("titre"), inventaire,
                              [m["type"] for m in couverts], entree))
    # choix manuels de l'utilisateur
    exclus = set(saisie.get("documents_exclus", []) or [])
    for d in documents:
        d["inclus"] = d["cle"] not in exclus
    for rel in saisie.get("documents_ajoutes", []) or []:
        cle = f"ajout:{rel}"
        if any(d["cle"] == cle or d["chemin"] == rel for d in documents):
            continue
        d = _doc("ajout", rel, None, inventaire, [m["type"] for m in motifs])
        d["cle"], d["inclus"] = cle, cle not in exclus
        documents.append(d)

    for d in documents:
        if d["inclus"] and not d["existe"]:
            _alerte(alertes, "erreur", f"Modèle introuvable : « {d['modele']} ». Importez vos modèles "
                                       "(Paramètres › Modèles) ou corrigez le chemin.")
        if d["inclus"] and d["a_verifier"]:
            _alerte(alertes, "info", f"{d['titre']} : règle à vérifier. {d['note']}".strip())

    # champs complémentaires à afficher
    def_champs = {c["cle"]: c for c in cfg["champs"]}
    utilisees: dict[str, list[str]] = {}
    for d in documents:
        if d["inclus"] and d["existe"]:
            for cle in inventaire.balises(d["chemin"]):
                utilisees.setdefault(cle, []).append(d["titre"])
    aptitudes_choisies = {m["aptitude"] for m in motifs}
    visibles = []
    for c in cfg["champs"]:
        if c.get("section") != "complement":
            continue
        if c["cle"] in utilisees or aptitudes_choisies & set(c.get("afficher_si_aptitudes") or []):
            visibles.append(c["cle"])
    inconnus = [{"cle": k, "documents": v} for k, v in utilisees.items()
                if k not in def_champs and k not in CLES_CALCULEES]

    # champs obligatoires
    for c in cfg["champs"]:
        if c.get("obligatoire") and (c.get("section") != "complement" or c["cle"] in visibles):
            if valeurs.get(c["cle"]) in (None, ""):
                _alerte(alertes, "erreur", f"Champ obligatoire : {c['libelle']}.")
    if not any(d["inclus"] for d in documents) and motifs:
        _alerte(alertes, "erreur", "Aucun document à générer.")

    return {
        "valeurs": valeurs,
        "affichage": {k: _affichable(v, g.get("format_date", "jj/mm/aaaa")) for k, v in valeurs.items()},
        "age": age,
        "motifs": motifs,
        "vq": {"valeur": _affichable(vq), "auto": _affichable(vq_auto), "mode": mode_vq},
        "type_venue": {"valeur": valeurs["TYPE_VENUE"], "auto": tv_auto},
        "documents": documents,
        "champs_visibles": visibles,
        "champs_inconnus": inconnus,
        "alertes": alertes,
        "bloquant": any(a["niveau"] == "erreur" for a in alertes),
    }


def _affichable(v, fmt="jj/mm/aaaa"):
    if isinstance(v, date):
        return dates.formater(v, fmt)
    return v
