# SmartPicks

🎬 **Live demo:** https://smartpicks-frontend.onrender.com

Content-based movie recommender. Pick a movie you like, get 20 similar ones
back with posters, overviews, and genres pulled from TMDB.

> The free Render instance sleeps after ~15 min of inactivity. The first
> request after a sleep can take 60–120 s while the container boots and the
> 176 MB similarity matrix loads into memory. Subsequent requests are fast.

## How it works

| Layer | Stack |
|-------|-------|
| Frontend | React 19 + Vite, deployed as a Render static site |
| Backend API | Node + Express, deployed as a Render web service |
| Recommender | Python + Flask (NumPy cosine similarity), supervised as a child process by the Node backend |
| Movie metadata | TMDB v3 API, cached in-process |
| Model storage | `similarity.pkl` (176 MB) hosted on Hugging Face Hub, downloaded on first boot |

The Node backend spawns the Python Flask service once and proxies
`/api/recommend` requests to it, so the 176 MB similarity matrix is loaded
into RAM exactly once per instance lifetime instead of per request.

## Local development

```bash
# 1. Backend
cd backend
npm install
pip install -r ../requirements.txt
cp .env.example .env             # add TMDB_API_KEY
# Drop similarity.pkl into backend/ (or set SIMILARITY_URL in .env)
node server.js                   # http://localhost:5001

# 2. Frontend (new terminal)
cd frontend
npm install
npm run dev                      # http://localhost:3000
```

## Deployment

This repo deploys to Render via `render.yaml` (Blueprint). See
[`DEPLOY.md`](./DEPLOY.md) for the full step-by-step.
