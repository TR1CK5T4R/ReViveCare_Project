# ReViveCare — Frontend

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)
![MediaPipe](https://img.shields.io/badge/MediaPipe-pose_tracking-0097A7)

The React app of **ReViveCare**, a post-surgery rehabilitation assistant I built as a personal project. Doctors add patients with their medical notes. Patients log in, chat with an AI assistant that knows those notes (English or Hindi), and do exercises tracked by their webcam with a live rep counter. The API is the Node.js backend in [`../ReViveCare_Backend`](../ReViveCare_Backend).

> **About this project.** ReViveCare is a student project, built and maintained by me, [Tushar Singla](#author), a final-year B.Tech IT student. It isn't a commercial product, and it isn't meant for real patients or real medical data.

## Features

- **AI recovery assistant:** a chat that answers in English or Hindi based on the patient's own medical notes, and shows how serious the message looked (the doctor is alerted automatically for serious ones).
- **Camera-tracked exercises:** pose detection runs entirely in the browser with MediaPipe; the app counts reps, grades each one (excellent / good / partial) and warns about form problems such as uneven arms, shrugging or bent elbows. Video never leaves the device.
- **Doctor tools:** add or update a patient's details and medical notes.
- **Patient dashboard** and exercise library with demo videos.

## Try it: demo accounts

Open the app, choose **Patient**, and log in with one of these accounts. They hold made-up data only:

| Name                    | Email (login)                   | Password   | Medical notes (made up)              |
| ----------------------- | ------------------------------- | ---------- | ------------------------------------ |
| Demo Patient (Knee)     | `demo.knee@revivecare.test`     | `demo1234` | knee ACL reconstruction, 10 days ago |
| Demo Patient (Hip)      | `demo.hip@revivecare.test`      | `demo1234` | hip replacement, 3 weeks ago         |
| Demo Patient (Shoulder) | `demo.shoulder@revivecare.test` | `demo1234` | rotator cuff repair, 6 weeks ago     |

Patient login is **email only** in this version: the password field has to be filled in, but its value isn't checked. The doctor pages need no login; if you add a patient there, please use made-up details. The exercise pages ask for camera access.

## Tech stack

React 19, Vite, React Router, Tailwind CSS, lucide-react icons, MediaPipe Tasks (`@mediapipe/tasks-vision`), Vitest.

## Getting started

**Requirements:** Node.js 20+ and the backend running locally (see its README).

```sh
npm install
npm run dev      # http://localhost:5173
```

Start the backend first (`npm run dev` in `../ReViveCare_Backend`, port 3000). In development, Vite forwards the API calls to it (see `vite.config.js`), so the browser only talks to `localhost:5173` and the login cookie works without extra setup. Leave `VITE_API_BASE_URL` unset; `VITE_PROXY_TARGET` changes where the calls go (default `http://127.0.0.1:3000`). Both are described in `.env.example`.

| Command           | What it does                       |
| ----------------- | ---------------------------------- |
| `npm run dev`     | Development server                 |
| `npm run build`   | Production build into `dist/`      |
| `npm run preview` | Serve the production build locally |
| `npm run lint`    | ESLint                             |
| `npm test`        | Unit tests for the exercise logic  |

## How it works

All backend calls go through `src/services/djangoApi.js` (named after the backend the app was first written for; the Node.js backend keeps the same API). Every request sends the session cookie and the CSRF token.

| Screen                              | Route                                         | Backend calls                                                                     |
| ----------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------- |
| Landing page                        | `/`                                           | —                                                                                 |
| Doctor: add a patient               | `/doctor/add-patient`                         | `POST /doctor_info`                                                               |
| Patient login                       | `/patient/login`                              | `GET /csrf/`, `POST /login/`, then `GET /patient/dashboard/`                      |
| Patient dashboard                   | `/patient/dashboard`                          | `GET /patient/dashboard/`                                                         |
| Chat                                | `/patient/chat`                               | `POST /patient/chatbot/send/`                                                     |
| Exercises                           | `/patient/exercises`, `/patient/exercise/:id` | demo videos from `/static/…`; finished sets saved with `POST /exercise/sessions/` |
| Doctor dashboard, medical dashboard | `/doctor`, `/medical-dashboard`               | — (sample data)                                                                   |

- **Login state** lives in the backend's session cookie. `src/context/AuthContext.jsx` checks it on each page load by asking for the dashboard data.
- **Exercise tracking:** `src/hooks/usePoseWorkout.js` opens the camera and runs MediaPipe's pose model on each video frame; `src/utils/exerciseLogic.js` turns the body landmarks into arm angles, reps, grades and warnings. The tracked arms are drawn over the mirrored video, and each finished set is saved to the backend. The rep logic is unit-tested against recorded movement data.

## Project structure

| Path              | What's in it                                                   |
| ----------------- | -------------------------------------------------------------- |
| `src/pages/`      | One component per screen                                       |
| `src/components/` | Shared UI pieces (cards, buttons, form fields, layout, navbar) |
| `src/context/`    | Login state                                                    |
| `src/hooks/`      | Data loading hooks and the camera / pose tracking hook         |
| `src/services/`   | Every backend call                                             |
| `src/utils/`      | Rep counting and form checks                                   |
| `tests/`          | Unit tests and recorded movement data                          |
| `public/`         | Static assets                                                  |

## Deployment

The app runs locally today. To put it online, build it with `npm run build` and serve `dist/` from the same domain as the API, with a reverse proxy sending the API paths to the backend. The backend README explains why one domain keeps the login cookie and CSRF protection working, and lists the production settings.

## Author

**Tushar Singla**, final-year B.Tech IT student at Maharaja Agrasen Institute of Technology, Delhi.

- GitHub: [@TR1CK5T4R](https://github.com/TR1CK5T4R)
- LinkedIn: [tushar-singla-b8aaa027b](https://www.linkedin.com/in/tushar-singla-b8aaa027b)
