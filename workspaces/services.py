from django.contrib.auth.models import User
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.urls import reverse
from django.utils import timezone

from config.site_urls import build_site_url
from config import settings
from .models import MEMBER_ROLE_CHOICES, WorkspaceMember


def normalize_email(email):
    return email.strip().lower()


def get_invite_accept_url(member, request=None):
    path = reverse('workspaces:accept_invite', kwargs={'token': member.token})
    return build_site_url(path, request=request)


def send_workspace_invite_email(member, workspace, inviter, request=None):
    accept_url = get_invite_accept_url(member, request=request)
    role_label = dict(MEMBER_ROLE_CHOICES).get(member.role, member.role)
    context = {
        'workspace_name': workspace.name,
        'inviter_name': inviter.get_full_name() or inviter.email,
        'inviter_email': inviter.email,
        'role_label': role_label,
        'accept_url': accept_url,
        'site_name': 'ArcBook',
    }
    subject = render_to_string('workspaces/email/invite_subject.txt', context).strip()
    text_body = render_to_string('workspaces/email/invite_email.txt', context)
    html_body = render_to_string('workspaces/email/invite_email.html', context)

    message = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[member.email],
    )
    message.attach_alternative(html_body, 'text/html')
    message.send()


def create_workspace_invite(workspace, email, role, invited_by, request=None):
    email = normalize_email(email)
    if workspace.is_default:
        return None, 'Personal workspace cannot be shared.'
    if email == normalize_email(invited_by.email):
        return None, 'You cannot invite yourself.'
    if role not in ('editor', 'viewer'):
        return None, 'Invalid role selected.'

    existing = WorkspaceMember.objects.filter(workspace=workspace, email=email).first()
    if existing and existing.status in ('pending', 'accepted'):
        return None, 'This user has already been invited to this workspace.'

    invitee = User.objects.filter(email__iexact=email).first()
    if existing:
        existing.role = role
        existing.status = 'pending'
        existing.invited_by = invited_by
        existing.user = invitee
        existing.accepted_at = None
        existing.save()
        member = existing
    else:
        member = WorkspaceMember.objects.create(
            workspace=workspace,
            email=email,
            role=role,
            status='pending',
            invited_by=invited_by,
            user=invitee,
        )

    send_workspace_invite_email(member, workspace, invited_by, request=request)
    return member, None


def accept_workspace_invite(member, user):
    if member.status != 'pending':
        return False, 'This invitation is no longer valid.'
    if normalize_email(user.email) != normalize_email(member.email):
        return False, 'This invitation was sent to a different email address.'

    member.status = 'accepted'
    member.user = user
    member.accepted_at = timezone.now()
    member.save(update_fields=['status', 'user', 'accepted_at'])
    return True, None
