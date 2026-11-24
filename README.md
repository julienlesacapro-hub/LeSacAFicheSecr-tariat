# Visites plongeurs

Application du secrétariat du Service de médecine hyperbare et d'expertise plongée, disponible en **logiciel Windows** et en **application pour téléphone, tablette et navigateur**. Elle remplit les fiches navette AXONE et les certificats médico-administratifs d'aptitude à partir d'une seule saisie : identité, date du rendez-vous, type de venue.

* Choix automatique de la fiche navette (type de visite, aptitude, âge) : le grisé des examens vient du modèle choisi.
* Choix du ou des certificats, avec certificats combinés et case d'aptitude cochée selon le type de visite.
* Calcul de l'âge et de la prochaine VQ (+4 ans jour pour jour).
* Double venue (ex. VQ PLD + VE ENTOPS).
* Import en un clic des documents d'origine (.doc et .docx).
* Tout se paramètre dans l'application ; aucun document n'est codé en dur.
* Fonctionne hors ligne, sans droits administrateur. Aucune donnée ne quitte le poste ou l'appareil.

## Télécharger et installer

| Sur | Comment |
|---|---|
| **Ordinateur Windows** | Page [**Releases**](https://github.com/julienlesacapro-hub/LeSacAFicheSecr-tariat/releases/latest) › `VisitesPlongeurs-installation.exe` (ou `VisitesPlongeurs-portable.zip`) |
| **Téléphone, tablette** (iPhone, iPad, Android) ou tout autre ordinateur | [**julienlesacapro-hub.github.io/LeSacAFicheSecr-tariat**](https://julienlesacapro-hub.github.io/LeSacAFicheSecr-tariat/) puis « Ajouter à l'écran d'accueil » / « Installer l'application » |

L'application mobile se paramètre en important le paquet exporté par le logiciel Windows (Paramètres › Modèles Word › Exporter le paquet de paramétrage). Détails : [guide du secrétariat](docs/GUIDE_UTILISATEUR.md#téléphone-tablette-ou-autre-ordinateur).

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

La page **GitHub Pages** (application mobile) est republiée à chaque envoi sur `main`, quel que soit le réglage de Settings › Pages :
* **Source : GitHub Actions** (recommandé) : le site est construit par `outils/construire_web.py` ;
* **Source : Deploy from a branch** (`main`, `/ (root)`) : le dépôt est publié tel quel et `index.html` à la racine ouvre l'application (`app/web/`).

## Confidentialité : ce dépôt est public

**Ne versez jamais vos documents d'origine, vos modèles remplis ni un paquet de paramétrage dans le dépôt.** Plusieurs fiches AXONE contiennent des données de patients (grades, matricules, affectations). Tout ce qui est versé ici est visible par n'importe qui, et le site GitHub Pages aussi. Le fichier `.gitignore` exclut l'historique, le journal, les documents générés et les fichiers `.zip`.

Le site publié ne contient que le code et le paramétrage par défaut : aucun modèle, aucune donnée. Chaque appareil reçoit ses modèles par le paquet de paramétrage, transmis hors de GitHub.

Si `modeles/` contient des modèles préparés au moment de la compilation, l'installateur Windows et la version portable les embarquent : avec un dépôt public, ces modèles seraient publics. Pour les embarquer, il faut un dépôt **privé** (GitHub Pages sur un dépôt privé demande alors un abonnement GitHub payant).

## Organisation

```
app/                    code du logiciel Windows (Python)
  web/                  interface (HTML, CSS, JavaScript), commune aux deux versions
    moteur/             moteur JavaScript de l'application mobile (équivalent de app/*.py)
    lib/jszip.min.js    lecture et écriture des .docx dans le navigateur (JSZip 3.10.1, licence MIT)
  defaut_config.json    paramétrage livré
config/config.json      paramétrage en service (modifié par l'onglet Paramètres)
modeles/                modèles Word avec balises {{…}}
docs/                   documentation
tests/                  tests automatiques (dont parité Python / JavaScript)
outils/construire_web.py  construction du site de l'application mobile
VisitesPlongeurs.spec   compilation PyInstaller
installateur.iss        installateur Inno Setup
.github/workflows/      tests, logiciel Windows (Releases), application mobile (Pages)
```

## Développement

Python 3.10 ou plus.

```
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest tests          # tests Python ; parité JavaScript si Node.js + Playwright présents
python outils/construire_web.py # site de l'application mobile dans site/
python -m app                   # lance l'application
python -m app --importer "C:\chemin\documents d'origine"   # import en ligne de commande
```

Le programme démarre un serveur local sur 127.0.0.1 (port aléatoire, jeton de session) et ouvre l'interface dans une fenêtre Edge en mode application. Le serveur s'arrête quand la fenêtre est fermée.

`lancer_depuis_les_sources.bat` lance l'application sans compilation sur un poste où Python est installé.

### Deux moteurs, mêmes résultats

Le logiciel Windows calcule en Python (`app/`), l'application mobile en JavaScript (`app/web/moteur/`), avec la même interface. Toute modification d'une règle doit être faite **dans les deux**. `tests/test_parite_web.py` le vérifie : il exécute le moteur JavaScript dans Chromium et compare, scénario par scénario, les calculs et le XML des documents Word produits par les deux moteurs. Il rejoue aussi le parcours complet sur un téléphone et une tablette émulés. Pour le lancer en local :

```
cd tests/web && npm install --no-save playwright@1.63.0 && npx playwright install chromium
```
