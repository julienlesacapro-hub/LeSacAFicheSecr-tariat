// Exécute le moteur JavaScript (app/web/moteur) dans Chromium pour les tests de parité.
//   node tests/web/executer.cjs <url_du_site> <travail.json>
// travail.json : {"taches": [...]} ; écrit le résultat dans travail.json + ".resultat.json".
const fs = require("fs");
const { chromium } = require("playwright");

(async () => {
  const [url, fichier] = process.argv.slice(2);
  const travail = JSON.parse(fs.readFileSync(fichier, "utf8"));
  const navigateur = await chromium.launch();
  const page = await navigateur.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
  await page.goto(url + "/version.json");
  await page.addScriptTag({ url: url + "/lib/jszip.min.js" });
  const resultat = await page.evaluate(async (taches) => {
    const gen = await import("/moteur/generation.js");
    const regles = await import("/moteur/regles.js");
    const docx = await import("/moteur/docx.js");
    const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    const vers64 = (o) => { let s = ""; for (let i = 0; i < o.length; i += 0x8000) s += String.fromCharCode(...o.subarray(i, i + 0x8000)); return btoa(s); };
    const sorties = [];
    for (const t of taches) {
      try {
        if (t.type === "preparer") {
          const r = await gen.preparer(b64(t.octets), t.nom, true);
          sorties.push({ octets: vers64(r.octets), genre: r.genre, balises: r.balises, remarques: r.remarques, infos: r.infos });
        } else if (t.type === "generer") {
          const modeles = {};
          const liste = [];
          for (const m of t.modeles) {
            const o = b64(m.octets);
            modeles[m.chemin] = o;
            liste.push({ chemin: m.chemin, balises: docx.listerBalises(await docx.DocumentWord.ouvrir(o, m.chemin)) });
          }
          const inv = new regles.Inventaire(liste);
          const calcul = regles.calculer(t.config, t.saisie, inv);
          delete calcul.valeurs;
          let fichiers = [], erreur = null, dossier = null;
          try {
            const r = await gen.generer(t.config, inv, t.saisie, async (c) => modeles[c]);
            dossier = r.dossier;
            fichiers = r.fichiers.map((f) => ({ nom: f.nom, titre: f.titre, cases_cochees: f.cases_cochees, octets: vers64(f.octets) }));
          } catch (e) { erreur = e.message; }
          sorties.push({ calcul: JSON.parse(JSON.stringify(calcul)), dossier, fichiers, erreur });
        } else if (t.type === "evaluer") {
          const dates = await import("/moteur/dates.js");
          const balises = await import("/moteur/balises.js");
          sorties.push(await (new Function("dates", "balises", "gen", "return (" + t.code + ")"))(dates, balises, gen));
        }
      } catch (e) {
        sorties.push({ exception: String(e && e.stack || e) });
      }
    }
    return sorties;
  }, travail.taches);
  fs.writeFileSync(fichier + ".resultat.json", JSON.stringify(resultat));
  await navigateur.close();
})().catch((e) => { console.error(e); process.exit(1); });
