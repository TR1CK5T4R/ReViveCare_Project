// Builds the real app with test configuration. Only TEST_DATABASE_URL comes
// from the environment; everything else is fixed here so tests don't depend
// on a developer's .env.

import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { createLogger } from '../../src/utils/logger.js';
