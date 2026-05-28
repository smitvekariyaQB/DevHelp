DEFAULT_EXTENSION = 'py'

SUPPORTED_EXTENSIONS = [
    ('py', 'Python'),
    ('js', 'JavaScript'),
    ('jsx', 'JSX'),
    ('ts', 'TypeScript'),
    ('tsx', 'TSX'),
    ('css', 'CSS'),
    ('scss', 'SCSS'),
    ('html', 'HTML'),
    ('json', 'JSON'),
    ('md', 'Markdown'),
    ('sql', 'SQL'),
    ('sh', 'Shell'),
    ('yaml', 'YAML'),
    ('yml', 'YAML'),
    ('xml', 'XML'),
    ('java', 'Java'),
    ('go', 'Go'),
    ('rs', 'Rust'),
    ('rb', 'Ruby'),
    ('php', 'PHP'),
    ('c', 'C'),
    ('cpp', 'C++'),
    ('cs', 'C#'),
    ('swift', 'Swift'),
    ('kt', 'Kotlin'),
]

EXTENSION_LANGUAGES = {
    'py': 'python',
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'css': 'css',
    'scss': 'scss',
    'html': 'xml',
    'htm': 'xml',
    'json': 'json',
    'md': 'markdown',
    'sql': 'sql',
    'sh': 'bash',
    'bash': 'bash',
    'yaml': 'yaml',
    'yml': 'yaml',
    'xml': 'xml',
    'java': 'java',
    'go': 'go',
    'rs': 'rust',
    'rb': 'ruby',
    'php': 'php',
    'c': 'c',
    'cpp': 'cpp',
    'h': 'c',
    'cs': 'csharp',
    'swift': 'swift',
    'kt': 'kotlin',
}

DEFAULT_CONTENT_BY_EXT = {
    'py': '# Welcome to the Code editor\n\ndef main():\n    print("Hello, ArcBook!")\n\n\nif __name__ == "__main__":\n    main()\n',
    'js': '// Welcome to the Code editor\n\nfunction greet(name) {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greet("ArcBook"));\n',
    'jsx': '// Welcome to the Code editor\n\nexport default function App() {\n  return <h1>Hello, ArcBook!</h1>;\n}\n',
    'ts': '// Welcome to the Code editor\n\nfunction greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greet("ArcBook"));\n',
    'tsx': '// Welcome to the Code editor\n\nexport default function App(): JSX.Element {\n  return <h1>Hello, ArcBook!</h1>;\n}\n',
    'css': '/* Welcome to the Code editor */\n\nbody {\n  font-family: system-ui, sans-serif;\n  margin: 0;\n  padding: 2rem;\n}\n',
    'scss': '/* Welcome to the Code editor */\n\n$accent: #007aff;\n\nbody {\n  color: $accent;\n}\n',
    'html': '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <title>ArcBook</title>\n</head>\n<body>\n  <h1>Hello, ArcBook!</h1>\n</body>\n</html>\n',
    'json': '{\n  "name": "ArcBook",\n  "language": "json",\n  "message": "Hello, world!"\n}\n',
    'md': '# Welcome to the Code editor\n\nWrite and save code files from the sidebar.\n',
    'sql': '-- Welcome to the Code editor\n\nSELECT id, title, updated_at\nFROM documents\nORDER BY updated_at DESC;\n',
    'sh': '#!/bin/bash\n# Welcome to the Code editor\n\necho "Hello, ArcBook!"\n',
    'yaml': '# Welcome to the Code editor\n\nname: ArcBook\nversion: 1.0.0\nfeatures:\n  - syntax highlighting\n  - search\n  - save\n',
    'yml': '# Welcome to the Code editor\n\nname: ArcBook\nversion: 1.0.0\n',
    'xml': '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  <message>Hello, ArcBook!</message>\n</root>\n',
    'java': 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, ArcBook!");\n    }\n}\n',
    'go': 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello, ArcBook!")\n}\n',
    'rs': 'fn main() {\n    println!("Hello, ArcBook!");\n}\n',
    'rb': '# Welcome to the Code editor\n\nputs "Hello, ArcBook!"\n',
    'php': '<?php\n// Welcome to the Code editor\n\necho "Hello, ArcBook!";\n',
    'c': '#include <stdio.h>\n\nint main(void) {\n    printf("Hello, ArcBook!\\n");\n    return 0;\n}\n',
    'cpp': '#include <iostream>\n\nint main() {\n    std::cout << "Hello, ArcBook!" << std::endl;\n    return 0;\n}\n',
    'cs': 'using System;\n\nclass Program {\n    static void Main() {\n        Console.WriteLine("Hello, ArcBook!");\n    }\n}\n',
    'swift': 'print("Hello, ArcBook!")\n',
    'kt': 'fun main() {\n    println("Hello, ArcBook!")\n}\n',
}


def default_title_for_extension(ext):
    ext = (ext or DEFAULT_EXTENSION).lower().lstrip('.')
    return f'Untitled.{ext}'


def default_content_for_extension(ext):
    ext = (ext or '').lower().lstrip('.')
    if not ext or ext not in EXTENSION_LANGUAGES:
        return ''
    return DEFAULT_CONTENT_BY_EXT.get(ext, '')


def extension_from_title(title):
    name = (title or '').strip()
    if '.' not in name:
        return ''
    return name.rsplit('.', 1)[-1].lower()
