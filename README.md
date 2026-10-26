# ReViveCare

A post-surgery rehabilitation assistant, built as a personal project by [Tushar Singla](#author), a final-year B.Tech IT student.

After an operation, patients go home with questions and exercises but no one to ask. ReViveCare gives them:

- **An AI recovery assistant** that answers in English or Hindi using the notes their doctor added, and alerts the doctor by email (and optionally a phone call) when a message sounds serious.
- **Camera-tracked exercises:** the browser follows the patient's arms with MediaPipe, counts reps, grades their form and saves each set.
- **Simple doctor tools** to add patients and their medical notes.

> ReViveCare is a student project, not a commercial or medical product. Please use only made-up data.

## Try it

Log in as a patient with one of these demo accounts (made-up data; any password works, because login checks only the email in this version):

| Email                           | Password   |
| ------------------------------- | ---------- |
| `demo.knee@revivecare.test`     | `demo1234` |
| `demo.hip@revivecare.test`      | `demo1234` |
| `demo.shoulder@revivecare.test` | `demo1234` |

## Repository layout

| Folder                                        | What it is                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [`ReViveCare_Frontend/`](ReViveCare_Frontend) | React 19 + Vite app: patient and doctor screens, AI chat, in-browser pose tracking           |
| [`ReViveCare_Backend/`](ReViveCare_Backend)   | Node.js 22 + Express 5 + PostgreSQL API: sessions, AI chat, doctor alerts, exercise history  |
| [`parity-tools/`](parity-tools)               | Scripts I used to check the Node.js backend behaves exactly like the original Django version |

Each folder's README has its setup steps. In short: start PostgreSQL, then `npm install && npm run db:migrate && npm run db:demo && npm run dev` in the backend, and `npm install && npm run dev` in the frontend; open http://localhost:5173.

## The story behind the backend

I first built the backend in Django. To learn Node.js and PostgreSQL properly, I rewrote it as a Node.js + Express API with raw SQL, keeping every endpoint and rule the frontend relies on. To prove nothing changed, I wrote a parity suite that sends the same 116 request scenarios to both backends and compares the answers, alongside 917 unit and integration tests.

## Author

**Tushar Singla**, final-year B.Tech IT student at Maharaja Agrasen Institute of Technology, Delhi.

- GitHub: [@TR1CK5T4R](https://github.com/TR1CK5T4R)
- LinkedIn: [tushar-singla-b8aaa027b](https://www.linkedin.com/in/tushar-singla-b8aaa027b)
