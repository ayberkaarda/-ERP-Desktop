// Desktop entry: the web app (frontend/src) with the desktop platform runtime
// and extensions swapped in at build time (tooling/swaps.ts). Mirrors
// frontend/src/main.tsx; the tree itself is in ./app/root.tsx.
import '@fontsource-variable/ibm-plex-sans/wght.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
// sonner also injects this CSS as a <style> element at run time, which
// style-src 'self' refuses; the bundled copy is the one that applies.
import 'sonner/dist/styles.css'
import './styles.css'

import { createRoot } from 'react-dom/client'

import { registerFeatureCommands } from '@/app/featureCommands'
import { createRouter } from '@/app/router'
import i18n from '@/lib/i18n'

import { DesktopRoot } from './app/root'
import { addDesktopResources } from './i18n'

addDesktopResources(i18n)
registerFeatureCommands()
const router = createRouter()
const root = document.getElementById('root')
if (!root) throw new Error('#root missing')

createRoot(root).render(<DesktopRoot router={router} />)
