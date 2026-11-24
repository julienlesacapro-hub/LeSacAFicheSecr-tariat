"""Assistant d'import : transforme les documents d'origine du service en modèles.

1. copie l'arborescence source dans le dossier des modèles ;
2. convertit les .doc en .docx (Word, sinon LibreOffice) ;
3. pose les balises {{…}} aux emplacements reconnus :
   * certificats : champs de formulaire après « NOM : », « Prénom : »,
     « Date de naissance : », « Grade : », « Identifiant défense : », « VMP : »,
     « à … le », « avant fin … / … » ;
   * fiches navette : texte après « Fiche n° », « Prochaine VQ : », « Grade : »,
     « Matricule : », « Affectation : », « Type de visite : », « AGE: »,
     dates du test psy et du caisson, encart « ETIQUETTE AMADEUS ».
   Les valeurs d'un ancien patient restées dans les fiches sont remplacées.
4. rend un rapport fichier par fichier.
Le grisé, la mise en page et les cases réservées au médecin ne sont pas modifiés.
"""
from __future__ import annotations

import re
import shutil
from datetime import datetime
from pathlib import Path

from . import docx_moteur, systeme
from .docx_moteur import TexteParagraphe, normaliser

# (motif sur la dernière ligne du texte qui précède le champ, balises successives)
REGLES_CHAMPS = [
    (re.compile(r"\bNOM\s*:?\s*$"), ["NOM"]),
    (re.compile(r"Pr[ée]nom\s*:?\s*$", re.I), ["PRENOM"]),
    (re.compile(r"Date de naissance\s*:?\s*$", re.I), ["DATE_NAISSANCE:jj", "DATE_NAISSANCE:mm", "DATE_NAISSANCE:aaaa"]),
    (re.compile(r"\bGrade\s*:?\s*$", re.I), ["GRADE"]),
    (re.compile(r"Identifiant d[ée]fense\s*:?\s*$", re.I), ["MATRICULE"]),
    (re.compile(r"\bVMP\s*:?\s*$"), ["DATE_RDV"]),
    (re.compile(r"^\s*à\s+\S.*\ble\s*$", re.I), ["DATE_RDV"]),
    (re.compile(r"avant fin\s*$", re.I), ["DATE_VQ:mm", "DATE_VQ:aaaa"]),
]

FIN = r"(?=\s{3,}|\t|\n|$)"
REGLES_TEXTE = [
    ("DOSSIER", re.compile(r"(Fiche\s*n°\s?)(?P<v>[^\t\n]*?)(?=\s{3,}|\t|\n|Prochaine|$)"), "{{DOSSIER}}"),
    ("DATE_VQ", re.compile(r"(Prochaine\s+VQ\s*:\s?)(?P<v>\d{1,2}\s*/\s*\d{1,2}\s*/\s*\d{2,4})?"), "{{DATE_VQ:jj/mm/aa}}"),
    ("GRADE", re.compile(r"(Grade\s*:\s?)(?P<v>.*?)(?=\s{3,}|\t|\n|Matricule|Affectation|Type de visite|$)"), "{{GRADE}}"),
    ("MATRICULE", re.compile(r"(Matricule\s*:\s?)(?P<v>.*?)(?=\s{3,}|\t|\n|Affectation|Type de visite|$)"), "{{MATRICULE}}"),
    ("AFFECTATION", re.compile(r"(Affectation\s*:\s?)(?P<v>.*?)(?=\s{3,}|\t|\n|Type de visite|$)"), "{{AFFECTATION}}"),
    ("TYPE_VENUE", re.compile(r"(Type de visite\s*:\s?)(?P<v>.*?)" + FIN), "{{TYPE_VENUE}}"),
    ("AGE", re.compile(r"(\bAGE\s*:\s?)(?P<v>\d+\s*(?:ans)?)?"), "{{AGE}} ans"),
    ("DATE_TEST_PSY", re.compile(r"(TEST PSY\s+)(?P<v>\d{1,2}\s*/\s*\d{1,2}\s*/\s*\d{2,4})"), "{{DATE_TEST_PSY:jj/mm/aa}}"),
    ("DATE_CAISSON", re.compile(r"(CAISSON\s+)(?P<v>\d{1,2}\s*/\s*\d{1,2}\s*/\s*\d{2,4})"), "{{DATE_CAISSON:jj/mm/aa}}"),
    ("IDENTITE", re.compile(r"()(?P<v>ETIQUETTE\s+AMADEUS)"), "{{IDENTITE}}"),
]


def baliser_champs(doc: docx_moteur.DocumentWord) -> tuple[list[str], list[str], int]:
    """Balise les champs de formulaire. Retourne (balises posées, remarques, nb champs texte libres)."""
    posees, remarques, libres = [], [], 0
    for racine in doc.racines():
        attente = None  # (balises restantes) pour « jj / mm / aaaa »
        for champ in docx_moteur.champs_formulaire(racine):
            if champ.genre != "texte":
                attente = None
                continue
            avant = champ.texte_avant
            derniere_ligne = avant.split("\n")[-1]
            balise = None
            if attente and normaliser(avant) == "/":
                balise = attente.pop(0)
                attente = attente or None
            else:
                attente = None
                for motif, suite in REGLES_CHAMPS:
                    if motif.search(normaliser(derniere_ligne)) or motif.search(derniere_ligne.rstrip("   ")):
                        balise, attente = suite[0], (list(suite[1:]) or None)
                        break
            if balise is None:
                libres += 1
                continue
            if "{{" in champ.resultat:
                posees.append(balise.split(":")[0])
                continue
            if not champ.est_vide:
                remarques.append(f"Champ « {balise.split(':')[0]} » déjà rempli (« {normaliser(champ.resultat)} ») : conservé.")
                continue
            champ.definir_texte("{{" + balise + "}}")
            posees.append(balise.split(":")[0])
    return posees, remarques, libres


def baliser_texte(doc: docx_moteur.DocumentWord, remplacer_etiquette=True) -> list[str]:
    """Balise les fiches navette (texte libre) et efface les données d'un ancien patient."""
    posees = []
    for racine in doc.racines():
        for p in docx_moteur.paragraphes(racine):
            for nom, motif, balise in REGLES_TEXTE:
                if nom == "IDENTITE" and not remplacer_etiquette:
                    continue
                for _ in range(10):
                    tp = TexteParagraphe(p)
                    cible = None
                    for m in motif.finditer(tp.texte):
                        v = m.group("v") or ""
                        apres = tp.texte[m.end(1):]
                        if v.startswith("{{") or apres.lstrip(" ").startswith("{{"):
                            continue
                        cible = m
                        break
                    if cible is None:
                        break
                    debut, fin = cible.start("v"), cible.end("v")
                    if debut < 0:  # groupe facultatif absent : insertion après le libellé
                        debut = fin = cible.end(1)
                    if tp.remplacer(debut, fin, balise):
                        posees.append(nom)
                    else:
                        break
    return posees


def preparer(chemin: Path, remplacer_etiquette=True) -> dict:
    """Pose les balises dans un .docx et l'enregistre à la même place."""
    doc = docx_moteur.DocumentWord(chemin)
    a_des_champs = any(c.genre == "texte" for r in doc.racines() for c in docx_moteur.champs_formulaire(r))
    remarques, infos = [], []
    if a_des_champs:
        posees, remarques, libres = baliser_champs(doc)
        genre = "certificat"
        if libres:
            infos.append(f"{libres} champ(s) de formulaire laissé(s) au médecin.")
        manquantes = [c for c in ("NOM", "PRENOM", "DATE_NAISSANCE") if c not in posees]
        if manquantes:
            remarques.append("Emplacement non trouvé pour : " + ", ".join(manquantes) + ". Ajoutez la balise à la main.")
    else:
        posees = baliser_texte(doc, remplacer_etiquette)
        genre = "fiche"
        if "IDENTITE" not in posees and not {"NOM", "IDENTITE"} & set(docx_moteur.lister_balises(doc)):
            remarques.append("Pas d'encart « ETIQUETTE AMADEUS » : nom, prénom et date de naissance ne seront pas "
                             "imprimés. Ajoutez {{IDENTITE}} (ou {{NOM}} {{PRENOM}}) à l'endroit voulu si besoin.")
        if "DOSSIER" not in posees:
            remarques.append("« Fiche n° » introuvable : numéro de dossier non placé.")
    doc.enregistrer(chemin)
    return {"genre": genre, "balises": sorted(set(posees)), "remarques": remarques, "infos": infos}


def importer(source: Path, destination: Path, remplacer_etiquette=True, journal=None) -> dict:
    """Importe tous les .doc/.docx de ``source`` (sous-dossiers compris) vers ``destination``."""
    source, destination = Path(source), Path(destination)
    if not source.is_dir():
        raise FileNotFoundError(f"Dossier introuvable : {source}")
    if source.resolve() == destination.resolve():
        raise ValueError("Choisissez le dossier qui contient vos documents d'origine, pas le dossier des modèles.")
    fichiers = [p for p in sorted(source.rglob("*"))
                if p.is_file() and p.suffix.lower() in (".doc", ".docx", ".dot", ".dotx")
                and not p.name.startswith("~$") and destination.resolve() not in p.resolve().parents]
    if not fichiers:
        raise FileNotFoundError("Aucun document Word (.doc ou .docx) dans ce dossier.")
    horodatage = datetime.now().strftime("%Y%m%d_%H%M%S")
    sauvegarde = destination / "_sauvegardes" / horodatage
    rapport, a_convertir = [], []
    for p in fichiers:
        rel = p.relative_to(source)
        cible = destination / rel.with_suffix(".docx")
        if cible.exists():
            (sauvegarde / rel.parent).mkdir(parents=True, exist_ok=True)
            shutil.copy2(cible, sauvegarde / rel.with_suffix(".docx"))
        cible.parent.mkdir(parents=True, exist_ok=True)
        entree = {"fichier": rel.as_posix(), "modele": rel.with_suffix(".docx").as_posix(), "statut": "ok",
                  "conversion": "", "balises": [], "remarques": []}
        if p.suffix.lower() in (".doc", ".dot"):
            a_convertir.append((p, cible, entree))
        else:
            shutil.copy2(p, cible)
        rapport.append(entree)
    if a_convertir:
        try:
            resultats, moteur = systeme.convertir_doc([(s, c) for s, c, _ in a_convertir])
        except RuntimeError as e:
            resultats, moteur = {str(s): str(e) for s, _, _ in a_convertir}, ""
        for s, _, entree in a_convertir:
            erreur = resultats.get(str(s), "non converti")
            if erreur:
                entree["statut"], entree["remarques"] = "erreur", [f"Conversion impossible : {erreur}"]
            else:
                entree["conversion"] = moteur
    for entree in rapport:
        if entree["statut"] != "ok":
            continue
        try:
            infos = preparer(destination / entree["modele"], remplacer_etiquette)
            entree.update(genre=infos["genre"], balises=infos["balises"])
            entree["remarques"] += infos["remarques"]
            entree["infos"] = infos["infos"]
            if not infos["balises"]:
                entree["statut"] = "attention"
            elif infos["remarques"]:
                entree["statut"] = "attention"
        except Exception as e:  # noqa: BLE001
            entree["statut"] = "erreur"
            entree["remarques"].append(f"Préparation impossible : {e}")
        if journal:
            journal(entree)
    return {
        "source": str(source), "destination": str(destination),
        "sauvegarde": str(sauvegarde) if sauvegarde.exists() else None,
        "fichiers": rapport,
        "totaux": {s: sum(1 for e in rapport if e["statut"] == s) for s in ("ok", "attention", "erreur")},
    }
