// Lecture et modification des fichiers Word (.docx) dans le navigateur.
// Équivalent de app/docx_moteur.py : mêmes algorithmes, mêmes résultats.
//  * remplacement des balises {{…}} même découpées en plusieurs « runs » ;
//  * champs de formulaire hérités (FORMTEXT, FORMCHECKBOX) des certificats issus de .doc ;
//  * corps, en-têtes, pieds de page. La mise en forme n'est jamais touchée.
import * as balises from "./balises.js";

export const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const PARTIES = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;
const ESPACES_VIDES = "    \t\r\n​";
const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

function zipper() {
  const Z = globalThis.JSZip;
  if (!Z) throw new Error("Bibliothèque JSZip non chargée.");
  return Z;
}

const estW = (n, nom) => n && n.nodeType === 1 && n.namespaceURI === W_NS && n.localName === nom;
const enfants = (n) => Array.prototype.filter.call(n.childNodes, (x) => x.nodeType === 1);
const enfantW = (n, nom) => enfants(n).find((x) => estW(x, nom)) || null;
const parent = (n) => (n.parentNode && n.parentNode.nodeType === 1 ? n.parentNode : null);

/** Éléments du sous-arbre (racine comprise), dans l'ordre du document. */
function elements(racine) {
  const res = [];
  const pile = [racine];
  while (pile.length) {
    const n = pile.pop();
    res.push(n);
    const e = enfants(n);
    for (let i = e.length - 1; i >= 0; i--) pile.push(e[i]);
  }
  return res;
}
const descendantsW = (racine, nom) => elements(racine).filter((n) => estW(n, nom));
const creerW = (doc, nom) => doc.createElementNS(W_NS, "w:" + nom);
const preserver = (t) => t.setAttributeNS(XML_NS, "xml:space", "preserve");
const texteDe = (t) => t.textContent || "";
const attrW = (n, nom) => (n.hasAttributeNS(W_NS, nom) ? n.getAttributeNS(W_NS, nom) : null);

// --------------------------------------------------------------------------- document
export class DocumentWord {
  /** @param {ArrayBuffer|Uint8Array|Blob} octets  @param {string} nom */
  static async ouvrir(octets, nom = "document.docx") {
    const d = new DocumentWord();
    d.nom = nom;
    try {
      d.zip = await zipper().loadAsync(octets);
    } catch (e) {
      throw new Error(`${nom} n'est pas un document Word valide (.docx).`);
    }
    d.parties = {};
    const analyseur = new DOMParser();
    for (const chemin of Object.keys(d.zip.files)) {
      if (!PARTIES.test(chemin)) continue;
      const xml = await d.zip.file(chemin).async("string");
      const dom = analyseur.parseFromString(xml, "application/xml");
      if (dom.getElementsByTagName("parsererror").length) throw new Error(`${nom} : partie ${chemin} illisible.`);
      d.parties[chemin] = dom;
    }
    if (!d.parties["word/document.xml"]) throw new Error(`${nom} n'est pas un document Word valide`);
    const reglages = d.zip.file("word/settings.xml");
    d._reglages = reglages ? await reglages.async("string") : null;
    return d;
  }

  /** Le corps d'abord, puis en-têtes et pieds de page. */
  racines() {
    return Object.keys(this.parties)
      .sort((a, b) => (a !== "word/document.xml") - (b !== "word/document.xml") || (a < b ? -1 : a > b ? 1 : 0))
      .map((n) => this.parties[n].documentElement);
  }

  /** Contenu .docx (Uint8Array) avec les parties modifiées. */
  async octets() {
    const s = new XMLSerializer();
    for (const [chemin, dom] of Object.entries(this.parties)) {
      this.zip.file(chemin, DECLARATION + s.serializeToString(dom.documentElement), { createFolders: false });
    }
    return this.zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }

  protectionParametres() {
    if (!this._reglages) return null;
    const m = this._reglages.match(/<w:documentProtection[^>]*w:edit="(\w+)"[^>]*w:enforcement="(1|true|on)"/);
    return m ? m[1] : null;
  }
}
export const TYPE_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// --------------------------------------------------------------------------- texte d'un paragraphe
function paragrapheProche(el) {
  for (let a = parent(el); a; a = parent(a)) if (estW(a, "p")) return a;
  return null;
}
const runsDuParagraphe = (p) => descendantsW(p, "r").filter((r) => paragrapheProche(r) === p);
export const paragraphes = (racine) => descendantsW(racine, "p");

export class TexteParagraphe {
  constructor(p) {
    this.p = p;
    this.segments = []; // [element, genre ('t' texte, 'x' tabulation/saut), début, fin]
    const morceaux = [];
    let pos = 0;
    for (const r of runsDuParagraphe(p)) {
      for (const e of enfants(r)) {
        if (estW(e, "t")) {
          const s = texteDe(e);
          this.segments.push([e, "t", pos, pos + s.length]);
          morceaux.push(s);
          pos += s.length;
        } else if (estW(e, "tab")) {
          this.segments.push([e, "x", pos, pos + 1]); morceaux.push("\t"); pos += 1;
        } else if (estW(e, "br") || estW(e, "cr")) {
          this.segments.push([e, "x", pos, pos + 1]); morceaux.push("\n"); pos += 1;
        }
      }
    }
    this.texte = morceaux.join("");
  }

  /** Remplace texte[début:fin] en gardant la mise en forme du premier caractère remplacé.
   *  À appeler de la fin vers le début du paragraphe. */
  remplacer(debut, fin, nouveau) {
    const textes = this.segments.filter((s) => s[1] === "t");
    if (!textes.length) return false;
    let premier = textes.find((s) => (s[2] <= debut && debut < s[3]) || (debut === fin && s[2] <= debut && debut <= s[3])) || null;
    if (!premier) {
      const avant = textes.filter((s) => s[3] <= debut);
      if (!avant.length) return false;
      premier = avant[avant.length - 1];
    }
    const [el, , d0] = premier;
    const courant = texteDe(el);
    let suite;
    if (fin <= premier[3]) {
      suite = courant.slice(fin - d0);
    } else {
      suite = "";
      for (const s of textes) {
        if (s === premier || s[3] <= debut || s[2] >= fin) continue;
        const t2 = texteDe(s[0]);
        s[0].textContent = fin < s[3] ? t2.slice(fin - s[2]) : "";
        preserver(s[0]);
      }
    }
    TexteParagraphe.ecrire(el, courant.slice(0, debut - d0), nouveau, suite);
    return true;
  }

  static ecrire(t, prefixe, nouveau, suite) {
    const lignes = nouveau.split("\n");
    t.textContent = prefixe + lignes[0] + (lignes.length === 1 ? suite : "");
    preserver(t);
    if (lignes.length === 1) return;
    const run = t.parentNode;
    const doc = t.ownerDocument;
    let apres = t;
    lignes.slice(1).forEach((ligne, k) => {
      const br = creerW(doc, "br");
      const nt = creerW(doc, "t");
      nt.textContent = ligne + (k === lignes.length - 2 ? suite : "");
      preserver(nt);
      run.insertBefore(br, apres.nextSibling);
      run.insertBefore(nt, br.nextSibling);
      apres = nt;
    });
  }
}

// --------------------------------------------------------------------------- balises
/** Remplace toutes les balises. Retourne l'ensemble des clés inconnues. */
export function remplacerBalises(doc, valeurs, formatDate = "jj/mm/aaaa") {
  const inconnues = new Set();
  for (const racine of doc.racines()) {
    for (const p of paragraphes(racine)) {
      const tp = new TexteParagraphe(p);
      if (!tp.texte.includes("{{")) continue;
      const trouvees = balises.trouver(tp.texte);
      for (const [debut, fin, b] of trouvees.reverse()) {
        const [texte, connue] = balises.resoudre(b, valeurs, formatDate);
        if (!connue) inconnues.add(b.cle);
        tp.remplacer(debut, fin, texte);
      }
    }
  }
  return inconnues;
}

export function listerBalises(doc) {
  const vues = [];
  for (const racine of doc.racines()) {
    for (const p of paragraphes(racine)) {
      const tp = new TexteParagraphe(p);
      if (!tp.texte.includes("{{")) continue;
      for (const [, , b] of balises.trouver(tp.texte)) if (!vues.includes(b.cle)) vues.push(b.cle);
    }
  }
  return vues;
}

export function texteComplet(doc) {
  const lignes = [];
  for (const racine of doc.racines()) for (const p of paragraphes(racine)) lignes.push(new TexteParagraphe(p).texte);
  return lignes.join("\n");
}

// --------------------------------------------------------------------------- champs de formulaire
export class ChampFormulaire {
  constructor(debut, ffdata, texteAvant) {
    this.debut = debut; this.ffdata = ffdata; this.separe = null; this.fin = null;
    this.textesResultat = []; this.texteAvant = texteAvant; this.texteApres = "";
  }
  get genre() {
    if (enfantW(this.ffdata, "checkBox")) return "case";
    if (enfantW(this.ffdata, "ddList")) return "liste";
    return "texte";
  }
  get nom() { const n = enfantW(this.ffdata, "name"); return n ? attrW(n, "val") || "" : ""; }
  get resultat() { return this.textesResultat.map(texteDe).join(""); }
  get estVide() { return [...this.resultat].every((c) => ESPACES_VIDES.includes(c)); }

  estCochee() {
    const cb = enfantW(this.ffdata, "checkBox");
    if (!cb) return false;
    const ch = enfantW(cb, "checked");
    if (ch) return !["0", "false", "off"].includes(attrW(ch, "val") ?? "1");
    const d = enfantW(cb, "default");
    return !!d && ["1", "true", "on"].includes(attrW(d, "val") ?? "0");
  }

  cocher(valeur = true) {
    const cb = enfantW(this.ffdata, "checkBox");
    if (!cb) return;
    for (const ch of enfants(cb).filter((x) => estW(x, "checked"))) cb.removeChild(ch);
    const ch = creerW(cb.ownerDocument, "checked");
    if (!valeur) ch.setAttributeNS(W_NS, "w:val", "0");
    cb.appendChild(ch);
  }

  definirTexte(texte) {
    if (this.textesResultat.length) {
      const [premier, ...autres] = this.textesResultat;
      premier.textContent = texte;
      preserver(premier);
      for (const t of autres) t.textContent = "";
      return;
    }
    if (!this.fin) return;
    const runFin = this.fin.parentNode;
    const p = runFin.parentNode;
    const doc = runFin.ownerDocument;
    if (!this.separe) {
      const rSep = creerW(doc, "r");
      const fc = creerW(doc, "fldChar");
      fc.setAttributeNS(W_NS, "w:fldCharType", "separate");
      rSep.appendChild(fc);
      p.insertBefore(rSep, runFin);
    }
    const rTxt = creerW(doc, "r");
    const rpr = enfantW(runFin, "rPr");
    if (rpr) rTxt.appendChild(rpr.cloneNode(true));
    const t = creerW(doc, "t");
    t.textContent = texte;
    preserver(t);
    rTxt.appendChild(t);
    p.insertBefore(rTxt, runFin);
    this.textesResultat = [t];
  }
}

/** Champs de formulaire dans l'ordre du document, avec le texte qui les entoure. */
export function champsFormulaire(racine) {
  const champs = [];
  const pile = []; // [champ ou null, dans_resultat]
  let courant = [];
  const dansResultat = () => pile.some((e) => e[1]);
  for (const el of elements(racine)) {
    if (el.namespaceURI !== W_NS) continue;
    const tag = el.localName;
    if (tag === "fldChar") {
      const typ = attrW(el, "fldCharType");
      if (typ === "begin") {
        const ff = enfantW(el, "ffData");
        let champ = null;
        if (ff && !dansResultat()) {
          champ = new ChampFormulaire(el, ff, courant.join(""));
          if (champs.length) champs[champs.length - 1].texteApres = champ.texteAvant;
          champs.push(champ);
          courant = [];
        }
        pile.push([champ, false]);
      } else if (typ === "separate" && pile.length) {
        pile[pile.length - 1][1] = true;
        if (pile[pile.length - 1][0]) pile[pile.length - 1][0].separe = el;
      } else if (typ === "end" && pile.length) {
        const [champ] = pile.pop();
        if (champ) champ.fin = el;
      }
    } else if (tag === "p") {
      if (!dansResultat()) courant.push("\n");
    } else if (tag === "t" || tag === "tab" || tag === "br" || tag === "cr") {
      if (tag !== "t" && parent(el) && !estW(parent(el), "r")) continue; // taquets de tabulation
      const texte = tag === "t" ? texteDe(el) : tag === "tab" ? "\t" : "\n";
      if (dansResultat()) {
        for (let i = pile.length - 1; i >= 0; i--) {
          if (pile[i][0] && pile[i][1]) { if (tag === "t") pile[i][0].textesResultat.push(el); break; }
        }
      } else {
        courant.push(texte);
      }
    }
  }
  if (champs.length) champs[champs.length - 1].texteApres = courant.join("");
  return champs;
}

export function normaliser(texte) {
  return texte.replace(/[\s   ]+/g, " ").trim();
}

/** Libellé d'une case à cocher : texte qui la suit (même ligne de préférence). */
export function libelleCase(champ) {
  const ligne = champ.texteApres.split("\n");
  let morceau = normaliser(ligne[0]) ? ligne[0] : (ligne.length > 1 ? ligne[1] : "");
  morceau = morceau.replace(/^[\t ]+|[\t ]+$/g, "").split(/\t{2,}/)[0];
  return normaliser(morceau).slice(0, 200);
}

/** Coche les cases dont le libellé satisfait choisir(libellé). Retourne les libellés cochés. */
export function cocherCases(doc, choisir) {
  const cochees = [];
  for (const racine of doc.racines()) {
    for (const champ of champsFormulaire(racine)) {
      if (champ.genre !== "case") continue;
      const libelle = libelleCase(champ);
      if (libelle && choisir(libelle)) { champ.cocher(true); cochees.push(libelle); }
    }
  }
  return cochees;
}
