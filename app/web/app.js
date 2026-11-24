/* Visites plongeurs — interface */
"use strict";

// ------------------------------------------------------------------ session
const JETON = (() => {
  const p = new URLSearchParams(location.search).get("t");
  if (p) {
    try { sessionStorage.setItem("jeton", p); } catch (e) { /* stockage indisponible */ }
    history.replaceState(null, "", "/");
    return p;
  }
  try { return sessionStorage.getItem("jeton"); } catch (e) { return null; }
})();

async function api(chemin, corps) {
  const r = await fetch("/api/" + chemin, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Jeton": JETON || "" },
    body: JSON.stringify(corps || {}),
  });
  let d;
  try { d = await r.json(); } catch (e) { d = { erreur: "Réponse illisible du programme." }; }
  if (!r.ok) {
    const err = new Error(d.erreur || r.statusText);
    err.donnees = d; err.code = r.status;
    throw err;
  }
  return d;
}

// ------------------------------------------------------------------ outils
const $ = (id) => document.getElementById(id);
function el(tag, attrs, ...enfants) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "texte") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "valeur") n.value = v;
    else if (v === true) n.setAttribute(k, "");
    else n.setAttribute(k, v);
  }
  for (const e of enfants.flat()) {
    if (e === null || e === undefined || e === false) continue;
    n.append(e instanceof Node ? e : document.createTextNode(String(e)));
  }
  return n;
}
const copie = (o) => JSON.parse(JSON.stringify(o));
function normaliserNom(s) {
  return (s || "").replace(/\\/g, "/").replace(/\.(docx|docm|dotx|doc|dot)$/i, "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase()
    .replace(/\s*\/\s*/g, "/");
}
function toast(message, erreur) {
  const t = $("toast");
  t.textContent = message;
  t.className = "toast visible" + (erreur ? " erreur" : "");
  clearTimeout(toast.minuterie);
  toast.minuterie = setTimeout(() => (t.className = "toast"), erreur ? 6000 : 3200);
}
function voile(texte) {
  $("voile").hidden = !texte;
  if (texte) $("voile-texte").textContent = texte;
}
function aujourdhui() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
function normaliserDate(s, naissance) {
  const t = (s || "").trim();
  if (!t) return "";
  const m = t.match(/^(\d{1,2})\s*[\/.\- ]\s*(\d{1,2})\s*[\/.\- ]\s*(\d{2}|\d{4})$/) || t.match(/^(\d{2})(\d{2})(\d{4}|\d{2})$/);
  if (!m) return t;
  let [, j, mo, a] = m;
  if (a.length === 2) {
    let n = 2000 + Number(a);
    if (naissance && n > new Date().getFullYear()) n -= 100;
    a = String(n);
  }
  return `${j.padStart(2, "0")}/${mo.padStart(2, "0")}/${a}`;
}

function transformer(v, t) {
  const s = (v || "").replace(/\s+/g, " ").trim();
  if (t === "maj") return s.toUpperCase();
  if (t === "min") return s.toLowerCase();
  if (t === "cap") return s.replace(/[\p{L}]+/gu, (m) => m[0].toUpperCase() + m.slice(1).toLowerCase());
  return v;
}

// ------------------------------------------------------------------ état
const E = {
  etat: null,
  cfg: null,
  saisie: null,
  apercu: null,
  vqPrecedente: null,
  brouillon: null,
  modifie: false,
  rubrique: "general",
  resultat: null,
};

function saisieVide() {
  return {
    champs: { DATE_RDV: aujourdhui() },
    motifs: [{ type: "", aptitude: "" }],
    surcharges: {},
    documents_exclus: [],
    documents_ajoutes: [],
  };
}

async function chargerEtat() {
  E.etat = await api("etat");
  E.cfg = E.etat.config;
  $("nom-application").textContent = E.cfg.general.nom_application || "Visites plongeurs";
  $("nom-service").textContent = E.cfg.general.nom_service || "";
  document.title = E.cfg.general.nom_application || "Visites plongeurs";
  $("bandeau-modeles").hidden = E.etat.modeles.length > 0;
  const dl = $("liste-modeles");
  dl.replaceChildren(...E.etat.modeles.map((m) => el("option", { value: m })));
}

// ------------------------------------------------------------------ navigation
function afficherVue(nom) {
  if (nom !== "parametres" && E.modifie && !confirm("Des paramètres ne sont pas enregistrés. Quitter quand même ?")) return;
  if (nom !== "parametres" && E.modifie) { E.modifie = false; E.brouillon = null; }
  for (const v of ["visite", "historique", "parametres", "aide"]) $("vue-" + v).hidden = v !== nom;
  document.querySelectorAll(".barre nav button").forEach((b) => {
    if (b.dataset.vue === nom) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  if (nom === "historique") chargerHistorique();
  if (nom === "parametres") ouvrirParametres();
  if (nom === "aide") remplirAide();
  window.scrollTo(0, 0);
}

// ================================================================== VISITE
function construireFormulaire() {
  const sections = { identite: $("champs-identite"), militaire: $("champs-militaire") };
  Object.values(sections).forEach((s) => s.replaceChildren());
  for (const c of E.cfg.champs) {
    const cible = sections[c.section];
    if (cible) cible.append(champSaisie(c));
  }
  $("repli-militaire").hidden = !E.cfg.champs.some((c) => c.section === "militaire");
  construireComplements();
}

function champSaisie(c, options = {}) {
  const id = "champ-" + c.cle;
  const valeur = E.saisie.champs[c.cle];
  let entree;
  if (c.type === "case") {
    entree = el("input", { type: "checkbox", id, "data-cle": c.cle });
    entree.checked = !!valeur;
    entree.addEventListener("change", () => { E.saisie.champs[c.cle] = entree.checked; planifierApercu(); });
    return el("div", { class: "champ", "data-champ": c.cle },
      el("span", { class: "label-vide" }, "\u00a0"),
      el("label", { class: "case", for: id }, entree, c.libelle),
      c.aide ? el("span", { class: "aide" }, c.aide) : null);
  }
  entree = el("input", {
    id, "data-cle": c.cle, valeur: valeur || "",
    class: [c.type === "date" ? "date" : "", c.cle === "NOM" ? "nom" : ""].join(" ").trim() || null,
    placeholder: c.type === "date" ? "jj/mm/aaaa" : (options.indication || ""),
    inputmode: c.type === "date" || c.type === "nombre" ? "numeric" : null,
    spellcheck: "false",
  });
  entree.addEventListener("input", () => { E.saisie.champs[c.cle] = entree.value; planifierApercu(); });
  if (c.transformation) {
    entree.addEventListener("blur", () => {
      const v = transformer(entree.value, c.transformation);
      if (v !== entree.value) { entree.value = v; E.saisie.champs[c.cle] = v; planifierApercu(); }
    });
  }
  if (c.type === "date") {
    entree.addEventListener("blur", () => {
      const n = normaliserDate(entree.value, c.cle === "DATE_NAISSANCE");
      if (n !== entree.value) { entree.value = n; E.saisie.champs[c.cle] = n; planifierApercu(); }
    });
  }
  return el("div", { class: "champ", "data-champ": c.cle },
    el("label", { for: id }, c.libelle, c.obligatoire ? el("span", { class: "requis", title: "obligatoire" }, "*") : null),
    entree,
    c.aide ? el("span", { class: "aide" }, c.aide) : null);
}

function construireComplements() {
  const zone = $("champs-complements");
  zone.replaceChildren();
  for (const c of E.cfg.champs.filter((c) => c.section === "complement")) zone.append(champSaisie(c));
  zone.querySelectorAll("[data-champ]").forEach((n) => (n.hidden = true));
}

function majComplements(apercu) {
  const zone = $("champs-complements");
  const visibles = new Set(apercu.champs_visibles);
  zone.querySelectorAll("[data-champ]").forEach((n) => {
    if (n.dataset.inconnu) return;
    n.hidden = !visibles.has(n.dataset.champ);
    const entree = n.querySelector("input:not([type=checkbox])");
    const def = E.cfg.champs.find((c) => c.cle === n.dataset.champ);
    if (entree && def && def.defaut && !entree.value) {
      const v = apercu.affichage[def.cle];
      entree.placeholder = v ? `${v} (par défaut)` : (def.type === "date" ? "jj/mm/aaaa" : "");
    }
  });
  // champs demandés par un modèle mais non déclarés
  const inconnus = new Map(apercu.champs_inconnus.map((i) => [i.cle, i]));
  zone.querySelectorAll("[data-inconnu]").forEach((n) => { if (!inconnus.has(n.dataset.champ)) n.remove(); });
  for (const [cle, info] of inconnus) {
    if (zone.querySelector(`[data-champ="${cle}"]`)) continue;
    const n = champSaisie({ cle, libelle: cle.replace(/_/g, " ").toLowerCase().replace(/^./, (x) => x.toUpperCase()),
      type: "texte", aide: "Demandé par : " + info.documents.join(", ") });
    n.dataset.inconnu = "1";
    zone.append(n);
  }
  const auMoinsUn = [...zone.querySelectorAll("[data-champ]")].some((n) => !n.hidden);
  $("bloc-complements").hidden = !auMoinsUn;
}

// ------------------------------------------------------------------ motifs
function construireMotifs() {
  const zone = $("motifs");
  zone.replaceChildren();
  E.saisie.motifs.forEach((m, i) => zone.append(blocMotif(m, i)));
  $("ajout-motif").hidden = E.saisie.motifs.length >= 2;
}

function blocMotif(m, i) {
  const types = E.cfg.types_visite;
  const parType = E.etat.aptitudes_par_type || {};
  const apts = Object.fromEntries(E.cfg.aptitudes.map((a) => [a.code, a]));
  const tete = el("div", { class: "motif-tete" },
    el("h3", {}, E.saisie.motifs.length > 1 ? `Type de venue ${i + 1}` : "Type de venue"),
    i > 0 ? el("button", { type: "button", class: "lien", onclick: () => { E.saisie.motifs.splice(i, 1); construireMotifs(); planifierApercu(); } }, "Retirer") : null);
  const grilleTypes = el("div", { class: "types", role: "group", "aria-label": "Type de visite" },
    types.map((t) => el("button", {
      type: "button", class: "type", "aria-pressed": String(m.type === t.code), title: t.libelle,
      onclick: () => {
        m.type = m.type === t.code ? "" : t.code;
        if (m.aptitude && !(parType[m.type] || []).includes(m.aptitude)) m.aptitude = "";
        construireMotifs(); planifierApercu();
      },
    }, el("b", {}, t.sigle || t.code), el("span", {}, t.libelle))));
  const bloc = el("div", { class: "motif" }, tete, grilleTypes);
  if (m.type) {
    const t = types.find((x) => x.code === m.type);
    const liste = parType[m.type] || [];
    if (liste.length) {
      bloc.append(el("div", { class: "aptitudes", role: "group", "aria-label": "Aptitude" },
        liste.map((code) => el("button", {
          type: "button", class: "aptitude", "aria-pressed": String(m.aptitude === code),
          title: apts[code] ? apts[code].libelle : code,
          onclick: () => { m.aptitude = m.aptitude === code ? "" : code; construireMotifs(); planifierApercu(); },
        }, apts[code] ? apts[code].sigle || code : code))));
      bloc.append(el("div", { class: "libelle-aptitude" }, m.aptitude && apts[m.aptitude] ? apts[m.aptitude].libelle : "Choisissez l'aptitude."));
    } else if (t && t.aptitude_requise !== false) {
      bloc.append(el("p", { class: "aptitudes-vide" }, "Aucune aptitude n'est rattachée à ce type. Ajoutez des certificats ou des fiches pour ce type dans Paramètres."));
    }
  }
  return bloc;
}

// ------------------------------------------------------------------ aperçu
function planifierApercu() {
  clearTimeout(planifierApercu.minuterie);
  planifierApercu.minuterie = setTimeout(calculerApercu, 220);
}

async function calculerApercu() {
  const numero = (calculerApercu.n = (calculerApercu.n || 0) + 1);
  try {
    const a = await api("apercu", { saisie: E.saisie });
    if (numero !== calculerApercu.n) return; // réponse périmée
    E.apercu = a;
    afficherApercu(a);
  } catch (e) {
    toast(e.message, true);
  }
}

function afficherApercu(a) {
  // cadran
  const age = $("cadran-age");
  age.replaceChildren(a.age === null || a.age === undefined ? "–" : String(a.age), a.age !== null && a.age !== undefined ? el("small", {}, "ans") : "");
  age.classList.toggle("vide", a.age === null || a.age === undefined);

  const vq = a.vq;
  const surchargeVq = (E.saisie.surcharges.DATE_VQ || "").trim();
  if (vq.mode === "saisie" && !surchargeVq && E.vqPrecedente) {
    E.saisie.surcharges.DATE_VQ = E.vqPrecedente;
    E.vqPrecedente = null;
    $("saisie-vq").value = E.saisie.surcharges.DATE_VQ;
    planifierApercu();
  }
  $("cadran-vq").textContent = vq.valeur || "–";
  $("cadran-vq").classList.toggle("vide", !vq.valeur);
  const notes = {
    calcul: `Rendez-vous + ${E.cfg.general.annees_vq || 4} ans, jour pour jour`,
    manuel: "Date modifiée à la main",
    saisie: "Visite annuelle ou expertise : saisissez la VQ déjà programmée",
    aucun: a.motifs.length ? "Pas de VQ pour ce type de visite" : "Choisissez un type de venue",
  };
  $("cadran-vq-note").textContent = notes[vq.mode] || "";
  const enEdition = vq.mode === "saisie" || vq.mode === "manuel" || $("cadran-vq-saisie").dataset.ouvert === "1";
  $("cadran-vq-saisie").hidden = !enEdition || vq.mode === "aucun";
  $("vq-modifier").hidden = !(vq.mode === "calcul" && !enEdition);
  $("vq-retablir").hidden = !(vq.mode === "manuel");

  const venue = $("saisie-venue");
  venue.placeholder = a.type_venue.auto || "Choisissez un type de venue";
  if (document.activeElement !== venue) venue.value = E.saisie.surcharges.TYPE_VENUE || a.type_venue.auto || "";
  $("venue-retablir").hidden = !E.saisie.surcharges.TYPE_VENUE;

  // documents
  const liste = $("liste-docs");
  liste.replaceChildren();
  if (!a.documents.length) {
    liste.append(el("li", { class: "vide-docs" }, a.motifs.length ? "Aucun document ne correspond." : "Les documents apparaîtront après le choix du type de venue."));
  }
  for (const d of a.documents) {
    const coche = el("input", { type: "checkbox", "aria-label": "Inclure " + d.titre });
    coche.checked = d.inclus;
    coche.addEventListener("change", () => {
      const ex = new Set(E.saisie.documents_exclus);
      if (coche.checked) ex.delete(d.cle); else ex.add(d.cle);
      if (!coche.checked && d.categorie === "ajout") {
        E.saisie.documents_ajoutes = E.saisie.documents_ajoutes.filter((x) => `ajout:${x}` !== d.cle);
        ex.delete(d.cle);
      }
      E.saisie.documents_exclus = [...ex];
      planifierApercu();
    });
    const sigle = d.categorie === "axone" ? "FN" : d.categorie === "certificat" ? "CA" : "W";
    liste.append(el("li", { class: "doc" + (d.inclus ? "" : " exclu") + (d.existe ? "" : " manquant") },
      coche,
      el("span", { class: "feuillet " + d.categorie, title: d.categorie === "axone" ? "Fiche navette" : d.categorie === "certificat" ? "Certificat" : "Document ajouté" }, sigle),
      el("div", { class: "titre" }, d.titre),
      el("div", { class: "fichier" }, d.chemin || d.modele),
      (d.a_verifier || !d.existe || d.categorie === "ajout") ? el("div", { class: "marques" },
        !d.existe ? el("span", { class: "marque-etat manque" }, "Modèle introuvable") : null,
        d.a_verifier ? el("span", { class: "marque-etat verifier", title: d.note || "" }, "Règle à vérifier") : null,
        d.categorie === "ajout" ? el("span", { class: "marque-etat ajout" }, "Ajouté à la main") : null) : null));
  }
  const n = a.documents.filter((d) => d.inclus).length;
  $("docs-compte").textContent = n ? `${n} à produire` : "";

  // ajout manuel
  const sel = $("ajout-doc");
  const deja = new Set(a.documents.map((d) => d.chemin));
  const groupes = {};
  for (const m of E.etat.modeles) {
    if (deja.has(m)) continue;
    const dossier = m.includes("/") ? m.slice(0, m.lastIndexOf("/")) : "Autres";
    (groupes[dossier] = groupes[dossier] || []).push(m);
  }
  sel.replaceChildren(el("option", { value: "" }, "Ajouter un autre document…"),
    ...Object.entries(groupes).map(([g, ms]) => el("optgroup", { label: g },
      ms.map((m) => el("option", { value: m }, m.slice(m.lastIndexOf("/") + 1).replace(/\.docx$/i, ""))))));
  sel.hidden = !E.etat.modeles.length;

  // alertes
  const al = $("alertes");
  al.replaceChildren(...a.alertes.filter((x) => !(x.niveau === "erreur" && /^Champ obligatoire|^Date du rendez-vous|^Choisissez au moins/.test(x.message) && !E.tentative))
    .map((x) => el("li", { class: "alerte " + x.niveau }, x.message)));
  document.querySelectorAll(".champ.en-erreur").forEach((n) => n.classList.remove("en-erreur"));
  if (E.tentative) {
    for (const c of E.cfg.champs) {
      if (a.alertes.some((x) => x.message === `Champ obligatoire : ${c.libelle}.`)) {
        const n = document.querySelector(`[data-champ="${c.cle}"]`);
        if (n) n.classList.add("en-erreur");
      }
    }
  }
  const bouton = $("generer");
  bouton.disabled = n === 0;
  bouton.textContent = n > 1 ? `Générer les ${n} documents` : n === 1 ? "Générer le document" : "Générer les documents";
  majComplements(a);
}

async function generer() {
  if ($("generer").disabled) return;
  E.tentative = true;
  if (!E.apercu) await calculerApercu();
  if (E.apercu && E.apercu.bloquant) {
    afficherApercu(E.apercu);
    const premiere = document.querySelector(".champ.en-erreur input");
    if (premiere) premiere.focus();
    toast("Complétez les éléments signalés en rouge.", true);
    return;
  }
  voile("Création des documents…");
  try {
    const r = await api("generer", { saisie: E.saisie });
    E.resultat = r;
    afficherResultat(r);
    if (E.cfg.general.ouvrir_dossier_apres_generation) ouvrir(r.dossier);
    toast(r.fichiers.length > 1 ? `${r.fichiers.length} documents créés` : "Document créé");
  } catch (e) {
    if (e.donnees && e.donnees.alertes) {
      E.apercu = Object.assign({}, E.apercu, { alertes: e.donnees.alertes });
      afficherApercu(E.apercu);
    }
    toast(e.message, true);
  } finally {
    voile(null);
  }
}

function afficherResultat(r) {
  $("resultat").hidden = false;
  $("resultat-titre").textContent = r.fichiers.length > 1 ? `${r.fichiers.length} documents créés` : "Document créé";
  $("resultat-chemin").textContent = r.dossier;
  $("resultat-fichiers").replaceChildren(...r.fichiers.map((f) => el("li", {},
    el("span", {}, f.nom), el("button", { type: "button", class: "lien", onclick: () => ouvrir(f.chemin) }, "Ouvrir"))));
  $("res-imprimer").hidden = !E.etat.windows;
  const autres = r.alertes.filter((a) => a.niveau !== "erreur" && !E.apercu.alertes.some((b) => b.message === a.message));
  if (autres.length) $("alertes").append(...autres.map((x) => el("li", { class: "alerte " + x.niveau }, x.message)));
  $("resultat").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function ouvrir(chemin) {
  try { await api("ouvrir", { chemin }); } catch (e) { toast(e.message, true); }
}

function nouvelleVisite(conserver) {
  E.saisie = conserver || saisieVide();
  E.tentative = false;
  E.resultat = null;
  $("resultat").hidden = true;
  $("cadran-vq-saisie").dataset.ouvert = "";
  $("saisie-vq").value = E.saisie.surcharges.DATE_VQ || "";
  $("champ-DATE_RDV").value = E.saisie.champs.DATE_RDV || "";
  construireFormulaire();
  construireMotifs();
  const militaire = E.cfg.champs.filter((c) => c.section === "militaire").some((c) => E.saisie.champs[c.cle]);
  $("repli-militaire").open = militaire || $("repli-militaire").open;
  calculerApercu();
  const nom = $("champ-NOM");
  if (nom) nom.focus();
}

function brancherVisite() {
  $("champ-DATE_RDV").addEventListener("input", (e) => { E.saisie.champs.DATE_RDV = e.target.value; planifierApercu(); });
  $("champ-DATE_RDV").addEventListener("blur", (e) => {
    const n = normaliserDate(e.target.value, false);
    if (n !== e.target.value) { e.target.value = n; E.saisie.champs.DATE_RDV = n; planifierApercu(); }
  });
  $("rdv-aujourdhui").addEventListener("click", () => {
    $("champ-DATE_RDV").value = E.saisie.champs.DATE_RDV = aujourdhui(); planifierApercu();
  });
  $("ajout-motif").addEventListener("click", () => {
    E.saisie.motifs.push({ type: "", aptitude: "" }); construireMotifs(); planifierApercu();
  });
  $("saisie-vq").addEventListener("input", (e) => { E.saisie.surcharges.DATE_VQ = e.target.value; planifierApercu(); });
  $("saisie-vq").addEventListener("blur", (e) => {
    const n = normaliserDate(e.target.value, false);
    if (n !== e.target.value) { e.target.value = n; E.saisie.surcharges.DATE_VQ = n; planifierApercu(); }
  });
  $("vq-modifier").addEventListener("click", () => {
    $("cadran-vq-saisie").dataset.ouvert = "1";
    $("saisie-vq").value = E.apercu && E.apercu.vq.valeur || "";
    $("cadran-vq-saisie").hidden = false; $("vq-modifier").hidden = true;
    $("saisie-vq").focus(); $("saisie-vq").select();
  });
  $("vq-retablir").addEventListener("click", () => {
    delete E.saisie.surcharges.DATE_VQ; $("saisie-vq").value = "";
    $("cadran-vq-saisie").dataset.ouvert = ""; planifierApercu();
  });
  $("saisie-venue").addEventListener("input", (e) => {
    const v = e.target.value.trim();
    if (!v || (E.apercu && v === E.apercu.type_venue.auto)) delete E.saisie.surcharges.TYPE_VENUE;
    else E.saisie.surcharges.TYPE_VENUE = e.target.value;
    planifierApercu();
  });
  $("venue-retablir").addEventListener("click", () => { delete E.saisie.surcharges.TYPE_VENUE; $("saisie-venue").value = ""; planifierApercu(); });
  $("ajout-doc").addEventListener("change", (e) => {
    if (!e.target.value) return;
    E.saisie.documents_ajoutes.push(e.target.value); e.target.value = ""; planifierApercu();
  });
  $("generer").addEventListener("click", generer);
  $("res-dossier").addEventListener("click", () => E.resultat && ouvrir(E.resultat.dossier));
  $("res-imprimer").addEventListener("click", async () => {
    if (!E.resultat) return;
    try { await api("imprimer", { chemins: E.resultat.fichiers.map((f) => f.chemin) }); toast("Envoyé à l'imprimante par défaut"); }
    catch (e) { toast(e.message, true); }
  });
  $("res-nouvelle").addEventListener("click", () => nouvelleVisite());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !$("vue-visite").hidden) { e.preventDefault(); generer(); }
  });
  $("formulaire").addEventListener("submit", (e) => e.preventDefault());
}

// ================================================================== HISTORIQUE
async function chargerHistorique() {
  try {
    const { entrees } = await api("historique");
    E.historique = entrees;
    afficherHistorique();
  } catch (e) { toast(e.message, true); }
}

function afficherHistorique() {
  const q = normaliserNom($("recherche-historique").value);
  const lignes = (E.historique || []).filter((h) => !q || normaliserNom([h.nom, h.prenom, h.dossier_patient, h.type_venue, h.date_rdv].join(" ")).includes(q));
  $("historique-vide").hidden = lignes.length > 0;
  $("corps-historique").replaceChildren(...lignes.map((h) => el("tr", {},
    el("td", { class: "nb" }, h.date_rdv),
    el("td", {}, el("strong", {}, h.nom)),
    el("td", {}, h.prenom),
    el("td", { class: "nb" }, h.dossier_patient),
    el("td", {}, h.type_venue),
    el("td", { class: "nb" }, new Date(h.horodatage).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })),
    el("td", {}, el("div", { class: "actions" },
      el("button", { type: "button", class: "bouton petit", onclick: () => reprendre(h), title: "Préremplir une nouvelle visite avec cette identité" }, "Nouvelle visite"),
      el("button", { type: "button", class: "bouton petit", onclick: () => ouvrir(h.dossier) }, "Dossier"),
      el("button", { type: "button", class: "bouton petit danger", onclick: () => supprimerHistorique(h) }, "Retirer"))))));
}

function reprendre(h) {
  const s = saisieVide();
  const ancien = (h.saisie && h.saisie.champs) || {};
  for (const c of E.cfg.champs) if (c.section !== "complement" && ancien[c.cle] !== undefined) s.champs[c.cle] = ancien[c.cle];
  s.motifs = copie((h.saisie && h.saisie.motifs && h.saisie.motifs.length) ? h.saisie.motifs : [{ type: "", aptitude: "" }]);
  E.vqPrecedente = h.date_vq || null;
  afficherVue("visite");
  nouvelleVisite(s);
  toast(`Identité de ${h.nom} ${h.prenom} reprise. Vérifiez le type de venue.`);
}

async function supprimerHistorique(h) {
  if (!confirm(`Retirer la visite de ${h.nom} ${h.prenom} de l'historique ? Les documents déjà créés ne sont pas supprimés.`)) return;
  await api("historique/supprimer", { id: h.id });
  chargerHistorique();
}

// ================================================================== PARAMÈTRES
const RUBRIQUES = {
  general: { titre: "Général", rendu: rubriqueGeneral },
  champs: {
    titre: "Champs de saisie", cle: "champs",
    intro: "Les informations demandées à la saisie. Le code est le nom de la balise à placer dans les modèles ({{CODE}}). Section « complément » : le champ n'apparaît que si un document choisi l'utilise, ou pour les aptitudes indiquées.",
    nouveau: () => ({ cle: "", libelle: "", type: "texte", section: "complement" }),
    colonnes: [
      { cle: "cle", titre: "Code (balise)", type: "texte", classe: "court", majuscules: true },
      { cle: "libelle", titre: "Libellé", type: "texte", classe: "col-libelle" },
      { cle: "type", titre: "Type", type: "choix", options: [["texte", "Texte"], ["date", "Date"], ["case", "Case à cocher"], ["nombre", "Nombre"]] },
      { cle: "section", titre: "Section", type: "choix", options: [["identite", "Identité"], ["militaire", "Grade, matricule…"], ["complement", "Complément"]] },
      { cle: "obligatoire", titre: "Oblig.", type: "case" },
      { cle: "transformation", titre: "Écriture", type: "choix", options: [["", "Telle quelle"], ["maj", "MAJUSCULES"], ["cap", "Première lettre"], ["min", "minuscules"]] },
      { cle: "defaut", titre: "Valeur par défaut", type: "texte", indication: "=DATE_RDV" },
      { cle: "afficher_si_aptitudes", titre: "Afficher pour", type: "liste", indication: "CAT3" },
      { cle: "aide", titre: "Aide", type: "texte" },
    ],
  },
  types: {
    titre: "Types de visite", cle: "types_visite",
    intro: "Calcul de la VQ : « RDV + 4 ans » la recalcule, « à saisir » demande la VQ déjà programmée (annuelle, expertise). La colonne « Case cochée si » est une expression qui désigne la ligne « aptitude … » à cocher dans le certificat.",
    nouveau: () => ({ code: "", sigle: "", libelle: "", calcul_vq: "rdv", cases: "" }),
    colonnes: [
      { cle: "code", titre: "Code", type: "texte", classe: "court", majuscules: true },
      { cle: "sigle", titre: "Sigle imprimé", type: "texte", classe: "court" },
      { cle: "libelle", titre: "Libellé", type: "texte", classe: "col-libelle" },
      { cle: "calcul_vq", titre: "Prochaine VQ", type: "choix", options: [["rdv", "RDV + 4 ans"], ["saisie", "À saisir"], ["aucun", "Aucune"]] },
      { cle: "cases", titre: "Case cochée si le libellé contient", type: "texte" },
      { cle: "aptitude_requise", titre: "Aptitude requise", type: "case", defaut: true },
    ],
  },
  aptitudes: {
    titre: "Aptitudes", cle: "aptitudes",
    intro: "Le sigle s'imprime dans le type de venue (ex. VQ PLB). Une aptitude n'est proposée pour un type de visite que si un certificat ou une fiche navette la rattache à ce type.",
    nouveau: () => ({ code: "", sigle: "", libelle: "" }),
    colonnes: [
      { cle: "code", titre: "Code", type: "texte", classe: "court", majuscules: true },
      { cle: "sigle", titre: "Sigle imprimé", type: "texte" },
      { cle: "libelle", titre: "Libellé", type: "texte", classe: "col-libelle" },
      { cle: "sans_certificat", titre: "Sans certificat", type: "case" },
    ],
  },
  fiches: {
    titre: "Fiches navette AXONE", cle: "fiches_axone",
    intro: "Une seule fiche est produite par visite : la règle applicable de plus haute priorité l'emporte. Types ou aptitudes vides : toutes. Les âges sont inclusifs (40 à 49 = de 40 ans révolus à 49 ans). Conditions : CLE=oui ou CLE=non, séparées par « ; ».",
    nouveau: () => ({ modele: "", titre: "", types: [], aptitudes: [], priorite: 50 }),
    colonnes: [
      { cle: "modele", titre: "Modèle Word", type: "modele", classe: "col-modele" },
      { cle: "titre", titre: "Titre", type: "texte", classe: "col-titre" },
      { cle: "types", titre: "Types", type: "liste", classe: "court" },
      { cle: "aptitudes", titre: "Aptitudes", type: "liste" },
      { cle: "age_min", titre: "Âge min", type: "nombre", classe: "tres-court" },
      { cle: "age_max", titre: "Âge max", type: "nombre", classe: "tres-court" },
      { cle: "conditions", titre: "Conditions", type: "conditions", classe: "court" },
      { cle: "priorite", titre: "Priorité", type: "nombre", classe: "tres-court" },
      { cle: "a_verifier", titre: "À vérifier", type: "case" },
      { cle: "note", titre: "Note", type: "texte" },
    ],
  },
  certificats: {
    titre: "Certificats", cle: "certificats",
    intro: "Un certificat est produit pour chaque type de venue. Une ligne à plusieurs aptitudes (ex. CAT1, NC) sert de certificat combiné quand les deux sont demandées ensemble.",
    nouveau: () => ({ modele: "", types: [], aptitudes: [] }),
    colonnes: [
      { cle: "modele", titre: "Modèle Word", type: "modele", classe: "col-modele" },
      { cle: "titre", titre: "Titre (facultatif)", type: "texte", classe: "col-titre" },
      { cle: "types", titre: "Types", type: "liste", classe: "court" },
      { cle: "aptitudes", titre: "Aptitudes", type: "liste" },
    ],
  },
  modeles: { titre: "Modèles Word", rendu: rubriqueModeles, sansEnregistrement: true },
};

function ouvrirParametres() {
  if (!E.brouillon) { E.brouillon = copie(E.cfg); E.modifie = false; }
  afficherRubrique(E.rubrique);
}

function marquerModifie() {
  E.modifie = true;
  const etat = $("etat-param");
  etat.textContent = "Modifications non enregistrées.";
  etat.classList.add("modifie");
}

function afficherRubrique(nom) {
  E.rubrique = nom;
  document.querySelectorAll(".sous-nav button").forEach((b) => {
    if (b.dataset.rubrique === nom) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  const r = RUBRIQUES[nom];
  const zone = $("editeur");
  zone.replaceChildren();
  if (r.rendu) r.rendu(zone);
  else zone.append(el("h1", {}, r.titre), el("p", { class: "intro" }, r.intro), editeurTableau(r));
  $("barre-param").hidden = !!r.sansEnregistrement;
  const etat = $("etat-param");
  etat.textContent = E.modifie ? "Modifications non enregistrées." : "Aucune modification.";
  etat.classList.toggle("modifie", E.modifie);
}

function versTexte(col, v) {
  if (col.type === "liste") return (v || []).join(", ");
  if (col.type === "conditions") return Object.entries(v || {}).map(([k, x]) => `${k}=${x === true ? "oui" : x === false ? "non" : x}`).join("; ");
  return v === undefined || v === null ? "" : String(v);
}
function depuisTexte(col, s) {
  if (col.type === "liste") return s.split(/[,;\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
  if (col.type === "conditions") {
    const o = {};
    for (const morceau of s.split(";")) {
      const [k, ...reste] = morceau.split("=");
      if (!k || !k.trim()) continue;
      const v = reste.join("=").trim().toLowerCase();
      o[k.trim().toUpperCase()] = ["oui", "vrai", "1"].includes(v) ? true : ["non", "faux", "0"].includes(v) ? false : reste.join("=").trim();
    }
    return o;
  }
  if (col.type === "nombre") return s.trim() === "" ? undefined : Number(s);
  if (col.majuscules) return s.toUpperCase().replace(/\s+/g, "_");
  return s;
}

function editeurTableau(r) {
  const liste = E.brouillon[r.cle];
  const connus = new Set(E.etat.modeles.map(normaliserNom));
  const corps = el("tbody");
  const redessiner = () => { const n = editeurTableau(r); $("editeur").querySelector(".cadre-tableau").replaceWith(n); };
  liste.forEach((ligne, i) => {
    const tr = el("tr");
    for (const col of r.colonnes) {
      const td = el("td", { class: col.type === "case" ? "case-col" : col.classe || null });
      let entree;
      if (col.type === "case") {
        entree = el("input", { type: "checkbox", "aria-label": col.titre });
        entree.checked = ligne[col.cle] === undefined ? !!col.defaut : !!ligne[col.cle];
        entree.addEventListener("change", () => { ligne[col.cle] = entree.checked; marquerModifie(); });
      } else if (col.type === "choix") {
        entree = el("select", { "aria-label": col.titre }, col.options.map(([v, t]) => el("option", { value: v }, t)));
        entree.value = ligne[col.cle] || "";
        entree.addEventListener("change", () => { if (entree.value) ligne[col.cle] = entree.value; else delete ligne[col.cle]; marquerModifie(); });
      } else {
        entree = el("input", { valeur: versTexte(col, ligne[col.cle]), "aria-label": col.titre, placeholder: col.indication || null,
          list: col.type === "modele" ? "liste-modeles" : null, spellcheck: "false" });
        entree.addEventListener("input", () => {
          const v = depuisTexte(col, entree.value);
          if (v === undefined || v === "" || (Array.isArray(v) && !v.length && col.type !== "liste") || (col.type === "conditions" && !Object.keys(v).length)) delete ligne[col.cle];
          else ligne[col.cle] = v;
          if (col.type === "modele") td.classList.toggle("manquant", !!entree.value && !connus.has(normaliserNom(entree.value)));
          marquerModifie();
        });
        if (col.type === "modele") {
          td.classList.toggle("manquant", !!ligne.modele && !connus.has(normaliserNom(ligne.modele)));
          td.title = ligne.modele || "";
        }
      }
      td.append(entree);
      tr.append(td);
    }
    tr.append(el("td", {}, el("div", { class: "poignees" },
      el("button", { type: "button", title: "Monter", "aria-label": "Monter", onclick: () => { if (i > 0) { [liste[i - 1], liste[i]] = [liste[i], liste[i - 1]]; marquerModifie(); redessiner(); } } }, "↑"),
      el("button", { type: "button", title: "Descendre", "aria-label": "Descendre", onclick: () => { if (i < liste.length - 1) { [liste[i + 1], liste[i]] = [liste[i], liste[i + 1]]; marquerModifie(); redessiner(); } } }, "↓"),
      el("button", { type: "button", title: "Supprimer la ligne", "aria-label": "Supprimer la ligne", onclick: () => { liste.splice(i, 1); marquerModifie(); redessiner(); } }, "✕"))));
    corps.append(tr);
  });
  const tableau = el("table", { class: "tableau" },
    el("thead", {}, el("tr", {}, r.colonnes.map((c) => el("th", {}, c.titre)), el("th", {}))), corps);
  return el("div", { class: "cadre-tableau" }, tableau,
    el("div", { style: "padding:10px 12px" }, el("button", { type: "button", class: "bouton petit", onclick: () => { liste.push(r.nouveau()); marquerModifie(); redessiner(); } }, "Ajouter une ligne")));
}

function rubriqueGeneral(zone) {
  const g = E.brouillon.general;
  const champs = [
    ["nom_application", "Nom de l'application", "texte"],
    ["nom_service", "Nom du service", "texte"],
    ["ville", "Ville (balise {{VILLE}})", "texte"],
    ["format_date", "Format des dates par défaut", "texte", "jj/mm/aaaa"],
    ["annees_vq", "Délai de la prochaine VQ (années)", "nombre"],
    ["separateur_types", "Séparateur d'une double venue", "texte", " + "],
    ["dossier_modeles", "Dossier des modèles", "texte", "modeles", "Chemin relatif au dossier de l'application, ou chemin complet (lecteur réseau possible)."],
    ["dossier_sortie", "Dossier des documents générés", "texte", "Documents générés", "Un sous-dossier est créé par visite."],
    ["nom_dossier_visite", "Nom du dossier d'une visite", "texte", "", "Balises entre accolades simples : {DATE_RDV:aaaa-mm-jj} {NOM} {PRENOM} ({DOSSIER})"],
    ["nom_fichier", "Nom des fichiers", "texte", "", "{NUMERO} = ordre du document, {TITRE} = titre de la fiche ou du certificat."],
    ["motif_case_aptitude", "Cases d'aptitude (libellé commençant par)", "texte", "", "Expression appliquée au texte qui suit chaque case des certificats."],
    ["historique_max", "Nombre de visites gardées dans l'historique", "nombre"],
  ];
  const cases = [
    ["cocher_cases_aptitude", "Cocher la ligne « aptitude … » du certificat selon le type de visite"],
    ["ouvrir_dossier_apres_generation", "Ouvrir automatiquement le dossier de la visite après génération"],
    ["historique_actif", "Garder un historique des visites sur ce poste"],
  ];
  const form = el("div", { class: "formulaire-general" });
  for (const [cle, libelle, type, indication, aide] of champs) {
    const entree = el("input", { valeur: g[cle] === undefined ? "" : String(g[cle]), placeholder: indication || null, spellcheck: "false" });
    entree.addEventListener("input", () => { g[cle] = type === "nombre" ? Number(entree.value) : entree.value; marquerModifie(); });
    form.append(el("div", { class: "champ" + (aide ? " large" : "") }, el("label", {}, libelle), entree, aide ? el("span", { class: "aide" }, aide) : null));
  }
  for (const [cle, libelle] of cases) {
    const c = el("input", { type: "checkbox" });
    c.checked = !!g[cle];
    c.addEventListener("change", () => { g[cle] = c.checked; marquerModifie(); });
    form.append(el("div", { class: "champ large" }, el("label", { class: "case" }, c, libelle)));
  }
  zone.append(el("h1", {}, "Général"),
    el("p", { class: "intro" }, `Dossier de l'application : ${E.etat.travail}. Le paramétrage est enregistré dans config\\config.json ; chaque enregistrement garde une copie de la version précédente.`),
    form);
}

function rubriqueModeles(zone) {
  const source = el("input", { placeholder: "Ex. : C:\\Users\\…\\Documents\\Visites plongeurs (dossier qui contient vos sous-dossiers)", spellcheck: "false" });
  const etiquette = el("input", { type: "checkbox" });
  etiquette.checked = true;
  const rapport = el("div");
  const parcourir = el("button", { type: "button", class: "bouton", onclick: async () => {
    try { const r = await api("parcourir", { titre: "Dossier contenant vos documents Word d'origine" }); if (r.chemin) source.value = r.chemin; }
    catch (e) { toast(e.message, true); }
  } }, "Parcourir…");
  parcourir.hidden = !E.etat.windows;
  const importer = el("button", { type: "button", class: "bouton principal", onclick: async () => {
    if (!source.value.trim()) { toast("Indiquez le dossier de vos documents d'origine.", true); return; }
    voile("Import et préparation des modèles… Word peut s'ouvrir en arrière-plan, cela prend environ une seconde par fichier.");
    try {
      const r = await api("modeles/importer", { source: source.value, remplacer_etiquette: etiquette.checked });
      await chargerEtat();
      rapport.replaceChildren(rapportImport(r));
      toast(`${r.fichiers.length} fichier(s) importé(s)`);
    } catch (e) { toast(e.message, true); } finally { voile(null); }
  } }, "Importer et préparer");

  const verif = el("div");
  const verifier = el("button", { type: "button", class: "bouton", onclick: async () => {
    try { verif.replaceChildren(rapportVerification(await api("modeles/verifier"))); }
    catch (e) { toast(e.message, true); }
  } }, "Vérifier les modèles");

  zone.append(
    el("h1", {}, "Modèles Word"),
    el("p", { class: "intro" }, `${E.etat.modeles.length} modèle(s) dans ${E.etat.dossier_modeles}.`),
    el("div", { class: "encart" },
      el("h2", {}, "Importer vos documents d'origine"),
      el("p", {}, "Choisissez le dossier qui contient vos sous-dossiers (FICHES NAVETTE AXONE, expertise seule, initiale, initiale réact, quadriennale). Les .doc sont convertis en .docx, les balises sont posées automatiquement et les données d'anciens patients restées dans les fiches sont effacées. Vos fichiers d'origine ne sont pas modifiés ; un modèle déjà présent est sauvegardé avant d'être remplacé."),
      el("div", { class: "rangee" }, source, parcourir),
      el("p", {}, el("label", { class: "case" }, etiquette, "Remplacer l'encart « ETIQUETTE AMADEUS » des fiches navette par le nom, le prénom et la date de naissance")),
      el("div", { class: "rangee" }, importer),
      rapport),
    el("div", { class: "encart" },
      el("h2", {}, "Contrôler les modèles"),
      el("p", {}, "Liste chaque modèle déclaré dans les règles, indique s'il est présent et quelles balises il contient. Les balises surlignées en jaune ne correspondent à aucun champ : elles seront demandées dans « Compléments »."),
      el("div", { class: "rangee" }, verifier,
        el("button", { type: "button", class: "bouton", onclick: () => api("ouvrir-dossier", { quel: "modeles" }).catch((e) => toast(e.message, true)) }, "Ouvrir le dossier des modèles"),
        el("button", { type: "button", class: "bouton", onclick: () => api("ouvrir-dossier", { quel: "sortie" }).catch((e) => toast(e.message, true)) }, "Ouvrir le dossier des documents générés")),
      verif));
}

function rapportImport(r) {
  const t = r.totaux;
  return el("div", {},
    el("p", {}, `${t.ok} prêt(s), ${t.attention} à contrôler, ${t.erreur} en erreur.` + (r.sauvegarde ? ` Anciens modèles sauvegardés dans ${r.sauvegarde}.` : "")),
    el("div", { class: "cadre-tableau" }, el("table", { class: "tableau" },
      el("thead", {}, el("tr", {}, el("th", {}, "Fichier"), el("th", {}, "État"), el("th", {}, "Balises posées"), el("th", {}, "Remarques"))),
      el("tbody", {}, r.fichiers.map((f) => el("tr", {},
        el("td", {}, f.fichier),
        el("td", {}, el("span", { class: "statut " + f.statut }, { ok: "Prêt", attention: "À contrôler", erreur: "Erreur" }[f.statut])),
        el("td", {}, el("div", { class: "balises-liste" }, f.balises.map((b) => el("code", {}, b)))),
        el("td", {}, f.remarques.join(" "), f.infos && f.infos.length ? el("div", { class: "aide" }, f.infos.join(" ")) : null)))))));
}

function rapportVerification(r) {
  return el("div", {},
    el("p", {}, r.manquants ? `${r.manquants} modèle(s) déclaré(s) introuvable(s).` : "Tous les modèles déclarés sont présents.",
      r.non_convertis.length ? ` ${r.non_convertis.length} fichier(s) .doc à importer pour les convertir.` : ""),
    el("div", { class: "cadre-tableau" }, el("table", { class: "tableau" },
      el("thead", {}, el("tr", {}, el("th", {}, "Document"), el("th", {}, "Règle"), el("th", {}, "État"), el("th", {}, "Balises"), el("th", {}))),
      el("tbody", {}, r.lignes.map((l) => el("tr", {},
        el("td", {}, el("div", {}, l.modele), el("small", {}, l.categorie)),
        el("td", {}, el("div", {}, l.types.join(", ") || "tous types"), el("small", {}, l.aptitudes.join(", ") || "toutes aptitudes")),
        el("td", {}, el("span", { class: "statut " + (l.trouve ? "ok" : "erreur") }, l.trouve ? "Présent" : "Introuvable")),
        el("td", {}, el("div", { class: "balises-liste" }, l.balises.map((b) => el("code", { class: l.inconnues.includes(b) ? "inconnue" : null }, b)))),
        el("td", {}, l.trouve ? el("button", { type: "button", class: "bouton petit", onclick: () => api("ouvrir-modele", { modele: l.trouve }).catch((e) => toast(e.message, true)) }, "Ouvrir dans Word") : null)))))),
    r.orphelins.length ? el("p", {}, `Modèles présents mais utilisés par aucune règle (ajoutables à la main) : ${r.orphelins.join(" ; ")}`) : null);
}

async function enregistrerParametres() {
  try {
    const { erreurs } = await api("config/controler", { config: E.brouillon });
    if (erreurs.length) { alert("Le paramétrage contient des erreurs :\n\n" + erreurs.join("\n")); return; }
    E.etat = await api("config", { config: E.brouillon });
    E.cfg = E.etat.config;
    E.brouillon = copie(E.cfg);
    E.modifie = false;
    afficherRubrique(E.rubrique);
    await chargerEtat();
    nouvelleVisite(E.saisie);
    afficherVue("parametres");
    toast("Paramètres enregistrés");
  } catch (e) { toast(e.message, true); }
}

// ================================================================== AIDE
function remplirAide() {
  const calculees = [
    ["DATE_RDV", "Date du rendez-vous"], ["DATE_VQ", "Date de la prochaine visite quadriennale"],
    ["AGE", "Âge révolu au rendez-vous"], ["TYPE_VENUE", "Type de venue, ex. VQ PLD + VE ENTOPS"],
    ["TYPE_VISITE", "Sigle(s) du type de visite"], ["APTITUDE", "Sigle(s) de l'aptitude"], ["APTITUDE_LIBELLE", "Libellé(s) de l'aptitude"],
    ["NOM_PRENOM", "Nom et prénom"], ["IDENTITE", "Nom prénom, puis « Né(e) le … » à la ligne"],
    ["VILLE", "Ville du service"], ["NOM_SERVICE", "Nom du service"], ["DATE_JOUR", "Date du jour de génération"],
  ];
  const lignes = E.cfg.champs.map((c) => [c.cle, c.libelle + (c.type === "date" ? " (date)" : c.type === "case" ? " (case)" : "")]).concat(calculees);
  document.querySelector("#table-balises tbody").replaceChildren(...lignes.map(([cle, lib]) =>
    el("tr", {}, el("td", {}, el("code", { class: "balise" }, `{{${cle}}}`)), el("td", {}, lib))));
  $("aide-dossiers").textContent = `Modèles : ${E.etat.dossier_modeles}. Documents générés : ${E.etat.dossier_sortie}. Paramétrage : ${E.etat.travail}\\config\\config.json. Version ${E.etat.version}.`;
}

// ================================================================== démarrage
async function demarrer() {
  if (!JETON) {
    document.body.replaceChildren(el("p", { style: "padding:40px" }, "Lancez l'application depuis VisitesPlongeurs.exe."));
    return;
  }
  try {
    await chargerEtat();
  } catch (e) {
    document.body.replaceChildren(el("p", { style: "padding:40px" }, e.message));
    return;
  }
  E.saisie = saisieVide();
  document.querySelectorAll(".barre nav button").forEach((b) => b.addEventListener("click", () => afficherVue(b.dataset.vue)));
  document.querySelectorAll(".sous-nav button").forEach((b) => b.addEventListener("click", () => afficherRubrique(b.dataset.rubrique)));
  document.querySelectorAll("[data-aller]").forEach((b) => b.addEventListener("click", () => { E.rubrique = b.dataset.aller; afficherVue("parametres"); }));
  $("recherche-historique").addEventListener("input", afficherHistorique);
  $("vider-historique").addEventListener("click", async () => {
    if (!confirm("Effacer tout l'historique ? Les documents déjà créés ne sont pas supprimés.")) return;
    await api("historique/vider"); chargerHistorique();
  });
  $("param-enregistrer").addEventListener("click", enregistrerParametres);
  $("param-annuler").addEventListener("click", () => { E.brouillon = copie(E.cfg); E.modifie = false; afficherRubrique(E.rubrique); });
  $("param-defaut").addEventListener("click", async () => {
    if (!confirm("Remplacer tout le paramétrage par les réglages d'origine ? Rien n'est enregistré tant que vous ne cliquez pas sur « Enregistrer ».")) return;
    E.brouillon = (await api("config/defaut")).config; marquerModifie(); afficherRubrique(E.rubrique);
  });
  window.addEventListener("beforeunload", (e) => { if (E.modifie) { e.preventDefault(); e.returnValue = ""; } });
  brancherVisite();
  nouvelleVisite();
  setInterval(() => api("signe").catch(() => {}), 15000);
}

demarrer();
