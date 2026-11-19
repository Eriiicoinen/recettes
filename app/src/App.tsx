import { useEffect, useRef } from 'react'
import { HashRouter, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { SessionProvider, useSession } from './lib/session'
import { configMissing } from './lib/supabase'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import Placeholder from './pages/Placeholder'
import RecipeDetail from './pages/RecipeDetail'
import RecipeEdit from './pages/RecipeEdit'
import RecipeList from './pages/RecipeList'
import Settings from './pages/Settings'
import Week from './pages/Week'

const TABS = [
  { to: '/recettes', label: 'Recettes', icon: '📖' },
  { to: '/semaine', label: 'Semaine', icon: '📅' },
  { to: '/courses', label: 'Courses', icon: '🛒' },
  { to: '/reglages', label: 'Réglages', icon: '⚙️' },
]

/** Lien ou texte reçu via le menu Partager (?url=, ?text=) ou un Raccourci iPhone (?import=). */
function readShared(): string | null {
  const p = new URLSearchParams(window.location.search)
  const value = p.get('import') || p.get('url') || p.get('text')
  if (!value) return null
  // Nettoie l'adresse pour qu'un rechargement ne relance pas l'import
  window.history.replaceState(null, '', window.location.pathname + window.location.hash)
  return value
}
const sharedAtLaunch = readShared()

function ShareHandler() {
  const navigate = useNavigate()
  const { household } = useSession()
  const done = useRef(false)
  useEffect(() => {
    if (!sharedAtLaunch || !household || done.current) return
    done.current = true
    navigate(`/recettes/nouvelle?import=${encodeURIComponent(sharedAtLaunch)}`)
  }, [household, navigate])
  return null
}

function Shell() {
  const { session, household, loading } = useSession()

  if (configMissing) {
    return <main className="center-page"><p className="error">Configuration Supabase manquante (.env.local).</p></main>
  }
  if (loading) return <main className="center-page"><p className="muted">Chargement…</p></main>
  if (!session) return <Login />
  if (!household) return <Onboarding />

  return (
    <div className="app">
      <ShareHandler />
      <div className="content">
        <Routes>
          <Route path="/recettes" element={<RecipeList />} />
          <Route path="/recettes/nouvelle" element={<RecipeEdit />} />
          <Route path="/recettes/:id" element={<RecipeDetail />} />
          <Route path="/recettes/:id/modifier" element={<RecipeEdit />} />
          <Route path="/semaine" element={<Week />} />
          <Route path="/courses" element={<Placeholder title="Courses" text="La liste de courses arrive à l'étape M5." />} />
          <Route path="/reglages" element={<Settings />} />
          <Route path="*" element={<Navigate to="/recettes" replace />} />
        </Routes>
      </div>
      <nav className="tabbar">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
            <span className="tab-icon" aria-hidden>{t.icon}</span>
            <span>{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export default function App() {
  return (
    <SessionProvider>
      <HashRouter>
        <Shell />
      </HashRouter>
    </SessionProvider>
  )
}
