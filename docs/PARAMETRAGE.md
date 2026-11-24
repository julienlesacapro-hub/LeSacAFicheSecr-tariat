# Paramétrage

Tout se règle depuis l'onglet **Paramètres**, sans toucher au code. Les réglages sont enregistrés dans `config\config.json` ; chaque enregistrement garde une copie datée dans `config\anciennes_versions`. Le bouton « Revenir aux réglages d'origine » recharge la configuration livrée.

## Changer un document

Les modèles sont des fichiers Word ordinaires dans le dossier `modeles`. Trois cas :

**Modifier le contenu d'un document** (texte, logo, grisé d'un examen) : Paramètres › Modèles Word › Vérifier les modèles › **Ouvrir dans Word**. Modifiez, enregistrez. Les balises `{{…}}` restent en place.

**Remplacer un document par une nouvelle version d'origine** : réimportez son dossier (Paramètres › Modèles Word › Importer). L'ancien modèle est sauvegardé dans `modeles\_sauvegardes`.

**Ajouter un nouveau document** :
1. copiez le .docx dans `modeles` (ou importez-le) ;
2. placez les balises voulues dans Word ;
3. déclarez-le dans **Fiches navette AXONE** ou **Certificats** avec le type de visite et l'aptitude concernés. Sans déclaration, il reste disponible via « Ajouter un autre document » lors de la saisie.

## Balises

Tapez la balise dans Word, accolades comprises, à l'endroit où l'information doit apparaître. Elle garde la mise en forme du texte qui l'entoure (gras, taille, police).

| Balise | Contenu |
|---|---|
| `{{NOM}}` `{{PRENOM}}` | Identité (NOM en majuscules, Prénom capitalisé) |
| `{{DATE_NAISSANCE}}` | Date de naissance |
| `{{DOSSIER}}` | Numéro de dossier interne |
| `{{GRADE}}` `{{MATRICULE}}` `{{AFFECTATION}}` | Informations militaires |
| `{{DATE_RDV}}` | Date du rendez-vous |
| `{{DATE_VQ}}` | Prochaine visite quadriennale |
| `{{AGE}}` | Âge révolu au rendez-vous |
| `{{TYPE_VENUE}}` | Ex. `VQ PLD + VE ENTOPS` |
| `{{TYPE_VISITE}}` `{{APTITUDE}}` `{{APTITUDE_LIBELLE}}` | Éléments séparés du type de venue |
| `{{IDENTITE}}` | NOM Prénom, puis « Né(e) le … » à la ligne |
| `{{NOM_PRENOM}}` `{{VILLE}}` `{{NOM_SERVICE}}` `{{DATE_JOUR}}` | Divers |
| `{{DATE_TEST_PSY}}` `{{DATE_CAISSON}}` | Dates des tests (par défaut : date du RDV) |
| Tout autre `{{CODE}}` | Ajoute un champ « Compléments » à la saisie |

### Mises en forme

| Écriture | Résultat |
|---|---|
| `{{DATE_VQ:jj/mm/aa}}` | 21/11/30 |
| `{{DATE_VQ:mm}}` puis `{{DATE_VQ:aaaa}}` | 11 et 2030 (cases « mois / année » séparées) |
| `{{DATE_RDV:j mois aaaa}}` | 21 novembre 2026 |
| `{{DATE_RDV+1a:mm/aaaa}}` | 11/2027. Décalages : `+1a` (an), `+6m` (mois), `-15j` (jours) |
| `{{PRENOM\|maj}}` | JEAN. Filtres : `maj`, `min`, `cap` |
| `{{SSA\|x}}` | X si la case est cochée, rien sinon |

Jetons de date : `jj`, `j`, `mm`, `m`, `aa`, `aaaa`, `mois`, `Mois`, `MOIS`.

## Rubriques

### Général
Nom du service, ville, format des dates, délai de la VQ (4 ans), dossiers des modèles et des documents générés (un lecteur réseau est accepté, par exemple `\\serveur\secretariat\Visites`), modèle de nom de dossier et de fichier, cochage automatique des cases d'aptitude, historique.

### Champs de saisie
Une ligne par information demandée. Le **code** est le nom de la balise. **Section** : `Identité` et `Grade, matricule…` s'affichent toujours ; `Complément` n'apparaît que si un document choisi contient la balise, ou pour les aptitudes listées dans « Afficher pour ». **Valeur par défaut** : un texte, ou `=CODE` pour recopier un autre champ (`=DATE_RDV`).

### Types de visite
**Prochaine VQ** : `RDV + 4 ans` (calcul jour pour jour), `À saisir` (VQ déjà programmée), `Aucune`. Avec deux types de venue, le calcul l'emporte sur la saisie.
**Case cochée si le libellé contient** : expression recherchée dans le texte qui suit chaque case « aptitude … » des certificats. Exemple : `EXPERTISE QUADRIENNALE` pour VQ, `CONTROLE ANNUEL` pour VA.

### Aptitudes
Code interne, sigle imprimé dans le type de venue, libellé affiché. Cochez « Sans certificat » pour une aptitude qui ne produit qu'une fiche navette (ENTOPS, ENTEX, POST COVID). Une aptitude est proposée pour un type de visite dès qu'une fiche ou un certificat les associe.

### Fiches navette AXONE
Une fiche par visite. Pour chaque règle : types et aptitudes concernés (vide = tous), tranche d'âge inclusive, conditions (`SSA=oui`), **priorité**. Parmi les règles qui s'appliquent, la priorité la plus haute gagne. Exemple : pour VQ PLD + VE ENTOPS, la fiche ENTOPS (90) l'emporte sur la fiche quadriennale (40). La fiche vierge (priorité 0) sert de dernier recours.

Seuils d'âge livrés : moins de 40 ans = 0 à 39 ; 40 ans et plus = 40 à 49 ; 50 ans et plus = 50 et au-delà. L'âge est l'âge révolu le jour du rendez-vous.

### Certificats
Un certificat par type de venue, choisi par type de visite et aptitude. Une ligne qui porte deux aptitudes (ex. `CAT1, NC`) sert de certificat combiné quand les deux sont demandées dans la même visite ; sinon un certificat est produit pour chacune. Les certificats du dossier `quadriennale` servent à la VQ et à la VA (ils contiennent les lignes EXPERTISE QUADRIENNALE et CONTROLE ANNUEL).

## Partager l'application entre plusieurs postes

Placez les modèles et la configuration sur un lecteur réseau et indiquez ce chemin dans Paramètres › Général (dossier des modèles, dossier des documents générés). Pour partager aussi la configuration, définissez sur chaque poste la variable d'environnement `VISITES_PLONGEURS_DOSSIER` vers ce dossier commun. Évitez que deux postes enregistrent les paramètres au même moment.
