# Visites plongeurs

Application Windows du secrétariat du Service de médecine hyperbare et d'expertise plongée. Elle remplit les fiches navette AXONE et les certificats médico-administratifs d'aptitude à partir d'une seule saisie : identité, date du rendez-vous, type de venue.

* Choix automatique de la fiche navette (type de visite, aptitude, âge) : le grisé des examens vient du modèle choisi.
* Choix du ou des certificats, avec certificats combinés et case d'aptitude cochée selon le type de visite.
* Calcul de l'âge et de la prochaine VQ (+4 ans jour pour jour).
* Double venue (ex. VQ PLD + VE ENTOPS).
* Import en un clic des documents d'origine (.doc et .docx).
* Tout se paramètre dans l'application ; aucun document n'est codé en dur.
* Fonctionne hors ligne, sans droits administrateur. Aucune donnée ne quitte le poste.

Documentation : [guide du secrétariat](docs/GUIDE_UTILISATEUR.md), [paramétrage et balises](docs/PARAMETRAGE.md), [règles à valider](docs/REGLES_A_VALIDER.md).

## Obtenir l'exécutable

GitHub compile l'application à chaque envoi sur `main` (onglet **Actions** › dernière exécution › artefact `VisitesPlongeurs-windows`). Pour publier une version téléchargeable :

```
git tag v1.0.0
git push origin v1.0.0
```

La page **Releases** reçoit alors :
* `VisitesPlongeurs-installation.exe` : installateur par utilisateur, sans droits administrateur, avec raccourcis menu Démarrer et bureau ;
* `VisitesPlongeurs-portable.zip` : version à décompresser, utilisable depuis un lecteur réseau.

## Avant le premier envoi sur GitHub

**Ne versez jamais vos documents d'origine dans le dépôt.** Plusieurs fiches AXONE contiennent des données de patients (grades, matricules, affectations). Utilisez un dépôt **privé** et ne versez que les modèles produits par l'import, après contrôle, dans `modeles/`. Le fichier `.gitignore` exclut déjà l'historique, le journal et les documents générés.

Si `modeles/` contient vos modèles préparés au moment de la compilation, l'installateur et la version portable les embarquent : les postes n'auront rien à importer.

## Organisation

```
app/                    code de l'application (Python)
  web/                  interface (HTML, CSS, JavaScript)
  defaut_config.json    paramétrage livré
config/config.json      paramétrage en service (modifié par l'onglet Paramètres)
modeles/                modèles Word avec balises {{…}}
docs/                   documentation
tests/                  tests automatiques
VisitesPlongeurs.spec   compilation PyInstaller
installateur.iss        installateur Inno Setup
.github/workflows/      compilation automatique sur GitHub
```

## Développement

Python 3.10 ou plus.

```
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest tests          # 25 tests
python -m app                   # lance l'application
python -m app --importer "C:\chemin\documents d'origine"   # import en ligne de commande
```

Le programme démarre un serveur local sur 127.0.0.1 (port aléatoire, jeton de session) et ouvre l'interface dans une fenêtre Edge en mode application. Le serveur s'arrête quand la fenêtre est fermée.

`lancer_depuis_les_sources.bat` lance l'application sans compilation sur un poste où Python est installé.
