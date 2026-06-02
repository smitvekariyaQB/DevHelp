from django import forms
from django.contrib.auth import authenticate
from django.contrib.auth.forms import (
    AuthenticationForm,
    PasswordChangeForm,
    PasswordResetForm,
    SetPasswordForm,
    UserCreationForm,
)
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError


_input = {'class': 'mac-input'}


def normalize_email(email):
    return (email or '').strip().lower()


class RegisterForm(UserCreationForm):
    first_name = forms.CharField(
        required=True,
        max_length=150,
        widget=forms.TextInput(
            attrs={
                **_input,
                'placeholder': 'First name',
                'autocomplete': 'given-name',
            },
        ),
    )
    last_name = forms.CharField(
        required=True,
        max_length=150,
        widget=forms.TextInput(
            attrs={
                **_input,
                'placeholder': 'Last name',
                'autocomplete': 'family-name',
            },
        ),
    )
    email = forms.EmailField(
        required=True,
        widget=forms.EmailInput(
            attrs={
                **_input,
                'placeholder': 'Email',
                'autocomplete': 'email',
            },
        ),
    )

    class Meta:
        model = User
        fields = ('first_name', 'last_name', 'email', 'password1', 'password2')

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields.pop('username', None)
        for name in ('password1', 'password2'):
            self.fields[name].widget.attrs.update(_input)

    def clean_first_name(self):
        return self.cleaned_data['first_name'].strip()

    def clean_last_name(self):
        return self.cleaned_data['last_name'].strip()

    def clean_email(self):
        email = normalize_email(self.cleaned_data['email'])
        if User.objects.filter(email__iexact=email, is_active=True).exists():
            raise forms.ValidationError('An account with this email already exists.')
        if User.objects.filter(username__iexact=email, is_active=True).exists():
            raise forms.ValidationError('An account with this email already exists.')
        return email

    def save(self, commit=True):
        user = super().save(commit=False)
        email = self.cleaned_data['email']
        user.email = email
        user.username = email
        user.first_name = self.cleaned_data['first_name']
        user.last_name = self.cleaned_data['last_name']
        if commit:
            user.save()
        return user


class ProfileForm(forms.ModelForm):
    class Meta:
        model = User
        fields = ('email', 'first_name', 'last_name')
        widgets = {
            'email': forms.EmailInput(attrs={**_input, 'autocomplete': 'email'}),
            'first_name': forms.TextInput(attrs=_input),
            'last_name': forms.TextInput(attrs=_input),
        }

    def clean_email(self):
        email = normalize_email(self.cleaned_data['email'])
        if User.objects.filter(email__iexact=email).exclude(pk=self.instance.pk).exists():
            raise forms.ValidationError('An account with this email already exists.')
        if User.objects.filter(username__iexact=email).exclude(pk=self.instance.pk).exists():
            raise forms.ValidationError('An account with this email already exists.')
        return email

    def save(self, commit=True):
        user = super().save(commit=False)
        user.username = user.email
        if commit:
            user.save()
        return user


class LoginForm(AuthenticationForm):
    error_messages = {
        'invalid_login': (
            'Please enter a correct email and password. '
            'Note that both fields may be case-sensitive.'
        ),
        'inactive': 'Please verify your email before signing in.',
    }

    email = forms.EmailField(
        label='Email',
        widget=forms.EmailInput(
            attrs={
                'placeholder': 'Email',
                'autocomplete': 'email',
                'autocapitalize': 'off',
                'spellcheck': 'false',
            },
        ),
    )

    def __init__(self, request=None, *args, **kwargs):
        super().__init__(request, *args, **kwargs)
        self.fields.pop('username', None)

    def clean(self):
        email = normalize_email(self.cleaned_data.get('email'))
        password = self.cleaned_data.get('password')

        if email is None or not password:
            raise self.get_invalid_login_error()

        self.user_cache = None
        user = User.objects.filter(email__iexact=email).first()
        if user is not None:
            self.user_cache = authenticate(
                self.request,
                username=user.get_username(),
                password=password,
            )

        if self.user_cache is None:
            raise self.get_invalid_login_error()

        self.confirm_login_allowed(self.user_cache)
        return self.cleaned_data

    def get_invalid_login_error(self):
        return ValidationError(
            self.error_messages['invalid_login'],
            code='invalid_login',
        )


class CustomPasswordChangeForm(PasswordChangeForm):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field in self.fields.values():
            field.widget.attrs.update(_input)


class PasswordResetRequestForm(PasswordResetForm):
    email = forms.EmailField(
        label='Email',
        max_length=254,
        widget=forms.EmailInput(
            attrs={
                **_input,
                'placeholder': 'Email address',
                'autocomplete': 'email',
            },
        ),
    )


class CustomSetPasswordForm(SetPasswordForm):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field in self.fields.values():
            field.widget.attrs.update(_input)


class VerifyOTPForm(forms.Form):
    otp = forms.CharField(
        label='Verification code',
        min_length=6,
        max_length=6,
        widget=forms.TextInput(
            attrs={
                **_input,
                'placeholder': '6-digit code',
                'autocomplete': 'one-time-code',
                'inputmode': 'numeric',
                'pattern': '[0-9]{6}',
            },
        ),
    )

    def clean_otp(self):
        otp = self.cleaned_data['otp'].strip()
        if not otp.isdigit() or len(otp) != 6:
            raise forms.ValidationError('Enter the 6-digit code from your email.')
        return otp

