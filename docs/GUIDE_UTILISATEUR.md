# Visites plongeurs : guide du secrétariat

## Installer

Deux versions existent. Aucune ne demande de droits administrateur.

| Version | Fichier | Où vont les données |
|---|---|---|
| Installée (recommandée) | `VisitesPlongeurs-installation.exe` | `Documents\Visites plongeurs` |
| Portable (clé USB, lecteur réseau) | `VisitesPlongeurs-portable.zip` à décompresser | Dans le dossier décompressé |

Au premier lancement, Windows peut afficher « Windows a protégé votre ordinateur » : cliquez sur **Informations complémentaires**, puis **Exécuter quand même**. Ce message apparaît pour tout programme non signé numériquement. Si le poste bloque totalement le programme, le service informatique doit l'autoriser.

L'application s'ouvre dans sa propre fenêtre (Microsoft Edge en mode application). Elle ne passe pas par Internet : tout reste sur le poste.

## Téléphone, tablette ou autre ordinateur

La même application existe sans installation, dans le navigateur. Adresse : **https://julienlesacapro-hub.github.io/LeSacAFicheSecr-tariat/**

1. Ouvrez l'adresse une fois avec une connexion.
2. Installez-la sur l'écran d'accueil :
   * **iPhone, iPad** (Safari) : bouton Partager › « Sur l'écran d'accueil » ;
   * **Android** (Chrome) : menu ⋮ › « Installer l'application » ;
   * **ordinateur** (Edge, Chrome) : icône d'installation à droite de la barre d'adresse.
3. Sur le **logiciel Windows**, ouvrez Paramètres › Modèles Word › **Exporter le paquet de paramétrage**. Vous obtenez `VisitesPlongeurs-parametrage.zip` (réglages + modèles préparés).
4. Transférez ce fichier sur l'appareil (courriel, cloud, câble), puis dans l'application : Paramètres › Modèles Word › **Choisir des fichiers** › le .zip.

Ensuite, l'application fonctionne **sans connexion**. Les documents produits sont proposés au partage (téléphone, tablette : Word, Fichiers, courriel…) ou téléchargés (ordinateur). Une double venue ou plusieurs documents donnent un .zip.

Différences avec le logiciel Windows :

| | Logiciel Windows | Navigateur, téléphone, tablette |
|---|---|---|
| Documents produits | Rangés dans un dossier par visite | Partagés ou téléchargés |
| Impression directe | Oui (Word) | Non : ouvrez le document dans Word puis imprimez |
| Import de fichiers `.doc` | Oui (conversion par Word) | Non : `.docx` uniquement, ou paquet de paramétrage |
| Données (réglages, modèles, historique) | Dossier sur le poste ou le réseau | Sur l'appareil seulement, non partagées |

Les règles et les documents produits sont strictement identiques : un test automatique compare, à chaque modification, les fichiers Word des deux versions.

Les données restent sur l'appareil. Effacer les données du navigateur (ou désinstaller l'application) les supprime : gardez le paquet de paramétrage. Après une modification des réglages sur le poste Windows, exportez et réimportez le paquet sur les appareils.

## Premier lancement : importer vos documents

1. Ouvrez **Paramètres › Modèles Word**.
2. Indiquez le dossier qui contient vos sous-dossiers `FICHES NAVETTE AXONE`, `expertise seule`, `initiale`, `initiale réact` et `quadriennale`.
3. Cliquez sur **Importer et préparer**.

L'application convertit les .doc en .docx avec Word, place les zones à remplir et efface les données d'anciens patients restées dans les fiches navette. Vos fichiers d'origine ne changent pas. Comptez environ une seconde par fichier.

Le rapport affiche chaque fichier. « À contrôler » signale un emplacement non trouvé (par exemple une fiche sans encart « ETIQUETTE AMADEUS ») : ouvrez le modèle et ajoutez la balise à la main (voir PARAMETRAGE.md).

## Préparer une visite

1. **Identité** : nom, prénom, date de naissance, numéro de dossier. Les dates se tapent sans barres : `150680` devient 15/06/1980. Grade, matricule et affectation sont dans le volet repliable.
2. **Rendez-vous** : la date du jour est proposée.
3. **Type de venue** : cliquez sur VI, VIR, VQ, VA, VE ou CABAT, puis sur l'aptitude. Pour une double venue (par exemple VQ PLD + VE ENTOPS), cliquez sur « Ajouter un second type de venue ».
4. Contrôlez le cadran à droite :
   * **Âge** au jour du rendez-vous ;
   * **Prochaine VQ** : calculée (rendez-vous + 4 ans, jour pour jour) pour VI, VIR et VQ. Pour une VA ou une VE, saisissez la date de la VQ déjà programmée ;
   * **Type de venue** imprimé sur la fiche : modifiable, par exemple pour ajouter « (Dépassement date) ».
5. **Documents** : la fiche navette et le ou les certificats sont choisis automatiquement. Décochez ce qui ne doit pas être produit ; ajoutez un autre document avec la liste déroulante.
6. Cliquez sur **Générer les documents** (ou `Ctrl` + `Entrée`).

Les fichiers Word remplis sont rangés dans `Documents générés\2026-11-21 DUPONT Jean (10832)\`. Le panneau vert permet d'ouvrir le dossier, d'ouvrir chaque fichier ou de tout imprimer sur l'imprimante par défaut.

## Ce qui est rempli, ce qui ne l'est pas

Rempli automatiquement : nom, prénom, date de naissance, numéro de dossier, grade, matricule, affectation, date du rendez-vous, âge, type de venue, date de la prochaine VQ, et dans le certificat la case de la ligne « aptitude … » qui correspond au type de visite (EXPERTISE QUADRIENNALE pour une VQ, CONTROLE ANNUEL pour une VA, etc.).

Laissé au médecin : conclusions, durées, contre-indications, restrictions, signature.

Le grisé des examens vient du modèle de fiche choisi : la bonne fiche (selon le type de visite et l'âge) arrive déjà grisée.

## Historique

L'onglet **Historique** liste les visites générées sur ce poste. **Nouvelle visite** reprend l'identité et le type de venue d'un patient déjà vu, et propose sa date de VQ si la nouvelle visite est une VA ou une VE. L'historique reste sur le poste ; vous pouvez le désactiver dans Paramètres › Général.

## En cas de problème

| Symptôme | Cause probable | Solution |
|---|---|---|
| « Modèle introuvable » | Modèle non importé ou renommé | Paramètres › Modèles Word › Vérifier, puis importer ou corriger le nom dans Fiches navette / Certificats |
| Un fichier « (heure).docx » apparaît | Le document était ouvert dans Word | Fermez Word avant de régénérer |
| L'import échoue sur les .doc | Word absent ou bloqué | Ouvrez chaque .doc dans Word, « Enregistrer sous » .docx, puis réimportez |
| La fenêtre ne s'ouvre pas | Edge absent ou bloqué | L'application s'ouvre alors dans le navigateur par défaut ; sinon voir `donnees\journal.log` |
