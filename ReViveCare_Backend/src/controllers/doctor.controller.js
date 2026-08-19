// HTTP side of E06 POST /doctor_info: the doctor adds or updates a patient.
// No auth and no CSRF check, exactly like Django (preserved).

import { readDoctorInfoFields, upsertPatient } from '../services/doctor.service.js';
import { sendJson } from '../utils/djangoResponses.js';
import { pyJsonLoads } from '../utils/pythonJson.js';
