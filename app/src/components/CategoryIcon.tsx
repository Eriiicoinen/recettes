import { Cake, Carrot, CookingPot, Salad, ShoppingBasket, Soup, Utensils, type LucideProps } from 'lucide-react'
import type { Recipe } from '../lib/recipes'

const ICONS: Record<string, typeof CookingPot> = {
  Entrée: Salad, Plat: CookingPot, Accompagnement: Carrot, Soupe: Soup, Salade: Salad, Dessert: Cake, Autre: Utensils,
}

/** Icône de la catégorie (panier pour un repas sans recette). */
export function CategoryIcon({ recipe, ...props }: { recipe: Pick<Recipe, 'category' | 'is_simple'> } & LucideProps) {
  const Icon = recipe.is_simple ? ShoppingBasket : ICONS[recipe.category] ?? Utensils
  return <Icon {...props} />
}

/** Classe de couleur du visuel par défaut, selon la catégorie. */
export const tintOf = (r: Pick<Recipe, 'category' | 'is_simple'>) =>
  r.is_simple ? 'tint-basket' : `tint-${(r.category || 'Autre').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()}`
