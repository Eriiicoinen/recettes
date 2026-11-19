import { guessAisle } from './aisleGuess'
import { emptyDraft, listAisles, saveRecipe, type RecipeDraft, type RecipeLine } from './recipes'

const line = (name: string, quantity: number | null = null, unit: string | null = null, note: string | null = null): RecipeLine =>
  ({ name, quantity, unit, note })

/** Trois exemples pour un nouveau foyer : une recette, une soupe de saison, un repas sans recette. */
const SAMPLES: Partial<RecipeDraft>[] = [
  {
    name: 'Pâtes à la carbonara', category: 'Plat', servings: 4, prep_minutes: 10, cook_minutes: 12, tags: ['rapide'],
    lines: [line('Spaghetti', 400, 'g'), line('Lardons', 150, 'g'), line('Œuf', 4), line('Parmesan', 80, 'g', 'râpé'), line('Poivre')],
    steps: [
      'Cuire les pâtes dans une grande casserole d\'eau salée, 10 minutes.',
      'Pendant ce temps, faire dorer les lardons à sec dans une poêle.',
      'Battre les œufs avec le parmesan et beaucoup de poivre.',
      'Égoutter les pâtes en gardant un peu d\'eau de cuisson, les mélanger hors du feu avec les lardons puis les œufs. Détendre avec un peu d\'eau de cuisson.',
    ],
  },
  {
    name: 'Soupe de légumes d\'hiver', category: 'Soupe', servings: 4, prep_minutes: 15, cook_minutes: 30, seasons: ['Automne', 'Hiver'],
    tags: ['végétarien'],
    lines: [line('Poireau', 2), line('Carotte', 3), line('Pomme de terre', 2), line('Oignon', 1), line('Bouillon de légumes', 1, 'l'), line('Crème fraîche', 10, 'cl', 'facultatif')],
    steps: [
      'Éplucher et couper tous les légumes en morceaux.',
      'Faire revenir l\'oignon 5 minutes, ajouter les légumes et le bouillon.',
      'Cuire 30 minutes à frémissement, puis mixer. Ajouter la crème au moment de servir.',
    ],
  },
  {
    name: 'Raclette', category: 'Plat', servings: 4, is_simple: true, seasons: ['Automne', 'Hiver'],
    lines: [line('Fromage à raclette', 800, 'g'), line('Pomme de terre', 1.2, 'kg'), line('Charcuterie', 400, 'g', 'jambon cru, rosette…'), line('Cornichon')],
  },
]

export async function addSampleRecipes(householdId: string, userId: string) {
  const aisles = await listAisles(householdId)
  for (const sample of SAMPLES) {
    const lines = (sample.lines ?? []).map((l) => ({ ...l, aisle_id: guessAisle(l.name, aisles) }))
    await saveRecipe(householdId, userId, { ...emptyDraft(), ...sample, lines, tags: [...(sample.tags ?? []), 'exemple'] })
  }
}
