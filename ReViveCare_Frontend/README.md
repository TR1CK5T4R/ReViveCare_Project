# ReviveCare frontend

The React app of ReviveCare, a post-surgery rehabilitation helper. Doctors add patients with their medical notes; patients log in with their email, chat with an AI assistant that knows those notes (English or Hindi), and do camera-tracked exercises with a live rep counter. The API is the Node.js backend in `../ReViveCare_Backend/`.

Built with React 19, Vite, React Router, Tailwind CSS, lucide icons and MediaPipe (`@mediapipe/tasks-vision`) for pose tracking.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
```

Start the backend first (`npm run dev` in `../ReViveCare_Backend`, port 3000). In development the Vite server forwards the API paths to it (see `vite.config.js`), so the browser only ever talks to `localhost:5173` and the session cookie works without any CORS setup. Leave `VITE_API_BASE_URL` unset; `VITE_PROXY_TARGET` changes where the proxy points (default `http://127.0.0.1:3000`). Both are described in `.env.example`.

Other scripts: `npm run build` (production build into `dist/`), `npm run preview`, `npm run lint`, `npm test` (the exercise logic tests).

## How it talks to the backend

All API calls go through `src/services/djangoApi.js` (named after the backend it was first written for; the Node backend keeps the same API). It sends cookies with every request (`credentials: 'include'`) and copies the `csrftoken` cookie into an `X-CSRFToken` header.

| Screen | Route | Backend calls |
|---|---|---|
| Landing page | `/` | — |
| Doctor: add a patient | `/doctor/add-patient` | `POST /doctor_info` `{name, email, info}` |
| Patient login | `/patient/login` | `GET /csrf/`, then `POST /login/` (form, email only), then `GET /patient/dashboard/` |
| Patient dashboard | `/patient/dashboard` | `GET /patient/dashboard/` (the patient's name; the cards are placeholder data) |
| Chat | `/patient/chat` | `POST /patient/chatbot/send/` `{message, language}` → reply and seriousness score |
| Exercises | `/patient/exercises` → `/patient/exercise/:id` | demo video from `/static/Patients/videos/…`; finished sets saved with `POST /exercise/sessions/` |
| Doctor dashboard, medical dashboard | `/doctor`, `/medical-dashboard` | — (placeholder data) |

**Login state** lives in the backend's `sessionid` cookie (HttpOnly). `src/context/AuthContext.jsx` asks `GET /patient/dashboard/` on every page load: a patient in the answer means logged in, a 401 means logged out.

**Chat** shows the assistant's reply and colours the seriousness score; the backend emails (and can phone) the doctor when the score is above 0.75.

**Exercise tracking** runs entirely in the browser: `src/hooks/usePoseWorkout.js` opens the camera, runs MediaPipe's pose model on each video frame, and feeds the landmarks to `src/utils/exerciseLogic.js`, which measures the arm angles, counts reps, grades each one (excellent / good / partial) and raises form warnings (uneven arms, shrugging, bent elbows). The page draws the tracked arms over the mirrored video. When a set ends or is reset, it's sent to the backend to be stored.

## Folders

| Path | What's in it |
|---|---|
| `src/pages/` | One component per screen |
| `src/components/` | Shared UI pieces (cards, buttons, form fields, layout, navbar) |
| `src/context/AuthContext.jsx` | Who is logged in |
| `src/hooks/` | `usePatientData`, `useDoctorData` (API calls with loading/error state), `usePoseWorkout` (camera + pose tracking) |
| `src/services/djangoApi.js` | Every backend call |
| `src/utils/exerciseLogic.js` | Rep counting and form checks (pure functions, unit-tested) |
| `tests/` | Exercise logic tests against recorded landmark sequences |
| `public/` | Static assets |
