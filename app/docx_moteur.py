"""Lecture et modification des fichiers Word (.docx) sans dépendre de Word.

Le moteur travaille directement sur le XML du document (lxml) :
* remplacement des balises {{…}} même quand Word les a découpées en plusieurs « runs » ;
* lecture et remplissage des champs de formulaire hérités (FORMTEXT, FORMCHECKBOX)
  présents dans les certificats issus de fichiers .doc ;
* parcours du corps, des en-têtes, des pieds de page et des zones de texte.
La mise en forme (gras, grisé, tableaux, logos) n'est jamais touchée.
"""
from __future__ import annotations

import re
import shutil
import tempfile
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from lxml import etree

from . import balises

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
XML_NS = "http://www.w3.org/XML/1998/namespace"


def w(tag: str) -> str:
    return f"{{{W_NS}}}{tag}"


W_P, W_R, W_T, W_TAB, W_BR, W_CR = w("p"), w("r"), w("t"), w("tab"), w("br"), w("cr")
W_FLDCHAR, W_INSTR, W_FFDATA = w("fldChar"), w("instrText"), w("ffData")
W_TYPE = w("fldCharType")
PARTIES = re.compile(r"^word/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$")
ESPACES_VIDES = "    \t\r\n​"


# --------------------------------------------------------------------------- #
#  Ouverture / enregistrement
# --------------------------------------------------------------------------- #
class DocumentWord:
    """Un .docx ouvert en mémoire : parties XML modifiables + reste du paquet intact."""

    def __init__(self, chemin: str | Path):
        self.chemin = Path(chemin)
        self.parties: dict[str, etree._Element] = {}
        with zipfile.ZipFile(self.chemin) as z:
            self._infos = z.infolist()
            self._contenu = {i.filename: z.read(i.filename) for i in self._infos}
        parseur = etree.XMLParser(remove_blank_text=False, resolve_entities=False, huge_tree=True)
        for nom, octets in self._contenu.items():
            if PARTIES.match(nom):
                self.parties[nom] = etree.fromstring(octets, parseur)
        if "word/document.xml" not in self.parties:
            raise ValueError(f"{self.chemin.name} n'est pas un document Word valide")

    def racines(self):
        # le corps d'abord, puis en-têtes et pieds de page
        ordre = sorted(self.parties, key=lambda n: (n != "word/document.xml", n))
        return [self.parties[n] for n in ordre]

    def enregistrer(self, destination: str | Path):
        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".docx", dir=destination.parent)
        tmp.close()
        try:
            with zipfile.ZipFile(tmp.name, "w", zipfile.ZIP_DEFLATED) as z:
                for info in self._infos:
                    if info.filename in self.parties:
                        donnees = etree.tostring(self.parties[info.filename], xml_declaration=True,
                                                 encoding="UTF-8", standalone=True)
                    else:
                        donnees = self._contenu[info.filename]
                    z.writestr(info, donnees, compress_type=zipfile.ZIP_DEFLATED)
            shutil.move(tmp.name, destination)
        finally:
            Path(tmp.name).unlink(missing_ok=True)

    def protection_parametres(self) -> str | None:
        """Type de protection du document (« forms », « readOnly »…) s'il y en a une."""
        reglages = self._contenu.get("word/settings.xml")
        if not reglages:
            return None
        m = re.search(rb'<w:documentProtection[^>]*w:edit="(\w+)"[^>]*w:enforcement="(1|true|on)"', reglages)
        return m.group(1).decode() if m else None


# --------------------------------------------------------------------------- #
#  Texte d'un paragraphe, avec remplacement tolérant au découpage en runs
# --------------------------------------------------------------------------- #
def paragraphe_proche(el):
    for anc in el.iterancestors(W_P):
        return anc
    return None


def runs_du_paragraphe(p):
    return [r for r in p.iter(W_R) if paragraphe_proche(r) is p]


def _preserver(t):
    t.set(f"{{{XML_NS}}}space", "preserve")


class TexteParagraphe:
    """Texte « à plat » d'un paragraphe et correspondance vers les éléments w:t."""

    def __init__(self, p):
        self.p = p
        self.segments = []  # (element, genre, debut, fin) genre : 't' texte, 'x' tabulation/saut
        morceaux, pos = [], 0
        for r in runs_du_paragraphe(p):
            for enfant in r:
                if enfant.tag == W_T:
                    s = enfant.text or ""
                    self.segments.append((enfant, "t", pos, pos + len(s)))
                    morceaux.append(s)
                    pos += len(s)
                elif enfant.tag == W_TAB:
                    self.segments.append((enfant, "x", pos, pos + 1))
                    morceaux.append("\t")
                    pos += 1
                elif enfant.tag in (W_BR, W_CR):
                    self.segments.append((enfant, "x", pos, pos + 1))
                    morceaux.append("\n")
                    pos += 1
        self.texte = "".join(morceaux)

    def remplacer(self, debut: int, fin: int, nouveau: str) -> bool:
        """Remplace texte[debut:fin] par ``nouveau`` en gardant la mise en forme du
        premier caractère remplacé. À appeler de la fin vers le début du paragraphe."""
        textes = [s for s in self.segments if s[1] == "t"]
        if not textes:
            return False
        premier = None
        for s in textes:
            if s[2] <= debut < s[3] or (debut == fin and s[2] <= debut <= s[3]):
                premier = s
                break
        if premier is None:
            # insertion juste après un texte (fin de paragraphe par exemple)
            avant = [s for s in textes if s[3] <= debut]
            if not avant:
                return False
            premier = avant[-1]
        el, _, d0, _ = premier
        courant = el.text or ""
        local_debut = debut - d0
        # partie conservée après la zone remplacée, dans le premier segment
        if fin <= premier[3]:
            suite = courant[fin - d0:]
        else:
            suite = ""
            for s in textes:
                if s is premier or s[3] <= debut or s[2] >= fin:
                    continue
                el2 = s[0]
                t2 = el2.text or ""
                el2.text = t2[fin - s[2]:] if fin < s[3] else ""
                _preserver(el2)
        self._ecrire(el, courant[:local_debut], nouveau, suite)
        return True

    @staticmethod
    def _ecrire(t, prefixe: str, nouveau: str, suite: str):
        lignes = nouveau.split("\n")
        t.text = prefixe + lignes[0] + (suite if len(lignes) == 1 else "")
        _preserver(t)
        if len(lignes) == 1:
            return
        run = t.getparent()
        position = run.index(t)
        for i, ligne in enumerate(lignes[1:], start=1):
            br = etree.Element(W_BR)
            nt = etree.Element(W_T)
            nt.text = ligne + (suite if i == len(lignes) - 1 else "")
            _preserver(nt)
            run.insert(position + 1, br)
            run.insert(position + 2, nt)
            position += 2


def paragraphes(racine):
    return list(racine.iter(W_P))


# --------------------------------------------------------------------------- #
#  Balises
# --------------------------------------------------------------------------- #
def remplacer_balises(doc: DocumentWord, valeurs: dict, format_date="jj/mm/aaaa") -> set[str]:
    """Remplace toutes les balises. Retourne l'ensemble des clés inconnues."""
    inconnues = set()
    for racine in doc.racines():
        for p in paragraphes(racine):
            tp = TexteParagraphe(p)
            if "{{" not in tp.texte:
                continue
            trouvees = list(balises.trouver(tp.texte))
            for debut, fin, b in reversed(trouvees):
                texte, connue = balises.resoudre(b, valeurs, format_date)
                if not connue:
                    inconnues.add(b.cle)
                tp.remplacer(debut, fin, texte)
    return inconnues


def lister_balises(doc: DocumentWord) -> list[str]:
    vues = []
    for racine in doc.racines():
        for p in paragraphes(racine):
            tp = TexteParagraphe(p)
            if "{{" in tp.texte:
                for _, _, b in balises.trouver(tp.texte):
                    if b.cle not in vues:
                        vues.append(b.cle)
    return vues


def texte_complet(doc: DocumentWord) -> str:
    lignes = []
    for racine in doc.racines():
        for p in paragraphes(racine):
            lignes.append(TexteParagraphe(p).texte)
    return "\n".join(lignes)


# --------------------------------------------------------------------------- #
#  Champs de formulaire hérités (FORMTEXT / FORMCHECKBOX / FORMDROPDOWN)
# --------------------------------------------------------------------------- #
@dataclass
class ChampFormulaire:
    debut: etree._Element
    ffdata: etree._Element
    separe: etree._Element | None = None
    fin: etree._Element | None = None
    textes_resultat: list = field(default_factory=list)
    texte_avant: str = ""
    texte_apres: str = ""

    @property
    def genre(self) -> str:
        if self.ffdata.find(w("checkBox")) is not None:
            return "case"
        if self.ffdata.find(w("ddList")) is not None:
            return "liste"
        return "texte"

    @property
    def nom(self) -> str:
        n = self.ffdata.find(w("name"))
        return n.get(w("val"), "") if n is not None else ""

    @property
    def resultat(self) -> str:
        return "".join(t.text or "" for t in self.textes_resultat)

    @property
    def est_vide(self) -> bool:
        return self.resultat.strip(ESPACES_VIDES) == ""

    # -- cases à cocher
    def est_cochee(self) -> bool:
        cb = self.ffdata.find(w("checkBox"))
        if cb is None:
            return False
        ch = cb.find(w("checked"))
        if ch is not None:
            return ch.get(w("val"), "1") not in ("0", "false", "off")
        d = cb.find(w("default"))
        return d is not None and d.get(w("val"), "0") in ("1", "true", "on")

    def cocher(self, valeur: bool = True):
        cb = self.ffdata.find(w("checkBox"))
        if cb is None:
            return
        for ch in cb.findall(w("checked")):
            cb.remove(ch)
        ch = etree.SubElement(cb, w("checked"))
        if not valeur:
            ch.set(w("val"), "0")

    # -- texte
    def definir_texte(self, texte: str):
        if self.textes_resultat:
            premier = self.textes_resultat[0]
            premier.text = texte
            _preserver(premier)
            for t in self.textes_resultat[1:]:
                t.text = ""
            return
        if self.fin is None:
            return
        run_fin = self.fin.getparent()
        parent = run_fin.getparent()
        position = parent.index(run_fin)
        if self.separe is None:
            r_sep = etree.Element(W_R)
            etree.SubElement(r_sep, W_FLDCHAR).set(W_TYPE, "separate")
            parent.insert(position, r_sep)
            position += 1
        r_txt = etree.Element(W_R)
        rpr_source = run_fin.find(w("rPr"))
        if rpr_source is not None:
            r_txt.append(etree.fromstring(etree.tostring(rpr_source)))
        t = etree.SubElement(r_txt, W_T)
        t.text = texte
        _preserver(t)
        parent.insert(position, r_txt)
        self.textes_resultat = [t]


def champs_formulaire(racine) -> list[ChampFormulaire]:
    """Champs de formulaire dans l'ordre du document, avec le texte qui les entoure."""
    champs: list[ChampFormulaire] = []
    pile: list = []  # champs ouverts (formulaire ou non) : [champ_ou_None, dans_resultat]
    courant: list[str] = []

    def dans_resultat():
        return any(etat[1] for etat in pile)

    for el in racine.iter():
        tag = el.tag
        if tag == W_FLDCHAR:
            typ = el.get(W_TYPE)
            if typ == "begin":
                ff = el.find(W_FFDATA)
                champ = None
                if ff is not None and not dans_resultat():
                    champ = ChampFormulaire(debut=el, ffdata=ff, texte_avant="".join(courant))
                    if champs:
                        champs[-1].texte_apres = champ.texte_avant
                    champs.append(champ)
                    courant = []
                pile.append([champ, False])
            elif typ == "separate" and pile:
                pile[-1][1] = True
                if pile[-1][0] is not None:
                    pile[-1][0].separe = el
            elif typ == "end" and pile:
                champ, _ = pile.pop()
                if champ is not None:
                    champ.fin = el
        elif tag == W_P:
            if not dans_resultat():
                courant.append("\n")
        elif tag in (W_T, W_TAB, W_BR, W_CR):
            if tag != W_T and el.getparent() is not None and el.getparent().tag != W_R:
                continue  # w:tab des taquets de tabulation (w:tabs), pas du texte
            if tag == W_T:
                texte = el.text or ""
            else:
                texte = "\t" if tag == W_TAB else "\n"
            if dans_resultat():
                for etat in reversed(pile):
                    if etat[0] is not None and etat[1]:
                        if tag == W_T:
                            etat[0].textes_resultat.append(el)
                        break
            else:
                courant.append(texte)
    if champs:
        champs[-1].texte_apres = "".join(courant)
    return champs


def normaliser(texte: str) -> str:
    return re.sub(r"[\s   ]+", " ", texte).strip()


def libelle_case(champ: ChampFormulaire) -> str:
    """Libellé d'une case à cocher : texte qui la suit (même ligne de préférence)."""
    apres = champ.texte_apres
    ligne = apres.split("\n")
    morceau = ligne[0] if normaliser(ligne[0]) else (ligne[1] if len(ligne) > 1 else "")
    # coupe aux tabulations multiples (colonnes Conclusion / Durée)
    morceau = re.split(r"\t{2,}", morceau.strip("\t "))[0]
    return normaliser(morceau)[:200]


def cocher_cases(doc: DocumentWord, choisir) -> list[str]:
    """Coche les cases dont le libellé satisfait ``choisir(libelle)``. Retourne les libellés cochés."""
    cochees = []
    for racine in doc.racines():
        for champ in champs_formulaire(racine):
            if champ.genre != "case":
                continue
            libelle = libelle_case(champ)
            if libelle and choisir(libelle):
                champ.cocher(True)
                cochees.append(libelle)
    return cochees
