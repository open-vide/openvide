import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "./styles/app.css"
import { hydrateFromSDK } from "even-toolkit/storage"

const STORAGE_KEYS = [
  'openvide_hosts',
  'openvide_hosts_tokens',
  'openvide_active_host',
  'openvide_settings_cache',
  'openvide_settings_cache_secret',
  'openvide_settings_pending',
  'openvide_settings_pending_secret',
  'openvide_session_labels',
  'openvide_guide_dismissed',
  'openvide_file_sort',
]

hydrateFromSDK(STORAGE_KEYS).finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
})
