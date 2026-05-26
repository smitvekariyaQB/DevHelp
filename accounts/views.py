from django.contrib import messages
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.contrib.auth.views import LoginView, LogoutView
from django.shortcuts import redirect, render
from django.urls import reverse, reverse_lazy

from todos.services import ensure_default_lists

from .forms import CustomPasswordChangeForm, LoginForm, ProfileForm, RegisterForm


class UserLoginView(LoginView):
    template_name = 'accounts/login.html'
    authentication_form = LoginForm
    redirect_authenticated_user = True


class UserLogoutView(LogoutView):
    next_page = reverse_lazy('accounts:login')


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
