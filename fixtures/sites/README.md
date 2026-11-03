# Site fixtures

Small apps the Sites deploy tests build and run on real Docker (modules/sites/tests/deploy-*.heavy.test.ts), one per kind of project Vyre deploys:

| folder | what it is | how Vyre reads it |
|---|---|---|
| static | plain HTML | index.html in the root |
| vite | Vite + React, built to static files | package.json build script, no start |
| next | Next.js app router with an API route | package.json build and start |
| express | Node API on Express, reads GREETING and DATABASE_URL | package.json start, .env.example |
| dockerfile | its own Dockerfile on port 8080 | Dockerfile EXPOSE |
| fastapi | Python FastAPI under uvicorn | requirements.txt and main.py |
| railway | a Node app whose build and start come from railway.json | railway.json |
| flask-procfile | Flask started by a Procfile web line | Procfile |

The lock files were made with npm install --package-lock-only so the builds use npm ci.
