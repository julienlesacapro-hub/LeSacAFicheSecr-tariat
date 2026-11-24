// Stockage sur l'appareil (IndexedDB) : paramétrage, modèles Word, historique.
// Rien ne quitte l'appareil.
const BASE = "visites-plongeurs";
const VERSION = 1;
let connexion = null;

function ouvrir() {
  if (connexion) return connexion;
  connexion = new Promise((resoudre, rejeter) => {
    if (!globalThis.indexedDB) { rejeter(new Error("Ce navigateur ne permet pas de garder des données (navigation privée ?).")); return; }
    const r = indexedDB.open(BASE, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("reglages")) db.createObjectStore("reglages");
      if (!db.objectStoreNames.contains("modeles")) db.createObjectStore("modeles", { keyPath: "chemin" });
    };
    r.onsuccess = () => resoudre(r.result);
    r.onerror = () => rejeter(r.error || new Error("Stockage indisponible."));
  });
  return connexion;
}

async function transaction(magasin, mode, action) {
  const db = await ouvrir();
  return new Promise((resoudre, rejeter) => {
    const tx = db.transaction(magasin, mode);
    const m = tx.objectStore(magasin);
    let resultat;
    const r = action(m);
    if (r) r.onsuccess = () => { resultat = r.result; };
    tx.oncomplete = () => resoudre(resultat);
    tx.onerror = () => rejeter(tx.error);
    tx.onabort = () => rejeter(tx.error || new Error("Enregistrement interrompu (espace de stockage plein ?)."));
  });
}

export const lireReglage = (cle) => transaction("reglages", "readonly", (m) => m.get(cle));
export const ecrireReglage = (cle, valeur) => transaction("reglages", "readwrite", (m) => m.put(valeur, cle));

/** Modèles sans leur contenu : [{chemin, balises, genre, maj}]. */
export async function listerModeles() {
  const tous = (await transaction("modeles", "readonly", (m) => m.getAll())) || [];
  return tous.map(({ chemin, balises, genre, maj }) => ({ chemin, balises, genre, maj }));
}
export async function lireModele(chemin) {
  const m = await transaction("modeles", "readonly", (s) => s.get(chemin));
  if (!m) throw new Error(`Modèle introuvable : ${chemin}`);
  return m.octets;
}
export const ecrireModele = (modele) => transaction("modeles", "readwrite", (m) => m.put({ ...modele, maj: new Date().toISOString() }));
export const supprimerModele = (chemin) => transaction("modeles", "readwrite", (m) => m.delete(chemin));
export const viderModeles = () => transaction("modeles", "readwrite", (m) => m.clear());

/** Demande au navigateur de ne pas effacer les données en cas de manque de place. */
export async function demanderPersistance() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) { /* sans effet */ }
  return false;
}
