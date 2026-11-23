// Accords mets-vins : schéma et consignes partagés par import-recipe et drinks (Deno uniquement).
import { z } from 'npm:zod@4.6.7'

export const DRINK_STYLES = ['rouge', 'blanc', 'rosé', 'bulles', 'doux', 'autre'] as const

export const drinksSchema = z.array(z.object({
  name: z.string().describe('Appellation ou type de vin précis, ex. « Saint-Joseph rouge », « Chablis », « Crémant d\'Alsace »'),
  style: z.enum(DRINK_STYLES).describe('autre = cidre, bière, etc.'),
  why: z.string().describe('Une phrase courte : pourquoi ça va avec le plat'),
})).describe('3 ou 4 accords pour accompagner le plat')

export const DRINKS_RULES = `Accords (drinks) : propose 3 ou 4 vins qui vont avec le plat, comme un caviste de quartier : appellations françaises de préférence, faciles à trouver en grande surface, styles et budgets variés (au moins un abordable). Pour un dessert, des vins doux ou des bulles. Si l'accord classique est un cidre ou une bière (crêpes, moules-frites), tu peux en proposer un en plus. Pour chaque proposition, une raison courte et concrète.`
