from django.contrib.auth.models import User
from django.core import mail
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from notes.models import Note
from workspaces.models import Workspace, WorkspaceMember
from workspaces.permissions import get_accessible_workspaces, resolve_workspace
from workspaces.services import accept_workspace_invite, create_workspace_invite, get_invite_accept_url


class WorkspaceSharingTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(
            username='owner@example.com',
            email='owner@example.com',
            password='pass12345',
        )
        self.editor = User.objects.create_user(
            username='editor@example.com',
            email='editor@example.com',
            password='pass12345',
        )
        self.viewer = User.objects.create_user(
            username='viewer@example.com',
            email='viewer@example.com',
            password='pass12345',
        )
        self.workspace = Workspace.objects.create(
            user=self.owner,
            name='Team Workspace',
            is_default=False,
            enabled_tools=['notes', 'todos'],
        )

    def test_owner_can_invite_editor(self):
        member, error = create_workspace_invite(
            self.workspace,
            'editor@example.com',
            'editor',
            self.owner,
        )
        self.assertIsNone(error)
        self.assertEqual(member.status, 'pending')
        self.assertEqual(member.role, 'editor')
        self.assertEqual(len(mail.outbox), 1)

    @override_settings(SITE_URL='http://192.168.7.200:8001')
    def test_invite_email_uses_site_url(self):
        member, _ = create_workspace_invite(
            self.workspace,
            'editor@example.com',
            'editor',
            self.owner,
        )
        accept_url = get_invite_accept_url(member)
        self.assertTrue(accept_url.startswith('http://192.168.7.200:8001/'))
        self.assertIn(str(member.token), accept_url)
        self.assertIn('http://192.168.7.200:8001', mail.outbox[0].body)

    def test_personal_workspace_cannot_be_shared(self):
        personal = self.owner.workspaces.get(is_default=True)
        member, error = create_workspace_invite(
            personal,
            'editor@example.com',
            'editor',
            self.owner,
        )
        self.assertIsNone(member)
        self.assertIn('Personal workspace', error)

    def test_accept_invite_grants_access(self):
        member, _ = create_workspace_invite(
            self.workspace,
            'editor@example.com',
            'editor',
            self.owner,
        )
        ok, error = accept_workspace_invite(member, self.editor)
        self.assertTrue(ok)
        self.assertIsNone(error)
        member.refresh_from_db()
        self.assertEqual(member.status, 'accepted')
        self.assertEqual(member.user, self.editor)

        workspace, role = resolve_workspace(self.editor, self.workspace.id)
        self.assertEqual(role, 'editor')
        self.assertEqual(workspace, self.workspace)

    def test_wrong_email_cannot_accept_invite(self):
        member, _ = create_workspace_invite(
            self.workspace,
            'editor@example.com',
            'editor',
            self.owner,
        )
        ok, error = accept_workspace_invite(member, self.viewer)
        self.assertFalse(ok)
        self.assertIn('different email', error)

    def test_shared_workspace_in_accessible_list(self):
        WorkspaceMember.objects.create(
            workspace=self.workspace,
            user=self.viewer,
            email='viewer@example.com',
            role='viewer',
            status='accepted',
            invited_by=self.owner,
        )
        accessible = get_accessible_workspaces(self.viewer)
        self.assertIn(self.workspace, accessible)

    def test_non_owner_cannot_share(self):
        client = Client()
        client.force_login(self.editor)
        response = client.post(
            reverse('workspaces:share_invite', kwargs={'pk': self.workspace.pk}),
            {'email': 'viewer@example.com', 'role': 'viewer'},
        )
        self.assertEqual(response.status_code, 404)

    def test_viewer_can_read_notes_but_not_create(self):
        Note.objects.create(
            user=self.owner,
            workspace=self.workspace,
            title='Shared note',
        )
        WorkspaceMember.objects.create(
            workspace=self.workspace,
            user=self.viewer,
            email='viewer@example.com',
            role='viewer',
            status='accepted',
            invited_by=self.owner,
        )

        client = Client()
        client.force_login(self.viewer)
        index_url = reverse('notes:index') + f'?w={self.workspace.id}'
        response = client.get(index_url)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Shared note')

        create_response = client.post(reverse('notes:create') + f'?w={self.workspace.id}')
        self.assertEqual(create_response.status_code, 403)

    def test_editor_can_create_notes(self):
        WorkspaceMember.objects.create(
            workspace=self.workspace,
            user=self.editor,
            email='editor@example.com',
            role='editor',
            status='accepted',
            invited_by=self.owner,
        )

        client = Client()
        client.force_login(self.editor)
        create_response = client.post(reverse('notes:create') + f'?w={self.workspace.id}')
        self.assertEqual(create_response.status_code, 302)
        self.assertEqual(Note.objects.filter(workspace=self.workspace).count(), 1)

    def test_shared_workspace_in_settings_list_view_only(self):
        WorkspaceMember.objects.create(
            workspace=self.workspace,
            user=self.viewer,
            email='viewer@example.com',
            role='viewer',
            status='accepted',
            invited_by=self.owner,
        )
        client = Client()
        client.force_login(self.viewer)
        response = client.get(reverse('workspaces:list'))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Team Workspace')
        self.assertContains(response, 'Shared with you')
        self.assertContains(response, self.owner.email)
        self.assertContains(response, 'View')
        self.assertNotContains(response, 'Edit')

    def test_shared_user_can_view_workspace_details(self):
        WorkspaceMember.objects.create(
            workspace=self.workspace,
            user=self.viewer,
            email='viewer@example.com',
            role='viewer',
            status='accepted',
            invited_by=self.owner,
        )
        client = Client()
        client.force_login(self.viewer)
        response = client.get(reverse('workspaces:view', kwargs={'pk': self.workspace.pk}))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Team Workspace')
        self.assertContains(response, self.owner.email)
        self.assertContains(response, 'Owner · Active')

    def test_owner_sees_self_in_share_section(self):
        client = Client()
        client.force_login(self.owner)
        response = client.get(reverse('workspaces:edit', kwargs={'pk': self.workspace.pk}))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Share workspace')
        self.assertContains(response, 'Owner · Active')
        self.assertContains(response, self.owner.email)

    def test_accept_invite_view_redirects_when_logged_in(self):
        member, _ = create_workspace_invite(
            self.workspace,
            'editor@example.com',
            'editor',
            self.owner,
        )
        client = Client()
        client.force_login(self.editor)
        response = client.get(reverse('workspaces:accept_invite', kwargs={'token': member.token}))
        self.assertEqual(response.status_code, 302)
        member.refresh_from_db()
        self.assertEqual(member.status, 'accepted')

    def test_activity_logged_for_shared_workspace(self):
        WorkspaceMember.objects.create(
            workspace=self.workspace,
            user=self.editor,
            email='editor@example.com',
            role='editor',
            status='accepted',
            invited_by=self.owner,
        )
        from workspaces.activity import log_activity

        log_activity(
            self.workspace,
            self.editor,
            'notes',
            'create',
            'Test note',
            'Created note "Test note"',
            object_id=1,
        )
        client = Client()
        client.force_login(self.owner)
        response = client.get(
            reverse('workspaces:activity_list') + f'?w={self.workspace.id}&tool=notes',
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data['items']), 1)
        self.assertIn('editor@example.com', data['items'][0]['display_name'])
        self.assertIn('Created note', data['items'][0]['details'])

    def test_activity_filtered_by_object_id(self):
        WorkspaceMember.objects.create(
            workspace=self.workspace,
            user=self.editor,
            email='editor@example.com',
            role='editor',
            status='accepted',
            invited_by=self.owner,
        )
        from workspaces.activity import log_activity

        log_activity(
            self.workspace,
            self.editor,
            'notes',
            'create',
            'Note A',
            'Created note "Note A"',
            object_id=1,
        )
        log_activity(
            self.workspace,
            self.editor,
            'notes',
            'create',
            'Note B',
            'Created note "Note B"',
            object_id=2,
        )
        client = Client()
        client.force_login(self.owner)
        response = client.get(
            reverse('workspaces:activity_list')
            + f'?w={self.workspace.id}&tool=notes&object_id=1',
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data['items']), 1)
        self.assertIn('Note A', data['items'][0]['details'])

    def test_activity_not_logged_without_collaborators(self):
        from workspaces.activity import log_activity
        from workspaces.models import WorkspaceActivity

        result = log_activity(
            self.workspace,
            self.owner,
            'notes',
            'create',
            'Solo note',
            'Created note "Solo note"',
            object_id=1,
        )
        self.assertIsNone(result)
        self.assertEqual(WorkspaceActivity.objects.count(), 0)
