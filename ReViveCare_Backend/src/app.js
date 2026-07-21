// createApp(): builds the Express app (no listen), so tests can drive it with
// supertest and server.js can serve it. Middleware order matters; each step
// says why it sits where it does.
