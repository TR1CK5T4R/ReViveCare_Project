// HTTP side of E06 POST /doctor_info: the doctor adds or updates a patient.
// No auth and no CSRF check, exactly like Django (preserved).

import { readDoctorInfoFields, upsertPatient } from '../services/doctor.service.js';
import { sendJson } from '../utils/djangoResponses.js';
import { pyJsonLoads } from '../utils/pythonJson.js';

export function createDoctorController() {
  return {
    /**
     * Django parity: Doctor/views.py:doctor_info. `json.loads(request.body)`
     * whatever the Content-Type; any Python exception is a 500 (the error
     * handler), and nothing is written.
     */
    async doctorInfo(req, res) {
      // express.raw leaves req.body undefined when the request has no body.
      const data = pyJsonLoads(req.body ?? Buffer.alloc(0));
      const { created, patientId } = await upsertPatient(readDoctorInfoFields(data));
      req.log.info({ patientId, created }, 'doctor_info saved patient');
      sendJson(res, 200, { success: true, created });
    },
  };
}
