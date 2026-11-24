// Parcours complet de l'application sur téléphone (émulation), sans Python :
// import du paquet de paramétrage, saisie d'une visite, génération, téléchargement.
//   node tests/web/parcours.cjs <url_du_site> <paquet.zip> <dossier_sortie> [appareil]
const fs = require("fs");
const path = require("path");
const { chromium, devices } = require("playwright");

(async () => {
  const [url, paquet, sortie, appareil = "Pixel 7"] = process.argv.slice(2);
  const navigateur = await chromium.launch();
  const contexte = await navigateur.newContext({ ...devices[appareil], acceptDownloads: true });
  const page = await contexte.newPage();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) erreurs.push(m.text()); });
  // sondes normales : /api/identite (logiciel Windows ?), emplacements successifs du paramétrage par défaut (l'application vérifie si elle est servie par le logiciel Windows)
  page.on("response", (r) => { if (r.status() >= 400 && !/\/(api\/identite|favicon\.ico|defaut_config\.json|version\.json|__init__\.py)$/.test(r.url())) erreurs.push(`${r.status()} ${r.url()}`); });
  page.on("dialog", (d) => d.accept());
  const debordement = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const rapport = { debordements: {} };

  await page.goto(url + "/index.html");
  await page.waitForSelector("#bandeau-modeles:not([hidden])");
  rapport.debordements.accueil = await debordement();
  await page.screenshot({ path: path.join(sortie, "1-accueil.png"), fullPage: false });

  // import du paquet exporté par le logiciel Windows
  await page.click("[data-aller=modeles]");
  await page.setInputFiles("input[type=file][accept]", paquet);
  await page.waitForSelector(".statut.ok");
  rapport.import = await page.locator(".encart p").filter({ hasText: "prêt(s)" }).first().innerText();
  rapport.debordements.parametres = await debordement();
  await page.screenshot({ path: path.join(sortie, "2-import.png"), fullPage: true });

  // saisie d'une visite
  await page.click("nav [data-vue=visite]");
  await page.fill("#champ-NOM", "dupont");
  await page.fill("#champ-PRENOM", "jean");
  await page.fill("#champ-DATE_NAISSANCE", "150680");
  await page.fill("#champ-DOSSIER", "10832");
  await page.click("#repli-militaire summary");
  await page.fill("#champ-GRADE", "mt");
  await page.fill("#champ-MATRICULE", "2016198");
  await page.fill("#champ-AFFECTATION", "ban lanvéoc");
  await page.fill("#champ-DATE_RDV", "21/11/2026");
  await page.click(".types .type:has-text('VQ')");
  await page.click(".aptitudes .aptitude >> text=PLB");
  await page.waitForFunction(() => !document.getElementById("generer").disabled);
  await page.waitForTimeout(400);
  rapport.age = await page.innerText("#cadran-age");
  rapport.vq = await page.innerText("#cadran-vq");
  rapport.documents = await page.locator("#liste-docs .titre").allInnerTexts();
  rapport.debordements.visite = await debordement();
  await page.screenshot({ path: path.join(sortie, "3-visite.png"), fullPage: true });

  await page.click("#generer");
  await page.waitForSelector("#resultat:not([hidden])");
  rapport.fichiers = await page.locator("#resultat-fichiers li span").allInnerTexts();
  const [telechargement] = await Promise.all([page.waitForEvent("download"), page.click("#res-dossier")]);
  rapport.zip = telechargement.suggestedFilename();
  await telechargement.saveAs(path.join(sortie, "documents.zip"));
  await page.screenshot({ path: path.join(sortie, "4-resultat.png"), fullPage: false });

  // historique gardé sur l'appareil
  await page.click("nav [data-vue=historique]");
  await page.waitForSelector("#corps-historique tr", { timeout: 5000 }).catch(() => {});
  rapport.historique = await page.locator("#corps-historique tr").count();
  rapport.debordements.historique = await debordement();
  // rechargement : modèles et paramétrage toujours là
  await page.reload();
  await page.waitForSelector("#bandeau-modeles", { state: "attached" });
  await page.waitForTimeout(300);
  rapport.modeles_apres_rechargement = await page.evaluate(() => document.getElementById("bandeau-modeles").hidden);
  // hors connexion : le service worker sert l'application et le moteur depuis le cache
  await page.evaluate(() => navigator.serviceWorker && navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller);
  await contexte.setOffline(true);
  await page.reload();
  await page.waitForSelector("#bandeau-modeles", { state: "attached" });
  await page.click(".types .type:has-text('VQ')");
  await page.click(".aptitudes .aptitude >> text=PLB");
  await page.waitForSelector("#liste-docs .titre");
  rapport.hors_ligne_documents = await page.locator("#liste-docs .titre").count();
  await contexte.setOffline(false);
  rapport.erreurs = erreurs;
  fs.writeFileSync(path.join(sortie, "rapport.json"), JSON.stringify(rapport, null, 1));
  await navigateur.close();
})().catch((e) => { console.error(e); process.exit(1); });
