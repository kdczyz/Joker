import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ExtensionHostClient, type HostTransport } from '@joker-code/extension-api'
import { VideoEditorWorkbench } from './app.js'
import { useEditorController } from './controller.js'
import './styles.css'

declare global {
  interface Window {
    readonly JokerExtension: HostTransport
  }
}

const client = new ExtensionHostClient(window.JokerExtension)

function App(): React.JSX.Element {
  const controller = useEditorController(client)
  return <VideoEditorWorkbench controller={controller} />
}

const root = document.querySelector('#root')
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>)

window.addEventListener('pagehide', () => void client.dispose(), { once: true })
