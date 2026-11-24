// Lecture, calcul et mise en forme des dates (format français).
// Équivalent JavaScript de app/dates.py : les deux doivent rester identiques.

export const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
  "août", "septembre", "octobre", "novembre", "décembre"];

/** Date calendaire sans heure ni fuseau horaire. */
export class Jour {
  constructor(a, m, j) { this.a = a; this.m = m; this.j = j; }
  static aujourdhui() { const d = new Date(); return new Jour(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
  iso() { return `${String(this.a).padStart(4, "0")}-${String(this.m).padStart(2, "0")}-${String(this.j).padStart(2, "0")}`; }
  toJSON() { return this.iso(); }
  toString() { return this.iso(); }
}

function bissextile(a) { return (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0; }
export function joursDansMois(a, m) { return [31, bissextile(a) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }

function creer(a, m, j) {
  if (!(a >= 1 && a <= 9999 && m >= 1 && m <= 12 && j >= 1 && j <= joursDansMois(a, m))) return null;
  return new Jour(a, m, j);
}

/**
 * Convertit une saisie en date. Formats : 12/03/1985, 12/3/85, 12-03-1985, 12.03.1985,
 * 12031985, 120385, 1985-03-12. `sieclePasse` : année sur 2 chiffres ramenée au siècle
 * passé si elle tombe dans le futur (dates de naissance).
 */
export function lireDate(texte, sieclePasse = false) {
  if (texte === null || texte === undefined) return null;
  if (texte instanceof Jour) return texte;
  const s = String(texte).trim();
  if (!s) return null;
  let a, mo, j, m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    a = +m[1]; mo = +m[2]; j = +m[3];
  } else {
    m = s.match(/^(\d{1,2})\s*[/.\- ]\s*(\d{1,2})\s*[/.\- ]\s*(\d{2}|\d{4})$/) || s.match(/^(\d{2})(\d{2})(\d{4}|\d{2})$/);
    if (!m) return null;
    j = +m[1]; mo = +m[2]; a = +m[3];
    if (m[3].length === 2) {
      a += 2000;
      if (sieclePasse && a > new Date().getFullYear()) a -= 100;
    }
  }
  return creer(a, mo, j);
}

/** Ajoute des années, des mois puis des jours (« jour pour jour » : 29/02 → 28/02, 31 → dernier jour). */
export function ajouter(d, { annees = 0, mois = 0, jours = 0 } = {}) {
  const total = d.m - 1 + mois;
  const a = d.a + annees + Math.floor(total / 12);
  const mo = ((total % 12) + 12) % 12 + 1;
  const j = Math.min(d.j, joursDansMois(a, mo));
  if (!jours) return new Jour(a, mo, j);
  const t = new Date(Date.UTC(a, mo - 1, j) + jours * 86400000);
  return new Jour(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Âge révolu à la date de référence. */
export function age(naissance, reference) {
  let ans = reference.a - naissance.a;
  if (reference.m < naissance.m || (reference.m === naissance.m && reference.j < naissance.j)) ans -= 1;
  return ans;
}

/** Jetons : jj, j, mm, m, aaaa, aa, mois, MOIS, Mois. Tout autre caractère est recopié. */
export function formater(d, fmt = "jj/mm/aaaa") {
  if (!d) return "";
  const nom = MOIS[d.m - 1];
  const jetons = {
    aaaa: String(d.a).padStart(4, "0"),
    aa: String(d.a % 100).padStart(2, "0"),
    jj: String(d.j).padStart(2, "0"),
    mm: String(d.m).padStart(2, "0"),
    MOIS: nom.toUpperCase(),
    Mois: nom[0].toUpperCase() + nom.slice(1),
    mois: nom,
    j: String(d.j),
    m: String(d.m),
  };
  return fmt.replace(/aaaa|MOIS|Mois|mois|aa|jj|mm|j|m/g, (x) => jetons[x]);
}
