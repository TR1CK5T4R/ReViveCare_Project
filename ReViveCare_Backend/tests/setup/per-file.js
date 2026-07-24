// Runs in every test file: one pool on the test database for the whole file.

import 'dotenv/config';
import { afterAll, beforeAll } from 'vitest';
import { closePool, initPool } from '../../src/db/pool.js';
