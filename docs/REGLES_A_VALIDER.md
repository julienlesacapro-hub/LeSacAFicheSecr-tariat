# Règles à valider par le service

J'ai construit le paramétrage livré à partir du texte de vos 79 documents. Le tableau ci-dessous sépare ce que les documents établissent de ce que j'ai déduit. Chaque point se corrige dans l'onglet Paramètres, sans programmation.

## Établi par vos documents

| Règle | Source |
|---|---|
| Prochaine VQ = date de visite + 4 ans pour VI, VIR et VQ | Vos consignes ; fiches exemples (ex. « VI PLB », test psy 20/11/26, VQ 20/11/30) |
| Fiche quadriennale selon l'âge : moins de 40, 40 et plus, 50 et plus | Noms des fiches AXONE |
| Fiche annuelle selon l'âge : moins de 40, 40 et plus | Noms des fiches AXONE |
| Fiche initiale PLB-PLH-SPLB, PLD-IO-NC, CAT 3 SSA / hors SSA, CAT 4, DECPLOMIL, CABAT, réactualisation, expertise, post-COVID, ENTOPS, ENTEX avant / après | Noms des fiches AXONE et champ « Type de visite » des exemples |
| Fiche PLD-IO-NC pour une venue VI PLB + VI NC | Exemple « Type de visite : VI PLB + VI NC » dans la fiche PLD-IO-NC |
| Certificats combinés CAT 1 + NC, CAT 1 + IO (VI), PLB + PLD (VIR) | Lignes d'aptitude des certificats |
| Lignes « EXPERTISE QUADRIENNALE » et « CONTROLE ANNUEL » dans les certificats du dossier quadriennale | Lu dans PLB Quadri, CAT 1 Quadri Nitrox et réserviste CAT 2 |
| Codes VI, VIR, VQ, VA, VE dans « Type de visite » | Fiches exemples |

## Déduit, à confirmer

| # | Règle livrée | Pourquoi | Où la corriger |
|---|---|---|---|
| 1 | Les certificats du dossier quadriennale servent aussi à la VA (case CONTROLE ANNUEL cochée) | Vérifié sur 3 certificats sur 14 | Certificats |
| 2 | En VA et VE, la prochaine VQ n'est pas recalculée : la secrétaire saisit celle déjà programmée | Fiches exemples VA et VE : « Prochaine VQ » à 15/02/28, 24/05/28, 04/09/29, différente de visite + 4 ans | Types de visite |
| 3 | « avant fin mm / aaaa » des certificats reçoit le mois et l'année de la prochaine VQ | Seule date future du certificat ; votre consigne place la VQ sur toutes les fiches | Ouvrir les certificats, remplacer `{{DATE_VQ:mm}}` par une autre date si besoin (ex. `{{DATE_RDV+1a:mm}}`) |
| 4 | « Date de réalisation de la VMP » et « à TOULON le » reçoivent la date du rendez-vous | Hypothèse : certificat établi le jour de la visite | Ouvrir les certificats |
| 5 | « Identifiant défense » du certificat reçoit le matricule | Les fiches AXONE n'ont qu'un champ Matricule | Champs de saisie |
| 6 | Fiche PLD-IO-NC pour VI PAT, École navale, CONFLANS | PAT proche de IO ; École navale et CONFLANS incluent PLD | Fiches navette (marquées « à vérifier ») |
| 7 | Fiche PLB-PLH-SPLB pour VI PLB Nitrox et VI HELICO | Variante Nitrox du PLB ; plongeur hélicoptère | Fiches navette (marquées « à vérifier ») |
| 8 | VI CAT 1, CAT 2, CAT 2 INITOXY, sauveteur plongeur : fiche vierge | Aucune fiche AXONE à leur nom | Fiches navette : ajoutez une règle |
| 9 | IO et PATIO désignent la même aptitude (« plongeur intervention offensive ») | Même libellé dans le certificat PATIO réact et le certificat CAT 1 + IO | Aptitudes / Certificats |
| 10 | L'encart « ETIQUETTE AMADEUS » reçoit nom, prénom et date de naissance | Votre consigne place ces informations sur toutes les fiches | Case à décocher à l'import |
| 11 | Dates du test psy et du caisson = date du RDV par défaut, modifiables | Fiches initiales exemples : même date que la visite, sauf CAT 4 (deux jours différents) | Champs de saisie |
| 12 | Libellés PLH, S-PLB, PAT, IPH, DECPLOMIL non développés | Je ne connais pas leur forme longue avec certitude | Aptitudes |

Les fiches QUADRIENNALE, PLB-PLH-SPLB, PLD-IO-NC, SATURATION et DECPLOMIL ne contiennent pas l'encart « ETIQUETTE AMADEUS » dans le texte que j'ai reçu. Si l'identité doit y figurer, ajoutez `{{IDENTITE}}` à l'endroit voulu ; le rapport d'import signale ces fiches.
