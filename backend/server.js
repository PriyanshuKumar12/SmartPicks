const express = require('express');
const cors = require('cors');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const axiosRetry = require('axios-retry').default;
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;

// ---------------------------------------------------------------------------
// Python interpreter resolution (used to launch the recommender service).
// Priority: PYTHON_PATH/PYTHON env var, `py` launcher, `python3`, `python`,
// then a filesystem scan of the standard Windows install roots (handles a
// freshly-installed Python that isn't on an already-open shell's PATH yet).
// ---------------------------------------------------------------------------
function discoverWindowsPythons() {
    if (process.platform !== 'win32') return [];
    const roots = [
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Python'),
        process.env.ProgramFiles && path.join(process.env.ProgramFiles, ''),
        process.env['ProgramFiles(x86)'],
        'C:\\',
    ].filter(Boolean);

    const found = [];
    for (const root of roots) {
        try {
            for (const entry of fs.readdirSync(root)) {
                if (!/^Python3/i.test(entry)) continue;
                const exe = path.join(root, entry, 'python.exe');
                if (fs.existsSync(exe)) found.push(exe);
            }
        } catch (_) {
            // root not readable / does not exist; skip
        }
    }
    return found;
}

function resolvePython() {
    const candidates = [];
    if (process.env.PYTHON_PATH) candidates.push(process.env.PYTHON_PATH);
    if (process.env.PYTHON) candidates.push(process.env.PYTHON);
    candidates.push('py', 'python3', 'python');
    candidates.push(...discoverWindowsPythons());

    for (const cmd of candidates) {
        try {
            const result = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
            const out = (result.stdout || '') + (result.stderr || '');
            if (result.status === 0 && /Python 3/.test(out)) {
                return cmd;
            }
        } catch (_) {
            // candidate not runnable; try the next one
        }
    }
    return null;
}

const PYTHON_PATH = resolvePython();

// ---------------------------------------------------------------------------
// Recommender service configuration.
// The Python model files (incl. the ~176 MB similarity matrix) are loaded
// ONCE by a long-lived Flask service (recommender_service.py) instead of
// re-reading them on every request. By default this Node process supervises
// that service as a child. Point PYTHON_SERVICE_URL at an externally-managed
// instance to skip the auto-spawn.
// ---------------------------------------------------------------------------
const SERVICE_PORT = process.env.PYTHON_SERVICE_PORT || 8000;
const EXTERNAL_SERVICE_URL = process.env.PYTHON_SERVICE_URL || null;
const SERVICE_URL = EXTERNAL_SERVICE_URL || `http://127.0.0.1:${SERVICE_PORT}`;

const TMDB_API_KEY = process.env.TMDB_API_KEY;

if (!TMDB_API_KEY) {
    console.error('\n[WARN] TMDB_API_KEY is not set. Copy .env.example to .env and add your key.');
    console.error('       /api/recommend will return an error until it is configured.\n');
}

const serviceClient = axios.create({ baseURL: SERVICE_URL, timeout: 20000 });

let recommenderProcess = null;

function startRecommenderService() {
    if (EXTERNAL_SERVICE_URL) {
        console.log(`Using external recommender service at ${EXTERNAL_SERVICE_URL}`);
        return;
    }
    if (!PYTHON_PATH) {
        console.error('\n[FATAL] No working Python 3 interpreter was found.');
        console.error('  Install Python 3 from https://www.python.org/downloads/');
        console.error('  (during install, check "Add python.exe to PATH"), then run:');
        console.error('    pip install -r ../requirements.txt');
        console.error('  Or set PYTHON_SERVICE_URL to a running recommender service.\n');
        return;
    }

    console.log(`Using Python interpreter: ${PYTHON_PATH}`);
    console.log(`Starting recommender service on port ${SERVICE_PORT} (loading model files once)...`);

    recommenderProcess = spawn(PYTHON_PATH, ['recommender_service.py', String(SERVICE_PORT)], {
        cwd: __dirname,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    recommenderProcess.stdout.on('data', (d) => process.stdout.write(`[py] ${d}`));
    recommenderProcess.stderr.on('data', (d) => process.stderr.write(`[py] ${d}`));

    recommenderProcess.on('error', (err) => {
        console.error('Failed to start recommender service:', err.message);
    });
    recommenderProcess.on('exit', (code) => {
        console.error(`Recommender service exited with code ${code}.`);
        recommenderProcess = null;
    });
}

// Poll the service /health until it has finished loading the model files.
let serviceReady = false;
function waitForService() {
    return new Promise((resolve) => {
        const deadline = Date.now() + 90_000; // pickle load can take a while
        const tick = async () => {
            try {
                const r = await serviceClient.get('/health', { timeout: 2000 });
                if (r.data && r.data.status === 'ok') {
                    serviceReady = true;
                    console.log(`Recommender service ready (${r.data.movies} movies).`);
                    return resolve(true);
                }
            } catch (_) {
                // not up yet
            }
            if (Date.now() > deadline) {
                console.error('Recommender service did not become ready in time.');
                return resolve(false);
            }
            setTimeout(tick, 1000);
        };
        tick();
    });
}

startRecommenderService();
const serviceReadyPromise = waitForService();

// Ensure the service is reachable before serving a request that needs it.
async function ensureServiceReady(res) {
    if (serviceReady) return true;
    const ready = await Promise.race([
        serviceReadyPromise,
        new Promise((r) => setTimeout(() => r(serviceReady), 30_000)),
    ]);
    if (!ready) {
        res.status(503).json({ error: 'Recommender service is still starting. Please retry in a few seconds.' });
        return false;
    }
    return true;
}

// Clean up the child service when this process goes away.
function shutdown() {
    if (recommenderProcess) {
        recommenderProcess.kill();
        recommenderProcess = null;
    }
}
process.on('exit', shutdown);
process.on('SIGINT', () => { shutdown(); process.exit(0); });
process.on('SIGTERM', () => { shutdown(); process.exit(0); });

// ---------------------------------------------------------------------------
// TMDB client + caches
// ---------------------------------------------------------------------------
axiosRetry(axios, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
               error.code === 'ECONNRESET' ||
               error.code === 'ETIMEDOUT' ||
               error.code === 'ENOTFOUND' ||
               (error.response && error.response.status >= 500);
    },
    onRetry: (retryCount, error) => {
        console.log(`Retrying TMDB API call (attempt ${retryCount}): ${error.message}`);
    },
});

const axiosInstance = axios.create({
    timeout: 10000,
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
});

// Phase 1 #2: cache the (static) movie-title list so it is fetched once.
let moviesCache = null;

// Phase 1 #3: cache TMDB movie-detail responses (and 404 placeholders).
const tmdbCache = new Map();

// FRONTEND_URL can be a single origin or a comma-separated list.
// Defaults to localhost for local dev.
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
}));

app.use(express.json());

app.get('/api/health', (req, res) => {
    res.json({
        status: 'Server is running',
        timestamp: new Date().toISOString(),
        recommenderServiceReady: serviceReady,
        moviesCached: moviesCache ? moviesCache.length : 0,
        tmdbCached: tmdbCache.size,
    });
});

app.get('/api/movies', async (req, res) => {
    if (moviesCache) {
        return res.json(moviesCache);
    }
    if (!(await ensureServiceReady(res))) return;

    try {
        const response = await serviceClient.get('/movies');
        moviesCache = response.data;
        console.log(`Loaded and cached ${moviesCache.length} movies from recommender service`);
        res.json(moviesCache);
    } catch (err) {
        console.error('Failed to get movies from recommender service:', err.message);
        res.status(502).json({ error: 'Failed to get movie titles from recommender service.' });
    }
});

app.get('/api/recommend', async (req, res) => {
    const movieTitle = req.query.movie;
    console.log(`Recommendation request for: "${movieTitle}"`);

    if (!movieTitle) {
        return res.status(400).json({ error: 'Movie title query parameter is required' });
    }
    if (!TMDB_API_KEY) {
        return res.status(500).json({ error: 'Server is missing its TMDB API key. See server logs.' });
    }
    if (!(await ensureServiceReady(res))) return;

    let movieIdList;
    try {
        const params = { movie: movieTitle };
        if (req.query.limit) params.limit = req.query.limit;
        const response = await serviceClient.get('/recommend', { params });
        movieIdList = (response.data.ids || []).map((id) => String(id).trim()).filter(Boolean);
    } catch (err) {
        console.error('Recommender service error:', err.message);
        return res.status(502).json({ error: 'Failed to get recommendations from recommender service.' });
    }

    if (movieIdList.length === 0) {
        return res.status(404).json({ error: `No recommendations found for "${movieTitle}".` });
    }

    try {
        console.log('Fetching movie details from TMDB...');
        let fetchSlot = 0;
        const movieDetailsPromises = movieIdList.map((id) => {
            if (tmdbCache.has(id)) {
                return Promise.resolve(tmdbCache.get(id));
            }
            // Stagger only the requests that actually hit TMDB.
            const delay = fetchSlot++ * 120;
            return new Promise((resolve) => {
                setTimeout(() => {
                    fetchMovieDataWithRetry(id).then(resolve).catch(() => resolve(null));
                }, delay);
            });
        });

        const results = await Promise.all(movieDetailsPromises);
        const validRecommendations = results.filter((movie) => movie !== null);

        console.log(`Successfully resolved ${validRecommendations.length}/${movieIdList.length} movie details`);

        if (validRecommendations.length === 0) {
            return res.status(502).json({ error: 'Failed to fetch movie details from TMDB' });
        }

        res.json(validRecommendations);
    } catch (err) {
        console.error('Error processing recommendations:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Server error while fetching movie details.' });
        }
    }
});

const fetchMovieDataWithRetry = async (movieId) => {
    if (tmdbCache.has(movieId)) return tmdbCache.get(movieId);

    const url = `https://api.themoviedb.org/3/movie/${movieId}?api_key=${TMDB_API_KEY}&language=en-US`;

    try {
        const response = await axiosInstance.get(url);
        const data = response.data;

        const movie = {
            id: data.id,
            title: data.title,
            poster_path: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
            release_date: data.release_date || null,
            overview: data.overview || null,
            genres: Array.isArray(data.genres) ? data.genres.map((g) => g.name) : [],
        };
        tmdbCache.set(movieId, movie);
        return movie;
    } catch (error) {
        console.error(`Failed to fetch movie ID ${movieId}: ${error.message}`);
        if (error.response && error.response.status === 404) {
            const placeholder = {
                id: parseInt(movieId, 10),
                title: `Unknown Movie (ID: ${movieId})`,
                poster_path: null,
                release_date: null,
                overview: 'Movie details not available',
                genres: [],
            };
            tmdbCache.set(movieId, placeholder); // a 404 won't change; cache it
            return placeholder;
        }
        return null; // transient error — do NOT cache, allow a future retry
    }
};

// --- Trending (TMDB proxy, cached) -----------------------------------------
let genreMapCache = null;
async function getGenreMap() {
    if (genreMapCache) return genreMapCache;
    try {
        const url = `https://api.themoviedb.org/3/genre/movie/list?api_key=${TMDB_API_KEY}&language=en-US`;
        const { data } = await axiosInstance.get(url);
        genreMapCache = Object.fromEntries((data.genres || []).map((g) => [g.id, g.name]));
    } catch (err) {
        console.error('Failed to fetch TMDB genre map:', err.message);
        genreMapCache = {}; // don't keep retrying every request within this run
    }
    return genreMapCache;
}

const TRENDING_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
let trendingCache = { data: null, ts: 0 };

app.get('/api/trending', async (req, res) => {
    if (!TMDB_API_KEY) {
        return res.status(500).json({ error: 'Server is missing its TMDB API key. See server logs.' });
    }

    const fresh = trendingCache.data && (Date.now() - trendingCache.ts) < TRENDING_TTL_MS;
    if (fresh) {
        return res.json(trendingCache.data);
    }

    try {
        const genreMap = await getGenreMap();
        const url = `https://api.themoviedb.org/3/trending/movie/week?api_key=${TMDB_API_KEY}&language=en-US`;
        const { data } = await axiosInstance.get(url);

        const movies = (data.results || [])
            .filter((m) => m.title)
            .slice(0, 12)
            .map((m) => ({
                id: m.id,
                title: m.title,
                poster_path: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
                release_date: m.release_date || null,
                overview: m.overview || null,
                genres: (m.genre_ids || []).map((id) => genreMap[id]).filter(Boolean),
            }));

        trendingCache = { data: movies, ts: Date.now() };
        console.log(`Cached ${movies.length} trending movies`);
        res.json(movies);
    } catch (err) {
        console.error('Failed to fetch trending from TMDB:', err.message);
        if (trendingCache.data) {
            return res.json(trendingCache.data); // serve stale on failure
        }
        res.status(502).json({ error: 'Failed to fetch trending movies.' });
    }
});

app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
