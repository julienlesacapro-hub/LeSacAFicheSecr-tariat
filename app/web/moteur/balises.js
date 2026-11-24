// Grammaire des balises placées dans les modèles Word (équivalent de app/balises.py).
//   {{CLE}}  {{CLE:format}}  {{CLE+1a:format}}  {{CLE|maj}}
import { Jour, ajouter, formater } from "./dates.js";

const SOURCE = String.raw`\{\{\s*(?<cle>[A-Za-z][A-Za-z0-9_]*)(?<decalage>(?:\s*[+-]\s*\d+\s*[ajmAJM])*)\s*(?::(?<format>[^|{}]*?))?\s*(?<filtres>(?:\|\s*[A-Za-z]+\s*)*)\}\}`;
const DECALAGE = /([+-])\s*(\d+)\s*([ajmAJM])/g;

function depuisMatch(m) {
  const g = m.groups;
  const decalages = [...(g.decalage || "").matchAll(DECALAGE)].map((d) => [d[1], parseInt(d[2], 10), d[3].toLowerCase()]);
  const filtres = (g.filtres || "").split("|").map((f) => f.trim().toLowerCase()).filter(Boolean);
  const fmt = g.format;
  return { brut: m[0], cle: g.cle.toUpperCase(), decalages, format: fmt && fmt.trim() ? fmt.trim() : null, filtres };
}

export function analyser(texte) {
  const m = new RegExp("^" + SOURCE + "$").exec(texte.trim());
  return m ? depuisMatch(m) : null;
}

/** Balises d'un texte : [début, fin, balise]. */
export function trouver(texte) {
  const res = [];
  for (const m of texte.matchAll(new RegExp(SOURCE, "g"))) res.push([m.index, m.index + m[0].length, depuisMatch(m)]);
  return res;
}

export function capitaliser(texte) {
  return texte.replace(/\p{L}+/gu, (m) => m[0].toUpperCase() + m.slice(1).toLowerCase());
}

/** Retourne [texte, connue] ; connue est faux si la clé n'existe pas. */
export function resoudre(b, valeurs, formatDefaut = "jj/mm/aaaa") {
  if (!Object.prototype.hasOwnProperty.call(valeurs, b.cle)) return ["", false];
  let v = valeurs[b.cle];
  let texte;
  if (v instanceof Jour) {
    for (const [signe, n0, unite] of b.decalages) {
      const n = signe === "+" ? n0 : -n0;
      v = ajouter(v, { annees: unite === "a" ? n : 0, mois: unite === "m" ? n : 0, jours: unite === "j" ? n : 0 });
    }
    texte = formater(v, b.format || formatDefaut);
  } else if (typeof v === "boolean") {
    texte = b.filtres.includes("x") ? (v ? "X" : "") : (v ? "Oui" : "Non");
  } else if (v === null || v === undefined) {
    texte = "";
  } else {
    texte = String(v);
  }
  for (const f of b.filtres) {
    if (f === "maj") texte = texte.toUpperCase();
    else if (f === "min") texte = texte.toLowerCase();
    else if (f === "cap") texte = capitaliser(texte);
  }
  return [texte, true];
}
