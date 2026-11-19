import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/fraunces'
import './index.css'
import App from './App.tsx'
import { captureLaunchLinks } from './lib/launch'

// Lien « mot de passe oublié » ou d'invitation : lu avant le routeur, qui utilise aussi le # de l'adresse
void captureLaunchLinks().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
