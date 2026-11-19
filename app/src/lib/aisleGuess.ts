import { guessAisleName } from '../../../supabase/functions/_shared/aisleRules.ts'
import type { Aisle } from './recipes'

/** Rayon probable d'un nouvel article (modifiable ensuite). Règles partagées avec le serveur de Claude. */
export function guessAisle(name: string, aisles: Aisle[]): string | null {
  const target = guessAisleName(name)
  return target ? aisles.find((a) => a.name === target)?.id ?? null : null
}
