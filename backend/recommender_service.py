"""
SmartPicks recommender service.

Loads the (large) model files ONCE at startup and serves recommendations
over HTTP, instead of spawning a fresh Python process and re-reading the
176 MB similarity matrix on every request.

Endpoints (consumed by the Node backend, never by the browser directly):
  GET /health                          -> {"status": "ok", "movies": <n>}
  GET /movies                          -> ["#Horror", "(500) Days...", ...]
  GET /recommend?movie=X&limit=20      -> {"ids": ["440", "679", ...]}
  GET /recommend?movie=A,B&limit=20    -> blended ("because you liked A & B")

`movie` may be repeated or comma-separated; their similarity rows are
averaged and the input titles themselves are excluded from the results.
For a single movie with limit=5 this is equivalent to the original
recommender.py output.

Run:  python recommender_service.py [port]   (default port 8000)
"""

import os
import pickle
import sys
from urllib.request import urlopen

import numpy as np
from flask import Flask, jsonify, request

MAX_LIMIT = 50

app = Flask(__name__)

MODEL_DIR = os.path.dirname(os.path.abspath(__file__))


def _ensure_similarity_pkl():
    # similarity.pkl is 176 MB and not committed to git. In production the
    # deploy host fetches it once from SIMILARITY_URL (e.g. a Hugging Face
    # Hub direct-download URL) on first boot.
    path = os.path.join(MODEL_DIR, "similarity.pkl")
    if os.path.exists(path):
        return path

    url = os.environ.get("SIMILARITY_URL")
    if not url:
        raise RuntimeError(
            "similarity.pkl is missing and SIMILARITY_URL is not set. "
            "Either place the file in backend/ or set SIMILARITY_URL to a direct-download URL."
        )

    print(f"[recommender-service] Downloading similarity.pkl from {url} ...", file=sys.stderr, flush=True)
    tmp_path = path + ".part"
    with urlopen(url) as response, open(tmp_path, "wb") as out:
        chunk = 1024 * 1024
        while True:
            buf = response.read(chunk)
            if not buf:
                break
            out.write(buf)
    os.replace(tmp_path, path)
    print(f"[recommender-service] Downloaded similarity.pkl ({os.path.getsize(path) // (1024*1024)} MB).", file=sys.stderr, flush=True)
    return path


def _load():
    print("[recommender-service] Loading model files...", file=sys.stderr, flush=True)
    similarity_path = _ensure_similarity_pkl()
    with open(os.path.join(MODEL_DIR, "movies_preprocessed.pkl"), "rb") as f:
        data = pickle.load(f)
    with open(similarity_path, "rb") as f:
        similarity = pickle.load(f)

    # Sorted titles (matches get_titles.py: titles.sort()).
    titles = sorted(data["title"].tolist())

    # First index label per lowercased title (matches recommender.py:
    # matching_indices[0] on a default RangeIndex).
    title_index = {}
    for label, title in zip(data.index, data["title"]):
        key = str(title).lower()
        if key not in title_index:
            title_index[key] = label

    print(
        f"[recommender-service] Ready. {len(titles)} movies loaded.",
        file=sys.stderr,
        flush=True,
    )
    return data, similarity, titles, title_index


DATA, SIMILARITY, TITLES, TITLE_INDEX = _load()


@app.get("/health")
def health():
    return jsonify(status="ok", movies=len(TITLES))


@app.get("/movies")
def movies():
    return jsonify(TITLES)


def _parse_limit():
    try:
        limit = int(request.args.get("limit", 20))
    except (TypeError, ValueError):
        limit = 20
    return max(1, min(limit, MAX_LIMIT))


def _requested_titles():
    # Accept ?movie=A&movie=B and ?movie=A,B (and combinations).
    raw = []
    for value in request.args.getlist("movie"):
        raw.extend(value.split(","))
    return [t.strip() for t in raw if t.strip()]


@app.get("/recommend")
def recommend():
    titles = _requested_titles()
    if not titles:
        return jsonify(error="movie query parameter is required"), 400

    limit = _parse_limit()

    input_indices = []
    for title in titles:
        idx = TITLE_INDEX.get(title.lower())
        if idx is not None and idx not in input_indices:
            input_indices.append(idx)

    if not input_indices:
        return jsonify(ids=[])

    # Average the similarity rows of every matched input movie ("blend").
    blended = np.mean(np.vstack([SIMILARITY[i] for i in input_indices]), axis=0)

    excluded = set(input_indices)
    ranked = sorted(enumerate(blended), key=lambda x: x[1], reverse=True)

    ids = []
    for i, _ in ranked:
        if i in excluded:
            continue
        ids.append(str(DATA.iloc[i]["movie_id"]))
        if len(ids) >= limit:
            break

    return jsonify(ids=ids)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 8000))
    # threaded=True so concurrent recommendation requests don't queue;
    # use_reloader=False because this is launched/supervised by the Node backend.
    app.run(host="127.0.0.1", port=port, threaded=True, use_reloader=False)
