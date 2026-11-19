/**
 * Menus, recettes et liste de courses — Google Sheets
 *
 * Installation (une seule fois, depuis un PC) :
 *   1. Créer un Google Sheet vide.
 *   2. Extensions > Apps Script, remplacer tout le contenu par ce fichier, enregistrer.
 *   3. Choisir la fonction "installer" dans la barre du haut, cliquer sur Exécuter,
 *      puis accepter la demande d'autorisation.
 *   4. Recharger le Google Sheet.
 *
 * Tout fonctionne ensuite par cases à cocher, y compris depuis l'appli mobile
 * (les menus personnalisés ne s'affichent que sur PC).
 */

const F_SEMAINE = 'Semaine';
const F_COURSES = 'Courses';
const F_RECETTES = 'Recettes';
const F_INGREDIENTS = 'Ingrédients';
const F_HISTORIQUE = 'Historique';

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const REPAS = ['Midi', 'Soir'];
const CATEGORIES = ['Entrée', 'Plat', 'Accompagnement', 'Soupe', 'Salade', 'Dessert', 'Autre'];
const SAISONS = ['Toute l\'année', 'Printemps', 'Été', 'Automne', 'Hiver'];
// L'ordre des rayons est celui du tri de la liste de courses : l'adapter au parcours du magasin.
const RAYONS = ['Fruits & légumes', 'Boucherie / poisson', 'Crèmerie', 'Épicerie', 'Boulangerie',
  'Surgelés', 'Boissons', 'Hygiène / maison', 'Autre'];

// Positions dans l'onglet Semaine
const MENU_PLAGE = 'B4:C10';
const MENU_LIGNE = 4;
const CASE_NOUVELLE_SEMAINE = 'A12';
const CASE_IDEES = 'A14';
const IDEES_LIGNE = 15;
const NB_IDEES = 5;
const JOURS_AVANT_RESUGGESTION = 30;

// Zone "Autres achats" de l'onglet Courses (colonnes G:H)
const MANUEL_COL = 7;
const MANUEL_LIGNES = 99;

/* ------------------------------------------------------------------ */
/* Déclencheurs                                                        */
/* ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🍽 Menus')
    .addItem('Nouvelle semaine (archiver)', 'nouvelleSemaine')
    .addItem('Recalculer la liste de courses', 'majCourses')
    .addItem('Autres idées', 'majIdees')
    .addItem('Recalculer « dernière fois »', 'majStats')
    .addToUi();
}

function onEdit(e) {
  if (!e || !e.range) return;
  const plage = e.range;
  const feuille = plage.getSheet();
  const nom = feuille.getName();
  const a1 = plage.getA1Notation();

  if (nom === F_SEMAINE) {
    if (a1 === CASE_NOUVELLE_SEMAINE) {
      if (plage.getValue() === true) nouvelleSemaine();
    } else if (a1 === CASE_IDEES) {
      if (plage.getValue() === true) {
        majIdees();
        plage.setValue(false);
      }
    } else if (touche_(plage, MENU_LIGNE, 2, JOURS.length, REPAS.length)) {
      majCourses();
    }
  } else if (nom === F_INGREDIENTS) {
    completerIngredient_(feuille, plage);
    majCourses();
  }
}

/** Vrai si la plage modifiée recoupe le rectangle donné. */
function touche_(plage, ligne, col, nbLignes, nbCols) {
  return plage.getRow() <= ligne + nbLignes - 1 && plage.getLastRow() >= ligne &&
    plage.getColumn() <= col + nbCols - 1 && plage.getLastColumn() >= col;
}

/** Reprend l'unité et le rayon d'un ingrédient déjà saisi ailleurs. */
function completerIngredient_(feuille, plage) {
  if (plage.getNumRows() !== 1 || plage.getNumColumns() !== 1) return;
  if (plage.getColumn() !== 2 || plage.getRow() < 2) return;
  const cle = norm_(plage.getValue());
  if (!cle) return;
  const ligne = plage.getRow();
  const derniere = feuille.getLastRow();
  if (derniere < 2) return;
  const donnees = feuille.getRange(2, 2, derniere - 1, 4).getValues(); // B:E
  const actuelle = donnees[ligne - 2];
  for (let i = 0; i < donnees.length; i++) {
    if (i === ligne - 2) continue;
    const r = donnees[i];
    if (norm_(r[0]) === cle && r[3] !== '') {
      if (actuelle[2] === '') feuille.getRange(ligne, 4).setValue(r[2]);
      if (actuelle[3] === '') feuille.getRange(ligne, 5).setValue(r[3]);
      return;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Liste de courses                                                    */
/* ------------------------------------------------------------------ */

function majCourses() {
  const ss = SpreadsheetApp.getActive();
  const courses = ss.getSheetByName(F_COURSES);
  const semaine = ss.getSheetByName(F_SEMAINE);
  const ingredients = ss.getSheetByName(F_INGREDIENTS);
  if (!courses || !semaine || !ingredients) return;

  // Plats de la semaine, avec le nombre de fois où ils apparaissent
  const plats = {};
  semaine.getRange(MENU_PLAGE).getValues().forEach(function (ligne) {
    ligne.forEach(function (v) {
      const cle = norm_(v);
      if (!cle) return;
      if (!plats[cle]) plats[cle] = { nom: String(v).trim(), fois: 0, trouve: false };
      plats[cle].fois++;
    });
  });

  // Cumul des ingrédients
  const articles = {};
  const nIng = ingredients.getLastRow() - 1;
  const lignesIng = nIng > 0 ? ingredients.getRange(2, 1, nIng, 5).getValues() : [];
  lignesIng.forEach(function (r) {
    const plat = plats[norm_(r[0])];
    const nomIng = String(r[1]).trim();
    if (!plat || !nomIng) return;
    plat.trouve = true;
    const unite = String(r[3]).trim();
    const cle = norm_(nomIng) + '|' + norm_(unite);
    if (!articles[cle]) {
      articles[cle] = { nom: nomIng, unite: unite, somme: 0, textes: [], rayon: '', pour: [] };
    }
    const a = articles[cle];
    if (typeof r[2] === 'number') a.somme += r[2] * plat.fois;
    else if (String(r[2]).trim() !== '') a.textes.push(String(r[2]).trim());
    if (!a.rayon && r[4] !== '') a.rayon = String(r[4]);
    if (a.pour.indexOf(plat.nom) === -1) a.pour.push(plat.nom);
  });

  const liste = Object.keys(articles).map(function (k) { return articles[k]; });
  liste.sort(function (x, y) {
    return rangRayon_(x.rayon) - rangRayon_(y.rayon) || x.nom.localeCompare(y.nom, 'fr');
  });

  // Les cases déjà cochées le restent
  const max = courses.getMaxRows();
  const coches = {};
  courses.getRange(2, 1, max - 1, 2).getValues().forEach(function (r) {
    if (r[0] === true && r[1] !== '') coches[norm_(r[1])] = true;
  });

  const sortie = liste.map(function (a) {
    return [coches[norm_(a.nom)] === true, a.nom, quantite_(a), a.rayon, a.pour.join(', ')];
  });

  // Plats du carnet sans ingrédients saisis : on le signale plutôt que de les oublier
  const connus = nomsRecettes_(ss);
  Object.keys(plats).forEach(function (k) {
    if (!plats[k].trouve && connus[k]) {
      sortie.push([coches[k] === true, plats[k].nom, '', 'À vérifier', 'ingrédients non saisis']);
    }
  });

  courses.getRange(2, 1, max - 1, 5).clearContent().clearDataValidations();
  if (sortie.length) {
    courses.getRange(2, 1, sortie.length, 1).insertCheckboxes();
    courses.getRange(2, 1, sortie.length, 5).setValues(sortie);
  }
}

function quantite_(a) {
  const morceaux = [];
  if (a.somme > 0) {
    const n = String(Math.round(a.somme * 100) / 100).replace('.', ',');
    morceaux.push(a.unite ? n + ' ' + a.unite : n);
  }
  return morceaux.concat(a.textes).join(' + ');
}

function rangRayon_(rayon) {
  const i = RAYONS.indexOf(rayon);
  return i === -1 ? RAYONS.length : i;
}

function nomsRecettes_(ss) {
  const rec = ss.getSheetByName(F_RECETTES);
  const noms = {};
  const n = rec ? rec.getLastRow() - 1 : 0;
  if (n > 0) {
    rec.getRange(2, 1, n, 1).getValues().forEach(function (r) {
      if (norm_(r[0])) noms[norm_(r[0])] = true;
    });
  }
  return noms;
}

/* ------------------------------------------------------------------ */
/* Nouvelle semaine                                                    */
/* ------------------------------------------------------------------ */

function nouvelleSemaine() {
  const ss = SpreadsheetApp.getActive();
  const semaine = ss.getSheetByName(F_SEMAINE);
  const hist = ss.getSheetByName(F_HISTORIQUE);
  const courses = ss.getSheetByName(F_COURSES);

  const menu = semaine.getRange(MENU_PLAGE).getValues();
  let debut = semaine.getRange('B1').getValue();
  if (!(debut instanceof Date)) debut = lundi_(new Date());

  const lignes = [];
  menu.forEach(function (ligne, j) {
    const date = new Date(debut.getFullYear(), debut.getMonth(), debut.getDate() + j);
    ligne.forEach(function (plat, r) {
      if (String(plat).trim() !== '') lignes.push([date, JOURS[j], REPAS[r], String(plat).trim()]);
    });
  });

  semaine.getRange(CASE_NOUVELLE_SEMAINE).setValue(false);
  if (!lignes.length) {
    message_('Menu vide : rien à archiver.');
    return;
  }

  hist.getRange(hist.getLastRow() + 1, 1, lignes.length, 4).setValues(lignes);
  semaine.getRange(MENU_PLAGE).clearContent();
  semaine.getRange('B1').setValue(
    new Date(debut.getFullYear(), debut.getMonth(), debut.getDate() + 7));

  // Achats manuels : on retire ceux qui sont cochés, on garde les autres
  const manuel = courses.getRange(2, MANUEL_COL, MANUEL_LIGNES, 2).getValues();
  const gardes = manuel.filter(function (r) { return r[1] !== '' && r[0] !== true; })
    .map(function (r) { return [false, r[1]]; });
  while (gardes.length < MANUEL_LIGNES) gardes.push([false, '']);
  courses.getRange(2, MANUEL_COL, MANUEL_LIGNES, 2).setValues(gardes);

  majCourses();
  majStats();
  majIdees();
  message_(lignes.length + ' repas archivés. Nouvelle semaine prête.');
}

function lundi_(d) {
  const decalage = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - decalage);
}

/* ------------------------------------------------------------------ */
/* Carnet : dernière fois, nombre de fois, idées                       */
/* ------------------------------------------------------------------ */

/** Recalcule « Dernière fois » et « Nb de fois » du carnet à partir de l'historique. */
function majStats() {
  const ss = SpreadsheetApp.getActive();
  const rec = ss.getSheetByName(F_RECETTES);
  const hist = ss.getSheetByName(F_HISTORIQUE);
  const n = rec.getLastRow() - 1;
  if (n < 1) return;

  const stats = {};
  const nHist = hist.getLastRow() - 1;
  if (nHist > 0) {
    hist.getRange(2, 1, nHist, 4).getValues().forEach(function (r) {
      const cle = norm_(r[3]);
      if (!cle) return;
      if (!stats[cle]) stats[cle] = { derniere: null, fois: 0 };
      stats[cle].fois++;
      if (r[0] instanceof Date && (!stats[cle].derniere || r[0] > stats[cle].derniere)) {
        stats[cle].derniere = r[0];
      }
    });
  }

  const sortie = rec.getRange(2, 1, n, 1).getValues().map(function (r) {
    const s = stats[norm_(r[0])];
    return s ? [s.derniere || '', s.fois] : ['', ''];
  });
  rec.getRange(2, 7, n, 2).setValues(sortie);
}

/** Propose des plats bien notés, de saison, pas cuisinés récemment et absents du menu. */
function majIdees() {
  const ss = SpreadsheetApp.getActive();
  const semaine = ss.getSheetByName(F_SEMAINE);
  const rec = ss.getSheetByName(F_RECETTES);
  const cible = semaine.getRange(IDEES_LIGNE, 2, NB_IDEES, 2);
  cible.clearContent();
  const n = rec.getLastRow() - 1;
  if (n < 1) return;

  const auMenu = {};
  semaine.getRange(MENU_PLAGE).getValues().forEach(function (ligne) {
    ligne.forEach(function (v) { if (norm_(v)) auMenu[norm_(v)] = true; });
  });

  const saison = saison_(new Date());
  const limite = new Date();
  limite.setDate(limite.getDate() - JOURS_AVANT_RESUGGESTION);

  const bonnes = [];
  const autres = [];
  rec.getRange(2, 1, n, 8).getValues().forEach(function (r) {
    const nom = String(r[0]).trim();
    if (!nom || auMenu[norm_(nom)]) return;
    const note = Number(r[4]) || 0;
    const derniere = r[6] instanceof Date ? r[6] : null;
    const deSaison = r[2] === '' || r[2] === SAISONS[0] || r[2] === saison;
    const detail = (note ? note + ' ★' : 'pas encore noté') +
      (derniere ? ' · ' + Utilities.formatDate(derniere, ss.getSpreadsheetTimeZone(), 'dd/MM/yyyy')
        : ' · jamais fait');
    const idee = [nom, detail];
    // Une recette sans note reste proposable : c'est le cas de tout le carnet au départ
    if ((note === 0 || note >= 4) && deSaison && (!derniere || derniere < limite)) bonnes.push(idee);
    else if (note === 0 || note >= 3) autres.push(idee);
  });

  melanger_(bonnes);
  melanger_(autres);
  const choix = bonnes.concat(autres).slice(0, NB_IDEES);
  if (choix.length) semaine.getRange(IDEES_LIGNE, 2, choix.length, 2).setValues(choix);
}

function saison_(d) {
  const m = d.getMonth() + 1;
  if (m >= 3 && m <= 5) return 'Printemps';
  if (m >= 6 && m <= 8) return 'Été';
  if (m >= 9 && m <= 11) return 'Automne';
  return 'Hiver';
}

function melanger_(t) {
  for (let i = t.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = t[i];
    t[i] = t[j];
    t[j] = tmp;
  }
}

function norm_(v) {
  return String(v === null || v === undefined ? '' : v).trim().toLowerCase();
}

function message_(texte) {
  try {
    SpreadsheetApp.getActive().toast(texte, 'Menus', 5);
  } catch (err) {
    // Pas d'affichage possible dans ce contexte : sans importance
  }
}

/* ------------------------------------------------------------------ */
/* Installation                                                        */
/* ------------------------------------------------------------------ */

/** Crée les onglets, les listes déroulantes et les cases. Peut être relancée sans perte de données. */
function installer() {
  const ss = SpreadsheetApp.getActive();
  const semaine = feuille_(ss, F_SEMAINE, 0);
  const courses = feuille_(ss, F_COURSES, 1);
  const rec = feuille_(ss, F_RECETTES, 2);
  const ing = feuille_(ss, F_INGREDIENTS, 3);
  const hist = feuille_(ss, F_HISTORIQUE, 4);

  // --- Recettes
  entete_(rec, ['Nom', 'Catégorie', 'Saison', 'Temps (min)', 'Note', 'Lien / notes',
    'Dernière fois', 'Nb de fois']);
  rec.getRange('B2:B').setDataValidation(liste_(CATEGORIES));
  rec.getRange('C2:C').setDataValidation(liste_(SAISONS));
  rec.getRange('E2:E').setDataValidation(liste_(['1', '2', '3', '4', '5']));
  rec.getRange('G2:G').setNumberFormat('dd/mm/yyyy');
  rec.setColumnWidth(1, 240);
  rec.setColumnWidth(6, 300);
  if (!rec.getFilter()) rec.getRange('A:H').createFilter();

  // --- Ingrédients
  entete_(ing, ['Recette', 'Ingrédient', 'Quantité', 'Unité', 'Rayon']);
  ing.getRange('A2:A').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(rec.getRange('A2:A'), true).setAllowInvalid(false).build());
  ing.getRange('E2:E').setDataValidation(liste_(RAYONS));
  ing.setColumnWidth(1, 240);
  ing.setColumnWidth(2, 200);
  ing.setColumnWidth(5, 170);
  if (!ing.getFilter()) ing.getRange('A:E').createFilter();

  // --- Historique
  entete_(hist, ['Date', 'Jour', 'Repas', 'Plat']);
  hist.getRange('A2:A').setNumberFormat('dd/mm/yyyy');
  hist.setColumnWidth(4, 240);

  // --- Semaine
  semaine.getRange('A1').setValue('Semaine du').setFontWeight('bold');
  if (semaine.getRange('B1').getValue() === '') semaine.getRange('B1').setValue(lundi_(new Date()));
  semaine.getRange('B1').setNumberFormat('dd/mm/yyyy').setHorizontalAlignment('left');
  semaine.getRange('A3:C3').setValues([['Jour'].concat(REPAS)])
    .setFontWeight('bold').setBackground('#e8eaed');
  semaine.getRange(MENU_LIGNE, 1, JOURS.length, 1)
    .setValues(JOURS.map(function (j) { return [j]; })).setFontWeight('bold');
  // Saisie libre acceptée (restes, resto, invités…) en plus des recettes du carnet
  semaine.getRange(MENU_PLAGE).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(rec.getRange('A2:A'), true).setAllowInvalid(true).build());
  semaine.getRange(CASE_NOUVELLE_SEMAINE).insertCheckboxes();
  semaine.getRange('B12').setValue('Nouvelle semaine : archive ce menu et vide la liste');
  semaine.getRange(CASE_IDEES).insertCheckboxes();
  semaine.getRange('B14').setValue('💡 Idées (cocher pour en voir d\'autres)').setFontWeight('bold');
  semaine.setColumnWidth(1, 100);
  semaine.setColumnWidth(2, 240);
  semaine.setColumnWidth(3, 240);
  semaine.setFrozenRows(3);

  // --- Courses
  courses.getRange('A1:E1').setValues([['✔', 'Article', 'Quantité', 'Rayon', 'Pour']])
    .setFontWeight('bold').setBackground('#e8eaed');
  courses.getRange(1, MANUEL_COL, 1, 2).setValues([['✔', 'Autres achats']])
    .setFontWeight('bold').setBackground('#e8eaed');
  courses.getRange(2, MANUEL_COL, MANUEL_LIGNES, 1).insertCheckboxes();
  courses.setFrozenRows(1);
  courses.setColumnWidth(1, 35);
  courses.setColumnWidth(2, 200);
  courses.setColumnWidth(4, 150);
  courses.setColumnWidth(5, 220);
  courses.setColumnWidth(6, 25);
  courses.setColumnWidth(MANUEL_COL, 35);
  courses.setColumnWidth(MANUEL_COL + 1, 220);

  // --- Exemples, uniquement si le carnet est vide
  if (rec.getLastRow() < 2) {
    rec.getRange(2, 1, 3, 6).setValues([
      ['Pâtes bolognaise', 'Plat', SAISONS[0], 40, 4, ''],
      ['Gratin dauphinois', 'Accompagnement', 'Hiver', 75, 5, ''],
      ['Salade de chèvre chaud', 'Salade', 'Été', 15, '', '']
    ]);
    ing.getRange(2, 1, 11, 5).setValues([
      ['Pâtes bolognaise', 'Spaghetti', 500, 'g', 'Épicerie'],
      ['Pâtes bolognaise', 'Bœuf haché', 400, 'g', 'Boucherie / poisson'],
      ['Pâtes bolognaise', 'Coulis de tomate', 500, 'g', 'Épicerie'],
      ['Pâtes bolognaise', 'Oignon', 1, '', 'Fruits & légumes'],
      ['Gratin dauphinois', 'Pommes de terre', 1, 'kg', 'Fruits & légumes'],
      ['Gratin dauphinois', 'Crème liquide', 50, 'cl', 'Crèmerie'],
      ['Gratin dauphinois', 'Ail', 2, 'gousses', 'Fruits & légumes'],
      ['Salade de chèvre chaud', 'Salade verte', 1, '', 'Fruits & légumes'],
      ['Salade de chèvre chaud', 'Bûche de chèvre', 1, '', 'Crèmerie'],
      ['Salade de chèvre chaud', 'Pain de campagne', 4, 'tranches', 'Boulangerie'],
      ['Salade de chèvre chaud', 'Miel', '', '', 'Épicerie']
    ]);
  }

  // Onglet vide créé par défaut avec le classeur
  ss.getSheets().forEach(function (f) {
    const connus = [F_SEMAINE, F_COURSES, F_RECETTES, F_INGREDIENTS, F_HISTORIQUE];
    if (connus.indexOf(f.getName()) === -1 && f.getLastRow() === 0) ss.deleteSheet(f);
  });

  majStats();
  majCourses();
  majIdees();
  ss.setActiveSheet(semaine);
}

function feuille_(ss, nom, position) {
  return ss.getSheetByName(nom) || ss.insertSheet(nom, Math.min(position, ss.getSheets().length));
}

function entete_(feuille, titres) {
  feuille.getRange(1, 1, 1, titres.length).setValues([titres])
    .setFontWeight('bold').setBackground('#e8eaed');
  feuille.setFrozenRows(1);
}

function liste_(valeurs) {
  return SpreadsheetApp.newDataValidation().requireValueInList(valeurs, true)
    .setAllowInvalid(false).build();
}
