import { shrinkImage } from './images'
import { supabase } from './supabase'

const BUCKET = 'recipe-photos'

/** Chemin du fichier dans le stockage à partir de son adresse publique. */
function pathOf(url: string | null) {
  const marker = `/object/public/${BUCKET}/`
  const i = url?.indexOf(marker) ?? -1
  return url && i >= 0 ? decodeURIComponent(url.slice(i + marker.length).split('?')[0]) : null
}

/** Enregistre la photo du plat (réduite à 1200 px) et remplace l'ancienne. Renvoie l'adresse publique. */
export async function setRecipePhoto(householdId: string, recipeId: string, file: File, previous: string | null) {
  let blob: Blob
  try { blob = await shrinkImage(file, 1200, 0.8) } catch { throw new Error('Photo illisible : essaie en JPEG ou PNG.') }
  const path = `${householdId}/${recipeId}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' })
  if (error) throw new Error(`Envoi de la photo impossible : ${error.message}`)
  const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  const { error: e2 } = await supabase.from('recipes').update({ photo_url: url }).eq('id', recipeId)
  if (e2) throw e2
  const old = pathOf(previous)
  if (old) void supabase.storage.from(BUCKET).remove([old])
  return url
}

export async function removeRecipePhoto(recipeId: string, previous: string | null) {
  const { error } = await supabase.from('recipes').update({ photo_url: null }).eq('id', recipeId)
  if (error) throw error
  const old = pathOf(previous)
  if (old) void supabase.storage.from(BUCKET).remove([old])
}

/** Supprime les photos d'une recette supprimée. */
export async function deleteRecipePhotos(householdId: string, recipeId: string) {
  const folder = `${householdId}/${recipeId}`
  const { data } = await supabase.storage.from(BUCKET).list(folder)
  if (data?.length) await supabase.storage.from(BUCKET).remove(data.map((f) => `${folder}/${f.name}`))
}
