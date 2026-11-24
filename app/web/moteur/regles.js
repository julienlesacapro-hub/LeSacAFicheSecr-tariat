// Règles métier : âge, prochaine VQ, type de venue, choix des documents.
// Équivalent de app/regles.py (et de l'inventaire de app/modeles.py).
import * as balises from "./balises.js";
import * as dates from "./dates.js";
import { Jour } from "./dates.js";

export const CLES_CALCULEES = new Set([
  "DATE_RDV", "DATE_VQ", "AGE", "TYPE_VENUE", "TYPE_VISITE", "APTITUDE", "APTITUDE_LIBELLE",
  "VILLE", "NOM_SERVICE", "DATE_JOUR", "NOM_PRENOM", "IDENTITE",
]);

// ---------------------------------------------------------------- outils (sémantique Python)
/** dict.get(cle, défaut) : le défaut ne s'applique que si la clé est absente. */
export const obtenir = (o, k, d) => (o && Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined ? o[k] : d);
const vide = (v) => v === null || v === undefined || v === "";
const entier = (v) => Math.trunc(Number(v));
const alerte = (liste, niveau, message) => liste.push({ niveau, message });

function texte(v, transformation) {
  let s = v === null || v === undefined ? "" : String(v).trim();
  s = s.replace(/\s+/g, " ");
  if (transformation === "maj") s = s.toUpperCase();
  else if (transformation === "min") s = s.toLowerCase();
  else if (transformation === "cap") s = balises.capitaliser(s);
  return s;
}
function vrai(v) {
  if (typeof v === "string") return ["1", "true", "oui", "vrai", "on", "x"].includes(v.trim().toLowerCase());
  return Boolean(v);
}

// ---------------------------------------------------------------- inventaire des modèles
export function cleNormalisee(chemin) {
  let s = chemin.replace(/\\/g, "/").replace(/\.(docx|docm|dotx|doc|dot)$/i, "");
  s = s.normalize("NFKD").replace(/\p{M}/gu, "");
  s = s.replace(/\s+/g, " ").trim().toLowerCase();
  return s.replace(/\s*\/\s*/g, "/");
}
const nomFichier = (p) => p.slice(p.lastIndexOf("/") + 1);
const tronc = (p) => { const n = nomFichier(p); const i = n.lastIndexOf("."); return i > 0 ? n.slice(0, i) : n; };

/** Liste des modèles disponibles : [{chemin, balises}] (chemins relatifs avec « / »). */
export class Inventaire {
  constructor(modeles = [], nonConvertis = []) {
    this.fichiers = modeles.map((m) => m.chemin).filter((c) => !c.startsWith("_") && !nomFichier(c).startsWith("~$")).sort();
    this.nonConvertis = nonConvertis;
    this._balises = new Map(modeles.map((m) => [m.chemin, m.balises || []]));
    this._index = new Map(this.fichiers.map((f) => [cleNormalisee(f), f]));
    const noms = new Map();
    for (const f of this.fichiers) { const k = cleNormalisee(nomFichier(f)); noms.set(k, [...(noms.get(k) || []), f]); }
    this._indexNoms = new Map([...noms].filter(([, v]) => v.length === 1).map(([k, v]) => [k, v[0]]));
  }
  trouver(rel) {
    if (!rel) return null;
    rel = rel.replace(/\\/g, "/");
    if (this.fichiers.includes(rel)) return rel;
    const cle = cleNormalisee(rel);
    if (this._index.has(cle)) return this._index.get(cle);
    return this._indexNoms.get(cleNormalisee(nomFichier(rel))) || null;
  }
  balises(rel) { return this._balises.get(rel) || []; }
}

// ---------------------------------------------------------------- saisie
export function lireValeurs(cfg, saisie, alertes) {
  const brut = saisie.champs || {};
  const valeurs = {};
  for (const c of cfg.champs) {
    const cle = c.cle, v = brut[cle];
    if (c.type === "date") {
      const d = dates.lireDate(v, cle === "DATE_NAISSANCE");
      if (!vide(v) && d === null) alerte(alertes, "erreur", `${c.libelle} : date illisible « ${v} » (format jj/mm/aaaa).`);
      valeurs[cle] = d;
    } else if (c.type === "case") {
      valeurs[cle] = vrai(v);
    } else if (c.type === "nombre") {
      const s = texte(v);
      valeurs[cle] = s;
      if (s && !/^-?\d+([.,]\d+)?$/.test(s)) alerte(alertes, "attention", `${c.libelle} : « ${s} » n'est pas un nombre.`);
    } else {
      valeurs[cle] = texte(v, c.transformation);
    }
  }
  for (const [cle, v] of Object.entries(brut)) {
    if (!(cle in valeurs) && !CLES_CALCULEES.has(cle) && /^[A-Z][A-Z0-9_]*$/.test(cle)) valeurs[cle] = texte(v);
  }
  return valeurs;
}

export function appliquerDefauts(cfg, valeurs) {
  for (const c of cfg.champs) {
    const defaut = c.defaut;
    if (vide(defaut) || !vide(valeurs[c.cle])) continue;
    if (typeof defaut === "string" && defaut.startsWith("=")) valeurs[c.cle] = obtenir(valeurs, defaut.slice(1).trim().toUpperCase(), null);
    else if (c.type === "date") valeurs[c.cle] = dates.lireDate(defaut);
    else if (c.type === "case") valeurs[c.cle] = vrai(defaut);
    else valeurs[c.cle] = texte(defaut, c.transformation);
  }
}

export function motifsValides(cfg, saisie, alertes) {
  const types = Object.fromEntries(cfg.types_visite.map((t) => [t.code, t]));
  const apts = Object.fromEntries(cfg.aptitudes.map((a) => [a.code, a]));
  const motifs = [];
  (saisie.motifs || []).forEach((m, k) => {
    const i = k + 1;
    const t = (m.type || "").trim(), a = (m.aptitude || "").trim();
    if (!t && !a) return;
    if (!(t in types)) { alerte(alertes, "erreur", `Motif ${i} : choisissez le type de visite.`); return; }
    if (!a && obtenir(types[t], "aptitude_requise", true)) { alerte(alertes, "erreur", `Motif ${i} : choisissez l'aptitude.`); return; }
    if (a && !(a in apts)) { alerte(alertes, "erreur", `Motif ${i} : aptitude « ${a} » inconnue.`); return; }
    motifs.push({ type: t, aptitude: a });
  });
  return motifs;
}

/** Aptitudes proposées pour chaque type : déduites des certificats et des fiches. */
export function aptitudesParType(cfg) {
  const ordre = cfg.aptitudes.map((a) => a.code);
  const res = Object.fromEntries(cfg.types_visite.map((t) => [t.code, new Set()]));
  for (const liste of [cfg.certificats, cfg.fiches_axone]) {
    for (const r of liste) for (const t of r.types || []) if (t in res) for (const a of r.aptitudes || []) res[t].add(a);
  }
  return Object.fromEntries(Object.entries(res).map(([t, s]) => [t, ordre.filter((a) => s.has(a))]));
}

function dateVq(cfg, motifs, rdv, surcharge, alertes) {
  const types = Object.fromEntries(cfg.types_visite.map((t) => [t.code, t]));
  const modes = motifs.map((m) => obtenir(types[m.type], "calcul_vq", "aucun"));
  let auto = null, mode = "aucun";
  if (modes.includes("rdv")) {
    mode = "calcul";
    if (rdv) auto = dates.ajouter(rdv, { annees: entier(obtenir(cfg.general, "annees_vq", 4)) });
  } else if (modes.includes("saisie")) {
    mode = "saisie";
  }
  let valeur = auto;
  if (!vide(surcharge)) {
    const d = dates.lireDate(surcharge);
    if (d === null) alerte(alertes, "erreur", `Prochaine VQ : date illisible « ${surcharge} ».`);
    else { valeur = d; mode = mode !== "saisie" ? "manuel" : "saisie"; }
  }
  if (mode === "saisie" && valeur === null) {
    alerte(alertes, "attention", "Visite annuelle ou d'expertise : saisissez la date de la prochaine VQ "
      + "déjà programmée (elle n'est pas recalculée).");
  }
  return [valeur, auto, mode];
}

function typeVenue(cfg, motifs) {
  const types = Object.fromEntries(cfg.types_visite.map((t) => [t.code, t]));
  const apts = Object.fromEntries(cfg.aptitudes.map((a) => [a.code, a]));
  const morceaux = motifs.map((m) => {
    const t = types[m.type].sigle || m.type;
    const a = m.aptitude ? (apts[m.aptitude].sigle || m.aptitude) : "";
    return `${t} ${a}`.trim();
  });
  return morceaux.join(obtenir(cfg.general, "separateur_types", " + "));
}

// ---------------------------------------------------------------- choix des documents
function regleAxone(r, motifs, valeurs, age) {
  const types = r.types || [], apts = r.aptitudes || [];
  if (!motifs.some((m) => (!types.length || types.includes(m.type)) && (!apts.length || apts.includes(m.aptitude)))) return [false, null];
  const amin = r.age_min, amax = r.age_max;
  if (!vide(amin) || !vide(amax)) {
    if (age === null) return [false, "age"];
    if (!vide(amin) && age < entier(amin)) return [false, null];
    if (!vide(amax) && age > entier(amax)) return [false, null];
  }
  for (const [cle, attendu] of Object.entries(r.conditions || {})) {
    const v = valeurs[cle];
    if (typeof attendu === "boolean") {
      if (Boolean(v) !== attendu) return [false, null];
    } else if (String(v || "").trim().toUpperCase() !== String(attendu).trim().toUpperCase()) {
      return [false, null];
    }
  }
  return [true, null];
}

function choisirAxone(cfg, motifs, valeurs, age, alertes) {
  if (!motifs.length) return null;
  let meilleure = null, ageManquant = false;
  for (const r of cfg.fiches_axone) {
    const [ok, raison] = regleAxone(r, motifs, valeurs, age);
    if (raison === "age") ageManquant = true;
    if (ok && (meilleure === null || entier(obtenir(r, "priorite", 0)) > entier(obtenir(meilleure, "priorite", 0)))) meilleure = r;
  }
  if (ageManquant && (meilleure === null || meilleure.a_verifier)) {
    alerte(alertes, "attention", "Renseignez la date de naissance : la fiche navette dépend de l'âge.");
  }
  return meilleure;
}

function choisirCertificats(cfg, motifs, alertes) {
  const apts = Object.fromEntries(cfg.aptitudes.map((a) => [a.code, a]));
  const types = Object.fromEntries(cfg.types_visite.map((t) => [t.code, t]));
  let restants = motifs.map((_, i) => i);
  const choisis = [];
  const entrees = cfg.certificats.map((e, i) => [i, e])
    .sort((x, y) => (y[1].aptitudes || []).length - (x[1].aptitudes || []).length || x[0] - y[0]);
  for (const [, e] of entrees) {
    const voulues = e.aptitudes || [];
    if (!voulues.length) continue;
    const pris = [];
    for (const a of voulues) {
      const i = restants.find((i) => !pris.includes(i) && motifs[i].aptitude === a && (e.types || []).includes(motifs[i].type));
      if (i === undefined) break;
      pris.push(i);
    }
    if (pris.length === voulues.length) {
      choisis.push([e, pris.map((i) => motifs[i])]);
      restants = restants.filter((i) => !pris.includes(i));
    }
  }
  for (const i of restants) {
    const m = motifs[i];
    const apt = apts[m.aptitude] || {};
    if (apt.sans_certificat || !obtenir(types[m.type], "aptitude_requise", true)) continue;
    alerte(alertes, "attention", `Aucun certificat paramétré pour ${obtenir(types[m.type], "sigle", m.type)} `
      + `${obtenir(apt, "sigle", m.aptitude)}. Ajoutez-le dans Paramètres › Certificats.`);
  }
  return choisis;
}

function doc(categorie, modele, titre, inventaire, types, regle = null) {
  const chemin = modele ? inventaire.trouver(modele) : null;
  return {
    cle: `${categorie}:${modele}`, categorie, modele, chemin, existe: chemin !== null,
    titre: titre || tronc(modele), types,
    a_verifier: Boolean(regle && regle.a_verifier), note: obtenir(regle || {}, "note", ""),
  };
}

// ---------------------------------------------------------------- calcul complet
export function calculer(cfg, saisie, inventaire) {
  const g = cfg.general;
  const fmt = obtenir(g, "format_date", "jj/mm/aaaa");
  const alertes = [];
  const valeurs = lireValeurs(cfg, saisie, alertes);
  const brut = saisie.champs || {};
  const rdv = dates.lireDate(brut.DATE_RDV);
  if (!rdv) alerte(alertes, "erreur", "Date du rendez-vous manquante ou illisible.");
  valeurs.DATE_RDV = rdv;
  appliquerDefauts(cfg, valeurs);

  const ddn = valeurs.DATE_NAISSANCE || null;
  const age = ddn instanceof Jour && rdv ? dates.age(ddn, rdv) : null;
  if (age !== null && !(age >= 14 && age <= 75)) alerte(alertes, "attention", `Âge calculé inhabituel : ${age} ans. Vérifiez la date de naissance.`);
  valeurs.AGE = age === null ? "" : age;

  const motifs = motifsValides(cfg, saisie, alertes);
  if (!motifs.length) alerte(alertes, "erreur", "Choisissez au moins un type de visite.");
  const surcharges = saisie.surcharges || {};
  const [vq, vqAuto, modeVq] = dateVq(cfg, motifs, rdv, surcharges.DATE_VQ, alertes);
  valeurs.DATE_VQ = vq;
  const tvAuto = typeVenue(cfg, motifs);
  valeurs.TYPE_VENUE = (surcharges.TYPE_VENUE || "").trim() || tvAuto;

  const types = Object.fromEntries(cfg.types_visite.map((t) => [t.code, t]));
  const apts = Object.fromEntries(cfg.aptitudes.map((a) => [a.code, a]));
  const sep = obtenir(g, "separateur_types", " + ");
  valeurs.TYPE_VISITE = [...new Set(motifs.map((m) => obtenir(types[m.type], "sigle", m.type)))].join(sep);
  valeurs.APTITUDE = motifs.filter((m) => m.aptitude).map((m) => obtenir(apts[m.aptitude], "sigle", m.aptitude)).join(sep);
  valeurs.APTITUDE_LIBELLE = motifs.filter((m) => m.aptitude).map((m) => obtenir(apts[m.aptitude], "libelle", m.aptitude)).join(sep);
  valeurs.VILLE = obtenir(g, "ville", "");
  valeurs.NOM_SERVICE = obtenir(g, "nom_service", "");
  valeurs.DATE_JOUR = Jour.aujourdhui();
  const nom = obtenir(valeurs, "NOM", ""), prenom = obtenir(valeurs, "PRENOM", "");
  valeurs.NOM_PRENOM = `${nom ?? ""} ${prenom ?? ""}`.trim();
  const ligneDdn = ddn ? `Né(e) le ${dates.formater(ddn, fmt)}` : "";
  valeurs.IDENTITE = [valeurs.NOM_PRENOM, ligneDdn].filter(Boolean).join("\n");

  const documents = [];
  const regle = choisirAxone(cfg, motifs, valeurs, age, alertes);
  if (regle) documents.push(doc("axone", regle.modele, regle.titre, inventaire, motifs.map((m) => m.type), regle));
  for (const [entree, couverts] of choisirCertificats(cfg, motifs, alertes)) {
    documents.push(doc("certificat", entree.modele, entree.titre, inventaire, couverts.map((m) => m.type), entree));
  }
  const exclus = new Set(saisie.documents_exclus || []);
  for (const d of documents) d.inclus = !exclus.has(d.cle);
  for (const rel of saisie.documents_ajoutes || []) {
    const cle = `ajout:${rel}`;
    if (documents.some((d) => d.cle === cle || d.chemin === rel)) continue;
    const d = doc("ajout", rel, null, inventaire, motifs.map((m) => m.type));
    d.cle = cle; d.inclus = !exclus.has(cle);
    documents.push(d);
  }
  for (const d of documents) {
    if (d.inclus && !d.existe) {
      alerte(alertes, "erreur", `Modèle introuvable : « ${d.modele} ». Importez vos modèles `
        + "(Paramètres › Modèles) ou corrigez le chemin.");
    }
    if (d.inclus && d.a_verifier) alerte(alertes, "info", `${d.titre} : règle à vérifier. ${d.note}`.trim());
  }

  const defChamps = Object.fromEntries(cfg.champs.map((c) => [c.cle, c]));
  const utilisees = new Map();
  for (const d of documents) {
    if (d.inclus && d.existe) for (const cle of inventaire.balises(d.chemin)) utilisees.set(cle, [...(utilisees.get(cle) || []), d.titre]);
  }
  const aptitudesChoisies = new Set(motifs.map((m) => m.aptitude));
  const visibles = [];
  for (const c of cfg.champs) {
    if (c.section !== "complement") continue;
    if (utilisees.has(c.cle) || (c.afficher_si_aptitudes || []).some((a) => aptitudesChoisies.has(a))) visibles.push(c.cle);
  }
  const inconnus = [...utilisees].filter(([k]) => !(k in defChamps) && !CLES_CALCULEES.has(k)).map(([cle, documents]) => ({ cle, documents }));

  for (const c of cfg.champs) {
    if (c.obligatoire && (c.section !== "complement" || visibles.includes(c.cle)) && vide(valeurs[c.cle])) {
      alerte(alertes, "erreur", `Champ obligatoire : ${c.libelle}.`);
    }
  }
  if (!documents.some((d) => d.inclus) && motifs.length) alerte(alertes, "erreur", "Aucun document à générer.");

  const affichable = (v, f = "jj/mm/aaaa") => (v instanceof Jour ? dates.formater(v, f) : v);
  return {
    valeurs,
    affichage: Object.fromEntries(Object.entries(valeurs).map(([k, v]) => [k, affichable(v, fmt)])),
    age,
    motifs,
    vq: { valeur: affichable(vq), auto: affichable(vqAuto), mode: modeVq },
    type_venue: { valeur: valeurs.TYPE_VENUE, auto: tvAuto },
    documents,
    champs_visibles: visibles,
    champs_inconnus: inconnus,
    alertes,
    bloquant: alertes.some((a) => a.niveau === "erreur"),
  };
}
