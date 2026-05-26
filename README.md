# ArcBook

Personal workspace for notes, tasks, and tables — Django web app with macOS-style UI.

## Features

- User registration, login, logout
- Profile and change password
- **To Do** (MS To-Do style): lists (My Day, Important, Tasks), add/complete/star/delete tasks
- **Notes**: rich text notes with colors and autosave
- **Tables**: spreadsheet-style tables
- **JSON**: VS Code-style file list with formatter, search, copy, and minify

## Setup

```bash
cd /home/smit/Projects/DevHelpTool
uv venv
uv pip install -r requirements.txt
.venv/bin/python manage.py migrate
.venv/bin/python manage.py createsuperuser   # optional
.venv/bin/python manage.py runserver
```

Open http://127.0.0.1:8000/

## Project structure

- `accounts/` — auth, profile, password
- `todos/` — todo lists and tasks
- `templates/` — HTML (mac-style shell)
- `static/` — CSS and JS
