from django.conf import settings
from django.db import models


class EmailVerificationOTP(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='email_verification',
    )
    otp_hash = models.CharField(max_length=128)
    expires_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'email verification OTP'
        verbose_name_plural = 'email verification OTPs'

    def __str__(self):
        return f'OTP for {self.user.email}'
