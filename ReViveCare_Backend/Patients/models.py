# patient/models.py
from django.db import models
from django.utils import timezone

class Patient(models.Model):
    name = models.CharField(max_length=100)
    email = models.EmailField(unique=True)   # 🔑 UNIQUE - This is the only authentication
    info = models.TextField(max_length=3000)
    created_at = models.DateTimeField(default=timezone.now)  # Changed from auto_now_add
    updated_at = models.DateTimeField(auto_now=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.name
    
    class Meta:
        ordering = ['-updated_at']
        verbose_name = 'Patient'
        verbose_name_plural = 'Patients'

class ExerciseSession(models.Model):
    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name='exercise_sessions')
    exercise_type = models.CharField(max_length=50)  # e.g., 'side-lateral-raise'
    start_time = models.DateTimeField(default=timezone.now)
    end_time = models.DateTimeField(null=True, blank=True)
    target_reps = models.IntegerField(default=12)
    completed_reps = models.IntegerField(default=0)
    excellent_reps = models.IntegerField(default=0)
    good_reps = models.IntegerField(default=0)
    partial_reps = models.IntegerField(default=0)
    accuracy_score = models.FloatField(default=0.0)  # Calculated percentage
    notes = models.TextField(blank=True, null=True)

    def __str__(self):
        return f"{self.patient.name} - {self.exercise_type} - {self.start_time.strftime('%Y-%m-%d %H:%M')}"

    class Meta:
        ordering = ['-start_time']
