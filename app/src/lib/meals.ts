import { guessAisle } from './aisleGuess'
import { parseIngredientLine } from './parseLine'
import { emptyDraft, saveRecipe, type Aisle, type RecipeDraft, type RecipeLine } from './recipes'

/**
 * Crée un repas sans recette depuis une liste (« 800 g fromage à raclette », « Cornichons »…).
 * Les articles inconnus sont rangés dans le rayon deviné.
 */
export async function createSimpleMeal(householdId: string, userId: string, name: string, people: number, linesText: string, aisles: Aisle[]) {
  const lines = linesText.split(/\r?\n/).map(parseIngredientLine).filter((l): l is RecipeLine => !!l)
    .map((l) => ({ ...l, name: l.name.charAt(0).toUpperCase() + l.name.slice(1), aisle_id: guessAisle(l.name, aisles) }))
  const draft: RecipeDraft = { ...emptyDraft(), name: name.trim(), servings: Math.max(1, people), is_simple: true, lines }
  return saveRecipe(householdId, userId, draft)
}
