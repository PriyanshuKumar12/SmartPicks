# Deploying SmartPicks to Render

This guide walks through deploying SmartPicks: backend (Node + Python) and
frontend (Vite static build) on Render's free tier, with the 176 MB
`similarity.pkl` hosted on Hugging Face Hub.

You will end up with two free `*.onrender.com` URLs:
- `https://smartpicks-frontend.onrender.com` (the app)
- `https://smartpicks-backend.onrender.com` (the API)

---

## 1. Upload `similarity.pkl` to Hugging Face

1. Create a free account at https://huggingface.co/join.
2. Create a new **Model** repo (Profile → New → Model). Name it e.g.
   `smartpicks-similarity`. Visibility: **Public** (private also works but
   needs a token — public is simpler).
3. On the repo page, click **Files** → **Add file** → **Upload files**, and
   upload `backend/similarity.pkl` from your local machine. (The file is
   `.gitignore`d in this project and is ~176 MB — the upload will take a
   few minutes.)
4. Once uploaded, click the file, then the **download icon** next to its
   name. Copy that URL — it looks like:

   ```
   https://huggingface.co/<your-username>/smartpicks-similarity/resolve/main/similarity.pkl
   ```

   This is your `SIMILARITY_URL`. Keep it handy for step 4.

## 2. Push the repo to GitHub

```powershell
git add render.yaml DEPLOY.md backend/server.js backend/recommender_service.py backend/package.json
git commit -m "Add Render deployment blueprint and PKL download-on-startup"
git remote add origin https://github.com/<you>/SmartPicks.git   # if not already
git push -u origin main
```

(`similarity.pkl` is already gitignored, so it stays out of the repo.)

## 3. Create the Render services from the blueprint

1. Sign in to https://dashboard.render.com (GitHub login works).
2. Click **New +** → **Blueprint**.
3. Connect your GitHub account and select the `SmartPicks` repo.
4. Render reads `render.yaml` and proposes two services:
   - `smartpicks-backend` (web service, Node)
   - `smartpicks-frontend` (static site)
5. Click **Apply**.

The first build will fail on the backend because the secret env vars aren't
set yet — that's expected. Fix in the next step.

## 4. Set the backend env vars

In Render dashboard → `smartpicks-backend` → **Environment** tab, set:

| Key              | Value                                                                      |
| ---------------- | -------------------------------------------------------------------------- |
| `TMDB_API_KEY`   | Your TMDB v3 API key (https://www.themoviedb.org/settings/api)             |
| `SIMILARITY_URL` | The Hugging Face URL from step 1                                           |
| `FRONTEND_URL`   | `https://smartpicks-frontend.onrender.com` (your frontend URL from step 3) |

Click **Save Changes** — this triggers a redeploy. On the first boot the
service will download `similarity.pkl` from Hugging Face (~1–3 min on
Render's free tier) before serving requests. Subsequent restarts re-download
because Render's free disk is ephemeral; if you upgrade to a paid plan you
can attach a persistent disk to skip this.

Watch the logs for:
```
[recommender-service] Downloading similarity.pkl from ...
[recommender-service] Downloaded similarity.pkl (176 MB).
[recommender-service] Ready. NNNN movies loaded.
Recommender service ready (NNNN movies).
Server is running on http://localhost:5001
```

## 5. Set the frontend env var

In Render dashboard → `smartpicks-frontend` → **Environment** tab, set:

| Key             | Value                                       |
| --------------- | ------------------------------------------- |
| `VITE_API_URL`  | `https://smartpicks-backend.onrender.com`   |

(Use the actual URL Render assigned your backend service — visible at the
top of the backend's dashboard page.)

Click **Save Changes**. Render will rebuild the static site, baking the
backend URL into the JS bundle.

## 6. Verify

1. Visit `https://smartpicks-frontend.onrender.com` — the SmartPicks UI loads.
2. Search/select a movie — recommendations should appear.
3. Sanity-check the backend directly:
   - `https://smartpicks-backend.onrender.com/api/health` →
     `{"status":"Server is running","recommenderServiceReady":true,...}`

---

## Notes about the free tier

- **Cold starts.** Render's free web services sleep after ~15 minutes of
  inactivity. The first request after a sleep wakes the service, which then
  re-downloads `similarity.pkl` and re-loads it into memory. Expect a
  ~60–120 s wait on cold starts. Move to a paid plan ($7/mo) for always-on.
- **RAM.** The free Web Service has 512 MB RAM. `similarity.pkl` is 176 MB
  on disk and expands further in Python (numpy float arrays). If you hit
  out-of-memory errors in the logs, upgrade to the next plan up — the
  Starter tier at 512 MB → 2 GB resolves it.
- **Build minutes / bandwidth.** Free tier limits apply; for a personal
  project they are typically not a concern.

## Local development still works

None of these changes break local dev. `npm run dev` in `frontend/` and
`node server.js` in `backend/` work as before — `FRONTEND_URL` defaults to
`http://localhost:3000` and `similarity.pkl` is read directly from disk
when present (only downloaded when missing).
