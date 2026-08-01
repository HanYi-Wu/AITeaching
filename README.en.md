# SolEdu

SolEdu is an AI-assisted K12 education automation platform for question banks, exam composition and export, knowledge graphs, learning analytics, remediation, and role-based school workflows. It provides a FastAPI backend, a React/Vite web interface, and a Tauri desktop application for Windows.

**Languages:** English | [简体中文](README.md)

## Main capabilities

- Compose exams from YAML question banks and templates, then export student/teacher PDF or Word files.
- Maintain question banks, educational diagrams, templates, and knowledge graphs.
- Import scores and generate class, student, and knowledge-point analysis and remediation drafts.
- Run administrator, school, teacher, and student workflows with an integrated AI assistant.

## Local development

Prerequisites: [Pixi](https://pixi.sh/latest/), Git, Visual Studio Build Tools on Windows, and a TeX distribution for PDF export.

```powershell
pixi install
pixi run bootstrap
pixi run dev
```

Focused commands:

```powershell
pixi run dev-backend
cd web
npm run build
npm run preview -- --host 0.0.0.0 --port 5173 --strictPort
pixi run test
pixi run test-web
pixi run typecheck
```

## Public/FRP testing

Expose only Vite's `5173` port through FRP. Keep FastAPI on `127.0.0.1:8000` and let Vite proxy same-origin `/api` requests. Enable the public boundary before launching the backend:

```powershell
$env:SOLAIRE_PUBLIC_MODE = "1"
$env:SOLAIRE_PROJECT_ROOT = "G:\path\to\content"
$env:SOLAIRE_BIND_PROJECT_FROM_ENV = "1"
$env:SOLAIRE_CONTROL_TOKEN = "a-long-random-local-secret"
$env:SOLAIRE_PUBLIC_HOSTS = "your-exact-host.frp-van.com"
pixi run dev-backend
cd web
npm run build
npm run preview -- --host 0.0.0.0 --port 5173 --strictPort
```

Remote users must sign in. Use the built preview server for public tests instead of exposing Vite's source-serving/HMR development server. `SOLAIRE_PUBLIC_HOSTS` must contain the exact FRP host; do not trust an entire shared domain. Host-control operations such as selecting local directories, installing system tools, running local analysis scripts, or opening files on the host additionally require an administrator session and the control token. Never embed that token in browser assets or forward port `8000` publicly.

## License

This repository uses the [custom noncommercial license](LICENSE), not a standard open-source license. Noncommercial viewing, study, copying, modification, and use are permitted subject to attribution. Commercial use, deployment, or distribution requires prior written permission from the author.

Security reports: [hectorzhang4253@gmail.com](mailto:hectorzhang4253@gmail.com).
