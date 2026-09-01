import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Where the dev server forwards API calls: the Node backend (its PORT, 3000 by default).
  const env = loadEnv(mode, '.', 'VITE_') // '.' = the folder Vite runs in
  const backend = env.VITE_PROXY_TARGET || 'http://127.0.0.1:3000'

  return {
    plugins: [react(), tailwindcss()],
    server: {
      // Exactly the backend routes the app calls. Everything
      // else, e.g. /doctor/add-patient on a hard refresh, is a React route served
      // by Vite (fixed in Phase 7).
      proxy: {
        '/csrf/': backend,
        '/login/': backend,
        '/patient/dashboard/': backend,
        '/patient/logout/': backend,
        '/patient/chatbot/send/': backend,
        '/doctor_info': backend,
        '/exercise/sessions/': backend,
        '/static/': backend,
      }
    }
  }
})
