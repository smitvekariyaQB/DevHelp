from urllib.parse import urlparse

from django.conf import settings
from django.contrib import messages
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.contrib.auth.views import (
    INTERNAL_RESET_SESSION_TOKEN,
    LoginView,
    LogoutView,
    PasswordResetCompleteView,
    PasswordResetConfirmView,
    PasswordResetDoneView,
    PasswordResetView,
)
from django.core.exceptions import ImproperlyConfigured
from django.shortcuts import redirect, render
from django.urls import reverse, reverse_lazy

from todos.services import ensure_default_lists

from .forms import (
    CustomPasswordChangeForm,
    CustomSetPasswordForm,
    LoginForm,
    PasswordResetRequestForm,
    ProfileForm,
    RegisterForm,
)


class UserLoginView(LoginView):
    template_name = 'accounts/login.html'
    authentication_form = LoginForm
    redirect_authenticated_user = True


class UserLogoutView(LogoutView):
    next_page = reverse_lazy('accounts:login')


class UserPasswordResetView(PasswordResetView):
    template_name = 'accounts/password_reset_form.html'
    form_class = PasswordResetRequestForm
    email_template_name = 'accounts/email/password_reset_email.txt'
    html_email_template_name = 'accounts/email/password_reset_email.html'
    subject_template_name = 'accounts/email/password_reset_subject.txt'
    success_url = reverse_lazy('accounts:password_reset_done')
    extra_email_context = {'site_name': 'ArcBook'}

    def form_valid(self, form):
        site_url = getattr(settings, 'SITE_URL', '').strip()
        parsed = urlparse(site_url) if site_url else None

        opts = {
            'use_https': (parsed.scheme == 'https') if parsed else self.request.is_secure(),
            'token_generator': self.token_generator,
            'from_email': self.from_email,
            'email_template_name': self.email_template_name,
            'subject_template_name': self.subject_template_name,
            'request': self.request,
            'html_email_template_name': self.html_email_template_name,
            'extra_email_context': self.extra_email_context,
        }
        if parsed and parsed.netloc:
            opts['domain_override'] = parsed.netloc

        form.save(**opts)
        return super(PasswordResetView, self).form_valid(form)


class UserPasswordResetDoneView(PasswordResetDoneView):
    template_name = 'accounts/password_reset_done.html'


class UserPasswordResetConfirmView(PasswordResetConfirmView):
    template_name = 'accounts/password_reset_confirm.html'
    form_class = CustomSetPasswordForm
    success_url = reverse_lazy('accounts:password_reset_complete')

    def dispatch(self, request, *args, **kwargs):
        if 'uidb64' not in kwargs or 'token' not in kwargs:
            raise ImproperlyConfigured(
                "The URL path must contain 'uidb64' and 'token' parameters."
            )

        self.validlink = False
        self.user = self.get_user(kwargs['uidb64'])

        if self.user is not None:
            token = kwargs['token']
            if token == self.reset_url_token:
                session_token = request.session.get(INTERNAL_RESET_SESSION_TOKEN)
                if self.token_generator.check_token(self.user, session_token):
                    self.validlink = True
            elif self.token_generator.check_token(self.user, token):
                request.session[INTERNAL_RESET_SESSION_TOKEN] = token
                self.validlink = True

        if self.validlink:
            return super(PasswordResetConfirmView, self).dispatch(request, *args, **kwargs)

        return self.render_to_response(self.get_context_data())


class UserPasswordResetCompleteView(PasswordResetCompleteView):
    template_name = 'accounts/password_reset_complete.html'


def register(request):
    if request.user.is_authenticated:
        return redirect('todos:index')

    if request.method == 'POST':
        form = RegisterForm(request.POST)
        if form.is_valid():
            user = form.save()
            ensure_default_lists(user)
            login(request, user)
            messages.success(request, 'Welcome! Your account is ready.')
            return redirect('todos:index')
    else:
        form = RegisterForm()

    return render(request, 'accounts/register.html', {'form': form})


@login_required
def profile(request):
    profile_form = ProfileForm(instance=request.user)
    password_form = CustomPasswordChangeForm(request.user)

    if request.method == 'POST':
        form_type = request.POST.get('form_type')
        if form_type == 'password':
            password_form = CustomPasswordChangeForm(request.user, request.POST)
            if password_form.is_valid():
                password_form.save()
                messages.success(request, 'Password changed successfully.')
                return redirect(f'{reverse("accounts:profile")}#password')
        else:
            profile_form = ProfileForm(request.POST, instance=request.user)
            if profile_form.is_valid():
                profile_form.save()
                messages.success(request, 'Profile updated.')
                return redirect('accounts:profile')

    return render(
        request,
        'accounts/profile.html',
        {
            'profile_form': profile_form,
            'password_form': password_form,
        },
    )


@login_required
def change_password(request):
    return redirect(f'{reverse("accounts:profile")}#password')
