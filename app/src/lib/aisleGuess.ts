import { norm, type Aisle } from './recipes'

// Devine le rayon d'un nouvel ingrédient à partir de mots-clés. Modifiable ensuite dans le formulaire.
const RULES: [string, string[]][] = [
  ['Fruits & légumes', ['pomme', 'poire', 'banane', 'citron', 'orange', 'fraise', 'framboise', 'raisin', 'kiwi',
    'carotte', 'poireau', 'oignon', 'echalote', 'ail', 'tomate', 'courgette', 'aubergine', 'poivron', 'salade',
    'laitue', 'epinard', 'chou', 'brocoli', 'champignon', 'pomme de terre', 'patate', 'navet', 'celeri', 'fenouil',
    'courge', 'potiron', 'butternut', 'concombre', 'radis', 'betterave', 'haricot vert', 'petit pois', 'avocat',
    'persil', 'coriandre', 'basilic', 'menthe', 'ciboulette', 'thym', 'romarin', 'laurier', 'gingembre', 'mangue',
    'ananas', 'peche', 'abricot', 'cerise', 'prune', 'melon', 'pasteque', 'endive', 'artichaut', 'asperge', 'blette']],
  ['Boucherie / poisson', ['poulet', 'boeuf', 'veau', 'porc', 'agneau', 'canard', 'dinde', 'jambon', 'lardon',
    'saucisse', 'chorizo', 'steak', 'viande', 'hache', 'filet', 'cuisse', 'escalope', 'saumon', 'cabillaud', 'thon frais',
    'poisson', 'crevette', 'moule', 'lieu', 'merlu', 'dorade', 'bar ', 'calamar', 'lard']],
  ['Crèmerie', ['lait', 'beurre', 'creme', 'yaourt', 'fromage', 'emmental', 'gruyere', 'comte', 'parmesan', 'mozzarella',
    'feta', 'chevre', 'ricotta', 'mascarpone', 'oeuf', 'oeufs', 'reblochon', 'camembert', 'roquefort', 'skyr']],
  ['Boulangerie', ['pain', 'baguette', 'brioche', 'pain de mie', 'tortilla', 'wrap', 'pita']],
  ['Surgelés', ['surgele', 'glace', 'sorbet']],
  ['Boissons', ['vin ', 'vin blanc', 'vin rouge', 'biere', 'jus', 'cidre', 'eau gazeuse']],
  ['Épicerie', ['farine', 'sucre', 'sel', 'poivre', 'huile', 'vinaigre', 'moutarde', 'pates', 'riz', 'semoule',
    'lentille', 'pois chiche', 'haricot rouge', 'quinoa', 'boulgour', 'conserve', 'concentre', 'coulis', 'bouillon',
    'epice', 'cumin', 'curry', 'paprika', 'cannelle', 'muscade', 'levure', 'chocolat', 'cacao', 'miel', 'confiture',
    'sauce', 'soja', 'lait de coco', 'amande', 'noix', 'noisette', 'raisin sec', 'cafe', 'the', 'vanille', 'maizena',
    'chapelure', 'olive', 'capre', 'cornichon', 'thon', 'sardine', 'mais', 'gnocchi', 'nouille', 'spaghetti', 'penne',
    'tagliatelle', 'lasagne', 'herbes de provence', 'origan', 'piment', 'ketchup', 'mayonnaise', 'pesto']],
]

export function guessAisle(name: string, aisles: Aisle[]): string | null {
  const n = ` ${norm(name)} `
  for (const [aisleName, words] of RULES) {
    if (words.some((w) => n.includes(` ${w}`) || n.includes(`${w} `) || n.trim() === w.trim())) {
      return aisles.find((a) => a.name === aisleName)?.id ?? null
    }
  }
  return null
}
