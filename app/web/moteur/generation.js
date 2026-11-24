// Contrôle du paramétrage, production des documents, préparation (import) des modèles.
// Équivalent de app/config.py (controler), app/generation.py et app/importation.py.
import * as balises from "./balises.js";
import * as docx from "./docx.js";
import { calculer, obtenir } from "./regles.js";

// ---------------------------------------------------------------- paramétrage
function regexValide(motif) {
  try { new RegExp(motif || ""); return null; } catch (e) { return e.message; }
}

/** Liste des erreurs bloquantes du paramétrage (vide si tout va bien). */
export function controler(cfg) {
  const erreurs = [];
  const uniques = (liste, nom) => {
    const vus = new Set();
    for (const el of liste) {
      const code = String(el.code || el.cle || "").trim();
      if (!code) erreurs.push(`${nom} : une ligne n'a pas de code.`);
      else if (vus.has(code)) erreurs.push(`${nom} : le code « ${code} » est en double.`);
      vus.add(code);
    }
    return vus;
  };
  const cles = uniques(cfg.champs || [], "Champs");
  for (const c of cfg.champs || []) {
    if (c.cle && !/^[A-Z][A-Z0-9_]*$/.test(c.cle)) erreurs.push(`Champs : « ${c.cle} » doit être en MAJUSCULES sans espace ni accent (ex. DATE_TEST).`);
    if (!["texte", "date", "case", "nombre"].includes(c.type)) erreurs.push(`Champs : type inconnu pour « ${c.cle} » (texte, date, case ou nombre).`);
  }
  for (const c of ["DATE_RDV", "DATE_VQ", "AGE", "TYPE_VENUE"]) {
    if (cles.has(c)) erreurs.push(`Champs : « ${c} » est calculé par l'application, choisissez un autre code.`);
  }
  const types = uniques(cfg.types_visite || [], "Types de visite");
  const aptitudes = uniques(cfg.aptitudes || [], "Aptitudes");
  for (const t of cfg.types_visite || []) {
    if (!["rdv", "saisie", "aucun"].includes(t.calcul_vq)) erreurs.push(`Types de visite : calcul de la VQ inconnu pour « ${t.code} ».`);
    const e = regexValide(t.cases);
    if (e) erreurs.push(`Types de visite : motif de case invalide pour « ${t.code} » (${e}).`);
  }
  const e = regexValide((cfg.general || {}).motif_case_aptitude);
  if (e) erreurs.push(`Général : motif des cases d'aptitude invalide (${e}).`);
  for (const [nom, liste] of [["Fiches AXONE", cfg.fiches_axone || []], ["Certificats", cfg.certificats || []]]) {
    liste.forEach((r, k) => {
      const i = k + 1;
      if (!String(r.modele || "").trim()) erreurs.push(`${nom} : la ligne ${i} n'indique pas de modèle.`);
      for (const t of r.types || []) if (!types.has(t)) erreurs.push(`${nom} : ligne ${i}, type de visite « ${t} » inconnu.`);
      for (const a of r.aptitudes || []) if (!aptitudes.has(a)) erreurs.push(`${nom} : ligne ${i}, aptitude « ${a} » inconnue.`);
    });
  }
  return erreurs;
}

/** Complète un paramétrage ancien avec les réglages ajoutés depuis (comme config.charger). */
export function completer(cfg, base) {
  cfg.general = cfg.general || {};
  for (const [cle, valeur] of Object.entries(base.general)) if (!(cle in cfg.general)) cfg.general[cle] = valeur;
  for (const cle of ["champs", "types_visite", "aptitudes", "fiches_axone", "certificats"]) if (!(cle in cfg)) cfg[cle] = base[cle];
  return cfg;
}

// ---------------------------------------------------------------- génération
export function nettoyerNom(nom, longueur = 110) {
  nom = nom.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/\s+/g, " ").replace(/^[ .-]+|[ .-]+$/g, "");
  return nom.slice(0, longueur).replace(/[ .-]+$/, "") || "document";
}

/** « {DATE_RDV:aaaa-mm-jj} {NOM} » → « 2026-11-21 DUPONT ». */
export function gabarit(modele, valeurs, formatDate = "jj/mm/aaaa") {
  let texte = modele.replace(/\{([^{}]+)\}/g, (tout, interieur) => {
    const b = balises.analyser("{{" + interieur + "}}");
    return b ? balises.resoudre(b, valeurs, formatDate)[0] : tout;
  });
  texte = texte.replace(/\(\s*\)/g, "");
  return nettoyerNom(texte);
}

export function predicatCases(cfg, typesDocument) {
  const g = cfg.general;
  const prefixe = new RegExp(g.motif_case_aptitude || String.raw`^aptitude\b`, "i");
  const motifs = cfg.types_visite.filter((t) => typesDocument.includes(t.code) && (t.cases || "").trim()).map((t) => new RegExp(t.cases, "i"));
  return (libelle) => prefixe.test(libelle) && motifs.some((m) => m.test(libelle));
}

export class SaisieIncomplete extends Error {
  constructor(alertes) {
    super(alertes.filter((a) => a.niveau === "erreur").map((a) => a.message).join("\n"));
    this.alertes = alertes;
  }
}

/**
 * Produit les documents d'une visite.
 * @param lireModele async (chemin relatif) → octets du modèle
 * @returns {dossier, fichiers:[{titre, nom, categorie, cases_cochees, octets}], alertes, calcul}
 */
export async function generer(cfg, inventaire, saisie, lireModele) {
  const calcul = calculer(cfg, saisie, inventaire);
  if (calcul.bloquant) throw new SaisieIncomplete(calcul.alertes);
  const g = cfg.general;
  const fmt = obtenir(g, "format_date", "jj/mm/aaaa");
  const valeurs = calcul.valeurs;
  const dossier = gabarit(obtenir(g, "nom_dossier_visite", "{DATE_RDV:aaaa-mm-jj} {NOM} {PRENOM}"), valeurs, fmt);
  const fichiers = [], alertes = [];
  let numero = 0;
  for (const d of calcul.documents) {
    if (!d.inclus) continue;
    numero += 1;
    const doc = await docx.DocumentWord.ouvrir(await lireModele(d.chemin), d.chemin);
    const inconnues = docx.remplacerBalises(doc, valeurs, fmt);
    let cochees = [];
    if (obtenir(g, "cocher_cases_aptitude", true) && d.types.length) cochees = docx.cocherCases(doc, predicatCases(cfg, d.types));
    let nom = gabarit(obtenir(g, "nom_fichier", "{NUMERO} {TITRE}"), { ...valeurs, NUMERO: numero, TITRE: d.titre }, fmt) + ".docx";
    if (fichiers.some((f) => f.nom === nom)) nom = nom.replace(/\.docx$/, ` (${numero}).docx`);
    if (inconnues.size) {
      alertes.push({ niveau: "attention", message: `${d.titre} : balises sans valeur ${[...inconnues].sort().join(", ")} (laissées vides).` });
    }
    fichiers.push({ titre: d.titre, nom, categorie: d.categorie, cases_cochees: cochees, octets: await doc.octets() });
  }
  return { dossier, fichiers, alertes: calcul.alertes.concat(alertes), calcul };
}

// ---------------------------------------------------------------- import (pose des balises)
const REGLES_CHAMPS = [
  [/\bNOM\s*:?\s*$/, ["NOM"]],
  [/Pr[ée]nom\s*:?\s*$/i, ["PRENOM"]],
  [/Date de naissance\s*:?\s*$/i, ["DATE_NAISSANCE:jj", "DATE_NAISSANCE:mm", "DATE_NAISSANCE:aaaa"]],
  [/\bGrade\s*:?\s*$/i, ["GRADE"]],
  [/Identifiant d[ée]fense\s*:?\s*$/i, ["MATRICULE"]],
  [/\bVMP\s*:?\s*$/, ["DATE_RDV"]],
  [/^\s*à\s+\S.*\ble\s*$/i, ["DATE_RDV"]],
  [/avant fin\s*$/i, ["DATE_VQ:mm", "DATE_VQ:aaaa"]],
];
const FIN = String.raw`(?=\s{3,}|\t|\n|$)`;
const R = (s) => new RegExp(s, "dg");
const REGLES_TEXTE = [
  ["DOSSIER", R(String.raw`(Fiche\s*n°\s?)(?<v>[^\t\n]*?)(?=\s{3,}|\t|\n|Prochaine|$)`), "{{DOSSIER}}"],
  ["DATE_VQ", R(String.raw`(Prochaine\s+VQ\s*:\s?)(?<v>\d{1,2}\s*/\s*\d{1,2}\s*/\s*\d{2,4})?`), "{{DATE_VQ:jj/mm/aa}}"],
  ["GRADE", R(String.raw`(Grade\s*:\s?)(?<v>.*?)(?=\s{3,}|\t|\n|Matricule|Affectation|Type de visite|$)`), "{{GRADE}}"],
  ["MATRICULE", R(String.raw`(Matricule\s*:\s?)(?<v>.*?)(?=\s{3,}|\t|\n|Affectation|Type de visite|$)`), "{{MATRICULE}}"],
  ["AFFECTATION", R(String.raw`(Affectation\s*:\s?)(?<v>.*?)(?=\s{3,}|\t|\n|Type de visite|$)`), "{{AFFECTATION}}"],
  ["TYPE_VENUE", R(String.raw`(Type de visite\s*:\s?)(?<v>.*?)` + FIN), "{{TYPE_VENUE}}"],
  ["AGE", R(String.raw`(\bAGE\s*:\s?)(?<v>\d+\s*(?:ans)?)?`), "{{AGE}} ans"],
  ["DATE_TEST_PSY", R(String.raw`(TEST PSY\s+)(?<v>\d{1,2}\s*/\s*\d{1,2}\s*/\s*\d{2,4})`), "{{DATE_TEST_PSY:jj/mm/aa}}"],
  ["DATE_CAISSON", R(String.raw`(CAISSON\s+)(?<v>\d{1,2}\s*/\s*\d{1,2}\s*/\s*\d{2,4})`), "{{DATE_CAISSON:jj/mm/aa}}"],
  ["IDENTITE", R(String.raw`()(?<v>ETIQUETTE\s+AMADEUS)`), "{{IDENTITE}}"],
];

function balisersChamps(doc) {
  const posees = [], remarques = [];
  let libres = 0;
  for (const racine of doc.racines()) {
    let attente = null;
    for (const champ of docx.champsFormulaire(racine)) {
      if (champ.genre !== "texte") { attente = null; continue; }
      const avant = champ.texteAvant;
      const derniereLigne = avant.split("\n").pop();
      let balise = null;
      if (attente && docx.normaliser(avant) === "/") {
        balise = attente.shift();
        if (!attente.length) attente = null;
      } else {
        attente = null;
        for (const [motif, suite] of REGLES_CHAMPS) {
          if (motif.test(docx.normaliser(derniereLigne)) || motif.test(derniereLigne.replace(/[   ]+$/, ""))) {
            balise = suite[0];
            attente = suite.length > 1 ? suite.slice(1) : null;
            break;
          }
        }
      }
      if (balise === null) { libres += 1; continue; }
      const cle = balise.split(":")[0];
      if (champ.resultat.includes("{{")) { posees.push(cle); continue; }
      if (!champ.estVide) {
        remarques.push(`Champ « ${cle} » déjà rempli (« ${docx.normaliser(champ.resultat)} ») : conservé.`);
        continue;
      }
      champ.definirTexte("{{" + balise + "}}");
      posees.push(cle);
    }
  }
  return [posees, remarques, libres];
}

function baliserTexte(doc, remplacerEtiquette = true) {
  const posees = [];
  for (const racine of doc.racines()) {
    for (const p of docx.paragraphes(racine)) {
      for (const [nom, motif, balise] of REGLES_TEXTE) {
        if (nom === "IDENTITE" && !remplacerEtiquette) continue;
        for (let essai = 0; essai < 10; essai++) {
          const tp = new docx.TexteParagraphe(p);
          let cible = null;
          for (const m of tp.texte.matchAll(motif)) {
            const v = m.groups.v || "";
            const apres = tp.texte.slice(m.indices[1][1]);
            if (v.startsWith("{{") || apres.replace(/^ +/, "").startsWith("{{")) continue;
            cible = m;
            break;
          }
          if (!cible) break;
          let debut, fin;
          if (cible.indices.groups.v) [debut, fin] = cible.indices.groups.v;
          else debut = fin = cible.indices[1][1]; // groupe facultatif absent : insertion après le libellé
          if (tp.remplacer(debut, fin, balise)) posees.push(nom);
          else break;
        }
      }
    }
  }
  return posees;
}

/** Pose les balises dans un .docx d'origine. Retourne {octets, genre, balises, remarques, infos}. */
export async function preparer(octets, nom, remplacerEtiquette = true) {
  const doc = await docx.DocumentWord.ouvrir(octets, nom);
  const aDesChamps = doc.racines().some((r) => docx.champsFormulaire(r).some((c) => c.genre === "texte"));
  let posees, remarques = [], genre;
  const infos = [];
  if (aDesChamps) {
    let libres;
    [posees, remarques, libres] = balisersChamps(doc);
    genre = "certificat";
    if (libres) infos.push(`${libres} champ(s) de formulaire laissé(s) au médecin.`);
    const manquantes = ["NOM", "PRENOM", "DATE_NAISSANCE"].filter((c) => !posees.includes(c));
    if (manquantes.length) remarques.push("Emplacement non trouvé pour : " + manquantes.join(", ") + ". Ajoutez la balise à la main.");
  } else {
    posees = baliserTexte(doc, remplacerEtiquette);
    genre = "fiche";
    const presentes = docx.listerBalises(doc);
    if (!posees.includes("IDENTITE") && !presentes.includes("NOM") && !presentes.includes("IDENTITE")) {
      remarques.push("Pas d'encart « ETIQUETTE AMADEUS » : nom, prénom et date de naissance ne seront pas "
        + "imprimés. Ajoutez {{IDENTITE}} (ou {{NOM}} {{PRENOM}}) à l'endroit voulu si besoin.");
    }
    if (!posees.includes("DOSSIER")) remarques.push("« Fiche n° » introuvable : numéro de dossier non placé.");
  }
  const resultat = await doc.octets();
  const verif = await docx.DocumentWord.ouvrir(resultat, nom);
  return { octets: resultat, genre, balises: [...new Set(posees)].sort(), remarques, infos, balisesDocument: docx.listerBalises(verif) };
}
