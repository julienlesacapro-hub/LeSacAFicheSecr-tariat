// « Serveur » local : mêmes actions que app/serveur.py, exécutées dans le navigateur.
// Utilisé par l'application pour téléphone, tablette et navigateur (sans Python).
import * as docx from "./docx.js";
import { aptitudesParType, calculer, Inventaire, CLES_CALCULEES } from "./regles.js";
import { completer, controler, generer, preparer, SaisieIncomplete } from "./generation.js";
import * as stockage from "./stockage.js";

const EXTENSIONS_WORD = /\.(docx|docm|dotx)$/i;
const ANCIENS_WORD = /\.(doc|dot)$/i;
const produits = new Map(); // documents générés pendant la session : chemin → {nom, octets} ; dossier → [chemins]

let defaut = null, cfg = null, inventaire = null, version = "";

const copie = (o) => JSON.parse(JSON.stringify(o));

/** Premier fichier disponible parmi plusieurs emplacements : site construit (défaut_config.json à côté
 *  de index.html) ou dépôt publié tel quel par GitHub Pages (app/web/ → ../defaut_config.json). */
async function lireDisponible(chemins, lecture) {
  for (const c of chemins) {
    try {
      const r = await fetch(c, { cache: "no-cache" });
      if (r.ok) return await lecture(r);
    } catch (e) { /* emplacement suivant */ }
  }
  return null;
}

async function chargerDefaut() {
  if (defaut) return defaut;
  defaut = await lireDisponible(["defaut_config.json", "../defaut_config.json"], (r) => r.json());
  if (!defaut) throw new Error("Paramétrage par défaut introuvable (defaut_config.json).");
  version = (await lireDisponible(["version.json"], async (r) => (await r.json()).version))
    || (await lireDisponible(["../__init__.py"], async (r) => ((await r.text()).match(/__version__\s*=\s*"([^"]+)"/) || [])[1]))
    || "";
  return defaut;
}

async function charger() {
  const base = await chargerDefaut();
  const enregistre = await stockage.lireReglage("config");
  cfg = enregistre ? completer(enregistre, copie(base)) : copie(base);
  inventaire = new Inventaire(await stockage.listerModeles());
}

function etat() {
  return {
    version, windows: false, mode: "local",
    travail: "cet appareil", dossier_modeles: "mémoire de l'application", dossier_sortie: "Téléchargements",
    config: cfg, aptitudes_par_type: aptitudesParType(cfg),
    modeles: inventaire.fichiers, non_convertis: inventaire.nonConvertis,
  };
}

// ---------------------------------------------------------------- fichiers
const surMobile = () => globalThis.matchMedia && matchMedia("(pointer: coarse)").matches;

/** Propose le fichier : partage (téléphone, tablette) ou téléchargement (ordinateur). */
export async function remettreFichier(nom, octets, type = docx.TYPE_DOCX) {
  const blob = octets instanceof Blob ? octets : new Blob([octets], { type });
  if (surMobile() && navigator.canShare) {
    const f = new File([blob], nom, { type });
    if (navigator.canShare({ files: [f] })) {
      try { await navigator.share({ files: [f], title: nom }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: nom });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function zipper(entrees) {
  const z = new globalThis.JSZip();
  for (const [chemin, octets] of entrees) z.file(chemin, octets);
  return z.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

// ---------------------------------------------------------------- historique
async function lireHistorique() { return (await stockage.lireReglage("historique")) || []; }
async function ecrireHistorique(liste) { await stockage.ecrireReglage("historique", liste); }

function identifiant() {
  const o = new Uint8Array(6);
  crypto.getRandomValues(o);
  return [...o].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- import des modèles
/** Liste à plat des fichiers reçus : File isolés, dossier choisi ou archive .zip. */
async function deplier(fichiers) {
  const sortie = [];
  let paquet = null;
  for (const f of fichiers) {
    const chemin = (f.webkitRelativePath || f.name).replace(/\\/g, "/");
    if (/\.zip$/i.test(f.name)) {
      const z = await globalThis.JSZip.loadAsync(f);
      const noms = Object.keys(z.files).filter((n) => !z.files[n].dir && !/(^|\/)(__MACOSX|~\$)/.test(n));
      const cfgZip = noms.find((n) => /(^|\/)config\/config\.json$/i.test(n));
      if (cfgZip) {
        const racine = cfgZip.slice(0, cfgZip.length - "config/config.json".length);
        paquet = { config: JSON.parse(await z.file(cfgZip).async("string")), modeles: [] };
        for (const n of noms) {
          if (n.startsWith(racine + "modeles/") && EXTENSIONS_WORD.test(n)) {
            paquet.modeles.push({ chemin: n.slice(racine.length + "modeles/".length), octets: await z.file(n).async("uint8array") });
          }
        }
        continue;
      }
      for (const n of noms) sortie.push({ chemin: n, octets: () => z.file(n).async("uint8array") });
    } else {
      // dossier choisi : chemin relatif à ce dossier, comme dans le logiciel Windows
      const rel = f.webkitRelativePath ? chemin.split("/").slice(1).join("/") : chemin;
      sortie.push({ chemin: rel, octets: async () => new Uint8Array(await f.arrayBuffer()) });
    }
  }
  return { sources: sortie, paquet };
}

async function importer(fichiers, remplacerEtiquette) {
  const { sources, paquet } = await deplier(fichiers);
  const rapport = [];
  if (paquet) {
    const erreurs = controler(paquet.config);
    if (erreurs.length) throw new Error("Paramétrage du paquet invalide :\n" + erreurs.join("\n"));
    await stockage.viderModeles();
    for (const m of paquet.modeles) {
      const entree = { fichier: m.chemin, modele: m.chemin, statut: "ok", conversion: "", balises: [], remarques: [] };
      try {
        const d = await docx.DocumentWord.ouvrir(m.octets, m.chemin);
        entree.balises = docx.listerBalises(d);
        await stockage.ecrireModele({ chemin: m.chemin, octets: m.octets, balises: entree.balises, genre: "" });
      } catch (e) { entree.statut = "erreur"; entree.remarques.push(String(e.message || e)); }
      rapport.push(entree);
    }
    await stockage.ecrireReglage("config", completer(paquet.config, copie(defaut)));
  } else {
    const word = sources.filter((s) => EXTENSIONS_WORD.test(s.chemin) || ANCIENS_WORD.test(s.chemin))
      .filter((s) => !s.chemin.split("/").pop().startsWith("~$"));
    if (!word.length) throw new Error("Aucun document Word (.docx) ni paquet de paramétrage (.zip) parmi les fichiers choisis.");
    for (const s of word) {
      const modele = s.chemin.replace(/\.[^./]+$/, ".docx");
      const entree = { fichier: s.chemin, modele, statut: "ok", conversion: "", balises: [], remarques: [] };
      if (ANCIENS_WORD.test(s.chemin)) {
        entree.statut = "erreur";
        entree.remarques.push("Ancien format .doc : ouvrez-le dans Word et faites « Enregistrer sous » au format .docx, "
          + "ou importez-le avec le logiciel Windows puis transférez le paquet de paramétrage.");
        rapport.push(entree);
        continue;
      }
      try {
        const infos = await preparer(await s.octets(), s.chemin, remplacerEtiquette);
        await stockage.ecrireModele({ chemin: modele, octets: infos.octets, balises: infos.balisesDocument, genre: infos.genre });
        Object.assign(entree, { genre: infos.genre, balises: infos.balises, infos: infos.infos });
        entree.remarques.push(...infos.remarques);
        if (!infos.balises.length || infos.remarques.length) entree.statut = "attention";
      } catch (e) {
        entree.statut = "erreur";
        entree.remarques.push(`Préparation impossible : ${e.message || e}`);
      }
      rapport.push(entree);
    }
  }
  await charger();
  return {
    source: paquet ? "paquet de paramétrage" : "fichiers choisis", destination: "mémoire de l'application", sauvegarde: null,
    fichiers: rapport, paquet: !!paquet,
    totaux: Object.fromEntries(["ok", "attention", "erreur"].map((s) => [s, rapport.filter((e) => e.statut === s).length])),
  };
}

async function exporter() {
  const entrees = [["config/config.json", JSON.stringify(cfg, null, 2)]];
  for (const chemin of inventaire.fichiers) entrees.push(["modeles/" + chemin, await stockage.lireModele(chemin)]);
  return zipper(entrees);
}

function verifierModeles() {
  const connues = new Set([...cfg.champs.map((c) => c.cle), ...CLES_CALCULEES]);
  const references = new Set(), lignes = [];
  for (const [categorie, liste] of [["Fiche navette", cfg.fiches_axone], ["Certificat", cfg.certificats]]) {
    for (const r of liste) {
      const chemin = inventaire.trouver(r.modele);
      if (chemin) references.add(chemin);
      const b = chemin ? inventaire.balises(chemin) : [];
      lignes.push({ categorie, modele: r.modele, trouve: chemin, types: r.types || [], aptitudes: r.aptitudes || [],
        balises: b, inconnues: b.filter((x) => !connues.has(x)) });
    }
  }
  return { lignes, orphelins: inventaire.fichiers.filter((f) => !references.has(f)), non_convertis: inventaire.nonConvertis,
    manquants: lignes.filter((l) => !l.trouve).length };
}

// ---------------------------------------------------------------- routeur
function erreur(message, code = 400, donnees = {}) {
  const e = new Error(message);
  e.code = code; e.donnees = { erreur: message, ...donnees };
  return e;
}

async function router(chemin, c) {
  switch (chemin) {
    case "signe": return { ok: true };
    case "etat": return etat();
    case "apercu": { const r = calculer(cfg, c.saisie || {}, inventaire); delete r.valeurs; return r; }
    case "generer": {
      let r;
      try { r = await generer(cfg, inventaire, c.saisie || {}, stockage.lireModele); } catch (e) {
        if (e instanceof SaisieIncomplete) throw erreur(e.message, 422, { alertes: e.alertes });
        throw e;
      }
      const id = identifiant();
      const dossier = `visite:${id}`;
      produits.set(dossier, { nom: r.dossier, fichiers: [] });
      const fichiers = r.fichiers.map((f) => {
        const ch = `${dossier}/${f.nom}`;
        produits.set(ch, { nom: f.nom, octets: f.octets });
        produits.get(dossier).fichiers.push(ch);
        return { titre: f.titre, chemin: ch, nom: f.nom, categorie: f.categorie, cases_cochees: f.cases_cochees };
      });
      let entree = null;
      if (cfg.general.historique_actif !== false) {
        const a = r.calcul.affichage, s = c.saisie || {};
        entree = { id, horodatage: new Date().toISOString().slice(0, 19), nom: a.NOM || "", prenom: a.PRENOM || "",
          dossier_patient: a.DOSSIER || "", date_rdv: a.DATE_RDV || "", date_vq: a.DATE_VQ || "", type_venue: a.TYPE_VENUE || "",
          dossier: r.dossier, fichiers: fichiers.map((f) => f.nom),
          saisie: { champs: s.champs, motifs: s.motifs, surcharges: s.surcharges } };
        const liste = [entree, ...(await lireHistorique())].slice(0, Number(cfg.general.historique_max || 500));
        await ecrireHistorique(liste);
      }
      return { dossier: r.dossier, cle_dossier: dossier, fichiers, alertes: r.alertes, historique: entree };
    }
    case "historique": return { entrees: await lireHistorique() };
    case "historique/supprimer": await ecrireHistorique((await lireHistorique()).filter((e) => e.id !== c.id)); return { ok: true };
    case "historique/vider": await ecrireHistorique([]); return { ok: true };
    case "ouvrir": {
      const p = produits.get(c.chemin);
      if (!p) throw erreur("Document plus disponible : générez-le à nouveau.");
      if (p.fichiers) {
        if (p.fichiers.length === 1) { const f = produits.get(p.fichiers[0]); await remettreFichier(f.nom, f.octets); }
        else await remettreFichier(p.nom + ".zip", await zipper(p.fichiers.map((ch) => [produits.get(ch).nom, produits.get(ch).octets])), "application/zip");
      } else {
        await remettreFichier(p.nom, p.octets);
      }
      return { ok: true };
    }
    case "ouvrir-modele": {
      const p = inventaire.trouver(c.modele || "");
      if (!p) throw erreur("Modèle introuvable");
      await remettreFichier(p.split("/").pop(), await stockage.lireModele(p));
      return { ok: true };
    }
    case "config": {
      const erreurs = controler(c.config);
      if (erreurs.length) throw erreur(erreurs.join("\n"));
      await stockage.ecrireReglage("config", c.config);
      await charger();
      return etat();
    }
    case "config/defaut": return { config: copie(await chargerDefaut()) };
    case "config/controler": return { erreurs: controler(c.config) };
    case "modeles/verifier": return verifierModeles();
    case "modeles/importer": return importer(c.fichiers || [], c.remplacer_etiquette !== false);
    case "modeles/supprimer": await stockage.supprimerModele(c.modele); await charger(); return { ok: true };
    case "modeles/balises": {
      const p = inventaire.trouver(c.modele || "");
      if (!p) throw erreur("Modèle introuvable");
      return { balises: inventaire.balises(p) };
    }
    case "exporter": return { nom: "VisitesPlongeurs-parametrage.zip", octets: await exporter() };
    default: throw erreur(`Action non disponible sur cet appareil : ${chemin}`, 404);
  }
}

let pret = null;
/** Même contrat que l'API HTTP du logiciel Windows. */
export async function appeler(chemin, corps) {
  if (!pret) pret = charger().then(() => stockage.demanderPersistance());
  await pret;
  const r = await router(chemin, corps || {});
  return chemin === "exporter" ? r : copie(r);
}
