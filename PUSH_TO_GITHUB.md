# Push backend to GitHub (animeindiastore)

Run these in **PowerShell** or **Command Prompt** from the **backend** folder.

```powershell
cd c:\Users\RATAN\Desktop\animeweb\backend

git init
git add .
git commit -m "Initial commit: backend API"

git remote add origin https://github.com/Ratan7408/animeindiastore.git
git branch -M main
git push -u origin main
```

**Pushed:** All backend source (server.js, controllers, routes, models, .env.example, etc.)  
**Not pushed:** `node_modules/`, `.env`, `uploads/*` (in .gitignore)

If Git asks for login, use your GitHub username and a **Personal Access Token** (not password): GitHub → Settings → Developer settings → Personal access tokens → generate with `repo` scope.
