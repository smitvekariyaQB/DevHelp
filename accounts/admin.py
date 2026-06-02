from django.contrib import admin

from .models import EmailVerificationOTP


@admin.register(EmailVerificationOTP)
class EmailVerificationOTPAdmin(admin.ModelAdmin):
    list_display = ('user', 'expires_at', 'attempts', 'created_at')
    search_fields = ('user__email', 'user__username')
    readonly_fields = ('otp_hash', 'created_at')
