from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.models import User
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils import timezone

from .models import EmailVerificationOTP

OTP_LENGTH = 6
OTP_EXPIRY_MINUTES = 10
MAX_OTP_ATTEMPTS = 5


def generate_otp_code():
    import secrets

    return f'{secrets.randbelow(10 ** OTP_LENGTH):0{OTP_LENGTH}d}'


def create_or_refresh_otp(user):
    code = generate_otp_code()
    expires_at = timezone.now() + timezone.timedelta(minutes=OTP_EXPIRY_MINUTES)
    otp_record, _created = EmailVerificationOTP.objects.update_or_create(
        user=user,
        defaults={
            'otp_hash': make_password(code),
            'expires_at': expires_at,
            'attempts': 0,
        },
    )
    return code, otp_record


def send_signup_otp_email(user, code):
    subject = render_to_string('accounts/email/signup_otp_subject.txt', {'site_name': 'ArcBook'}).strip()
    text_body = render_to_string(
        'accounts/email/signup_otp_email.txt',
        {
            'user': user,
            'otp_code': code,
            'expiry_minutes': OTP_EXPIRY_MINUTES,
            'site_name': 'ArcBook',
        },
    )
    html_body = render_to_string(
        'accounts/email/signup_otp_email.html',
        {
            'user': user,
            'otp_code': code,
            'expiry_minutes': OTP_EXPIRY_MINUTES,
            'site_name': 'ArcBook',
        },
    )

    message = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[user.email],
    )
    message.attach_alternative(html_body, 'text/html')
    message.send()


def send_signup_otp(user):
    code, _otp_record = create_or_refresh_otp(user)
    send_signup_otp_email(user, code)
    return code


def verify_signup_otp(user, code):
    try:
        otp_record = user.email_verification
    except EmailVerificationOTP.DoesNotExist:
        return False, 'No verification code found. Please request a new one.'

    if timezone.now() >= otp_record.expires_at:
        return False, 'This verification code has expired. Please request a new one.'

    if otp_record.attempts >= MAX_OTP_ATTEMPTS:
        return False, 'Too many failed attempts. Please request a new code.'

    if not check_password(code.strip(), otp_record.otp_hash):
        otp_record.attempts += 1
        otp_record.save(update_fields=['attempts'])
        remaining = MAX_OTP_ATTEMPTS - otp_record.attempts
        if remaining <= 0:
            return False, 'Too many failed attempts. Please request a new code.'
        return False, f'Invalid verification code. {remaining} attempt(s) remaining.'

    otp_record.delete()
    return True, ''


def activate_verified_user(user):
    user.is_active = True
    user.save(update_fields=['is_active'])
