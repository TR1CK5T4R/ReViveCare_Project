// One chat completion from Groq with the official SDK (groq-sdk): the
// same provider, model and parameters as Django's langchain_groq.ChatGroq.
// Logs model, latency and status only, never message text (rule 11).

import Groq from 'groq-sdk';
import { aiConfig } from '../../config/ai.js';

const GROQ_API = 'https://api.groq.com';
