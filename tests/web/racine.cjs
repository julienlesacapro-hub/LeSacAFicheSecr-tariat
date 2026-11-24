// Ouvre la racine du site (dépôt publié tel quel) et vérifie que l'application démarre.
//   node tests/web/racine.cjs <url>
const { chromium, devices } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext(devices["Pixel 7"])).newPage();
  const erreurs = [];
  p.on("pageerror", (e) => erreurs.push(String(e)));
  await p.goto(process.argv[2] + "/");
  await p.waitForSelector("#champ-NOM", { timeout: 10000 });
  await p.click("nav [data-vue=aide]");
  console.log(JSON.stringify({ url: p.url(), aide: await p.innerText("#aide-dossiers"), erreurs }));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
