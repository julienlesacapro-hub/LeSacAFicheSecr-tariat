"""Fabrique de documents de test reproduisant la structure des modèles du service.

* certificat : champs de formulaire hérités (FORMTEXT / FORMCHECKBOX) comme dans
  les .doc d'origine, tableau « En vue de déterminer », ligne « avant fin  /  ».
* fiche AXONE : données d'un ancien patient en gras-italique découpées caractère
  par caractère, examens grisés, encart « ETIQUETTE AMADEUS ».
"""
from __future__ import annotations

from docx import Document
from docx.oxml.ns import qn
from lxml import etree

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
ESPACES = " " * 5
_compteur = {"texte": 0, "case": 0}


def _run(texte=None, gras=False, italique=False):
    r = etree.Element(qn("w:r"))
    if gras or italique:
        rpr = etree.SubElement(r, qn("w:rPr"))
        if gras:
            etree.SubElement(rpr, qn("w:b"))
        if italique:
            etree.SubElement(rpr, qn("w:i"))
    if texte is not None:
        t = etree.SubElement(r, qn("w:t"))
        t.text = texte
        t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    return r


def _fld(typ, ffdata=None):
    r = etree.Element(qn("w:r"))
    fc = etree.SubElement(r, qn("w:fldChar"))
    fc.set(qn("w:fldCharType"), typ)
    if ffdata is not None:
        fc.append(ffdata)
    return r


def _instr(code):
    r = etree.Element(qn("w:r"))
    it = etree.SubElement(r, qn("w:instrText"))
    it.text = f" {code} "
    it.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    return r


def champ_texte(defaut=ESPACES):
    _compteur["texte"] += 1
    ff = etree.Element(qn("w:ffData"))
    etree.SubElement(ff, qn("w:name")).set(qn("w:val"), f"Texte{_compteur['texte']}")
    etree.SubElement(ff, qn("w:enabled"))
    etree.SubElement(ff, qn("w:calcOnExit")).set(qn("w:val"), "0")
    etree.SubElement(ff, qn("w:textInput"))
    return [_fld("begin", ff), _instr("FORMTEXT"), _fld("separate"), _run(defaut), _fld("end")]


def case():
    _compteur["case"] += 1
    ff = etree.Element(qn("w:ffData"))
    etree.SubElement(ff, qn("w:name")).set(qn("w:val"), f"CaseACocher{_compteur['case']}")
    etree.SubElement(ff, qn("w:enabled"))
    etree.SubElement(ff, qn("w:calcOnExit")).set(qn("w:val"), "0")
    cb = etree.SubElement(ff, qn("w:checkBox"))
    etree.SubElement(cb, qn("w:sizeAuto"))
    etree.SubElement(cb, qn("w:default")).set(qn("w:val"), "0")
    return [_fld("begin", ff), _instr("FORMCHECKBOX"), _fld("end")]


def _ajouter(paragraphe, *morceaux):
    p = paragraphe._p
    for m in morceaux:
        if isinstance(m, str):
            if m == "\t":
                r = etree.Element(qn("w:r"))
                etree.SubElement(r, qn("w:tab"))
                p.append(r)
            elif m == "\n":
                r = etree.Element(qn("w:r"))
                etree.SubElement(r, qn("w:br"))
                p.append(r)
            else:
                p.append(_run(m))
        else:
            for r in m:
                p.append(r)


def _griser(cellule, couleur="BFBFBF"):
    tcpr = cellule._tc.get_or_add_tcPr()
    shd = etree.SubElement(tcpr, qn("w:shd"))
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), couleur)


def certificat(chemin, lignes_aptitude, grade_fixe=None):
    doc = Document()
    p = doc.add_paragraph()
    _ajouter(p, "CERTIFICAT MÉDICO-ADMINISTRATIF D’APTITUDE ")
    doc.add_paragraph("(Durée de validité : deux ans sauf mention contraire)")
    t = doc.add_table(rows=3, cols=2)
    _ajouter(t.cell(0, 0).paragraphs[0], "NOM : ", champ_texte())
    _ajouter(t.cell(0, 1).paragraphs[0], "Prénom : ", champ_texte())
    _ajouter(t.cell(1, 0).paragraphs[0], "Date de naissance : ", champ_texte("  "), "/", champ_texte("  "), "/",
             champ_texte("    "))
    if grade_fixe:
        _ajouter(t.cell(1, 1).paragraphs[0], f"Grade : {grade_fixe}")
    else:
        _ajouter(t.cell(1, 1).paragraphs[0], "Grade : ", champ_texte())
    _ajouter(t.cell(2, 0).paragraphs[0], "Spécialité ou qualification : ", champ_texte())
    _ajouter(t.cell(2, 1).paragraphs[0], "Identifiant défense : ", champ_texte())
    t2 = doc.add_table(rows=1, cols=2)
    _ajouter(t2.cell(0, 0).paragraphs[0], "Date de réalisation de la")
    _ajouter(t2.cell(0, 0).add_paragraph(), "VMP : ", champ_texte())
    _ajouter(t2.cell(0, 1).paragraphs[0], "Adressé par (1) : ", champ_texte())
    doc.add_paragraph("En vue de déterminer :(2)")
    lignes = ["l’aptitude générale au service (4 et 5)", "l’aptitude aux opérations extérieures (7)"] + lignes_aptitude
    t3 = doc.add_table(rows=len(lignes) + 1, cols=3)
    t3.cell(0, 1).text, t3.cell(0, 2).text = "Conclusion", "Durée (3)"
    for i, libelle in enumerate(lignes, start=1):
        _ajouter(t3.cell(i, 0).paragraphs[0], case(), " " + libelle + " ")
        _ajouter(t3.cell(i, 1).paragraphs[0], champ_texte())
        _ajouter(t3.cell(i, 2).paragraphs[0], champ_texte())
    p = doc.add_paragraph()
    _ajouter(p, "En conclusion : l'intéressé est ")
    for libelle in ("apte à servir", "inapte temporaire à servir"):
        _ajouter(doc.add_paragraph(), case(), " " + libelle)
    _ajouter(doc.add_paragraph(), "Restrictions ou commentaires : ", champ_texte())
    _ajouter(doc.add_paragraph(), "à TOULON", "\t", "le ", champ_texte())
    _ajouter(doc.add_paragraph(), "La prochaine visite médicale doit avoir lieu ", "\n", "avant fin ",
             champ_texte("  "), " / ", champ_texte("    "), " (mois / année).", "\t", "(12)")
    doc.save(chemin)


def fiche_axone(chemin, examens_grises, ancien=True, etiquette=True):
    doc = Document()
    p = doc.add_paragraph()
    _ajouter(p, "Fiche n° ")
    if ancien:
        for c in "9732":
            p._p.append(_run(c, gras=True, italique=True))
    _ajouter(p, "                                    Prochaine VQ : ")
    if ancien:
        for c in "19/11/30":
            p._p.append(_run(c, gras=True, italique=True))
    t = doc.add_table(rows=1, cols=2)
    c = t.cell(0, 0)
    c.paragraphs[0].text = "SERVICE DE MEDECINE HYPERBARE ET D’EXPERTISE PLONGEE"
    if etiquette:
        c.add_paragraph("ETIQUETTE AMADEUS")
    for libelle, valeur in (("Grade", "CC"), ("Matricule", "2009…58"), ("Affectation", "FLOPHIB"),
                            ("Type de visite", "VQ NC")):
        par = c.add_paragraph()
        _ajouter(par, "                                   " + libelle + " : ")
        if ancien:
            par._p.append(_run(valeur))
    c.add_paragraph("BIOMETRIE : Poids :      TA :      Taille :")
    par = c.add_paragraph()
    _ajouter(par, "BILAN PARAMEDICAL : AGE:               ")
    examens = ["ECG", "SCANNER PULM", "PANOREX", "DENTISTE", "BS", "AUDIO", "OPH", "EFR", "EEG", "TEST PSY", "CAISSON"]
    te = c.add_table(rows=1, cols=len(examens))
    for i, ex in enumerate(examens):
        cell = te.cell(0, i)
        texte = ex + (" 09/11/26" if ancien and ex in ("TEST PSY", "CAISSON") else "")
        cell.text = texte
        if ex in examens_grises:
            _griser(cell)
    t.cell(0, 1).text = "COMMENTAIRES : Scanner Pulmonaire Sans Injection : ☐ CONCLUSION D’APTITUDE :"
    doc.save(chemin)
