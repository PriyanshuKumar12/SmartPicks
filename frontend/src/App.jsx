import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './App.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001';
const SKELETON_COUNT = 5;
const PAGE_SIZE = 5;
const MAX_SELECTED = 5;
const RECOMMEND_LIMIT = 20;
const WATCHLIST_KEY = 'smartpicks:watchlist';

function HeartIcon({ filled }) {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
                d="M12 21s-7.5-4.6-10-9.3C.8 8.9 2.3 5.5 5.7 5.1c2-.3 3.8.8 4.8 2.4l1.5 2 1.5-2c1-1.6 2.8-2.7 4.8-2.4 3.4.4 4.9 3.8 3.7 6.6C19.5 16.4 12 21 12 21Z"
                fill={filled ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="1.6"
            />
        </svg>
    );
}

function MovieCard({ movie, onOpen, inWatch, onToggleWatch }) {
    return (
        <article
            className="card"
            role="button"
            tabIndex={0}
            onClick={() => onOpen(movie)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen(movie);
                }
            }}
        >
            {movie.poster_path ? (
                <img src={movie.poster_path} alt={movie.title} loading="lazy" />
            ) : (
                <div className="no-poster">No Poster</div>
            )}

            <button
                className={`fav-btn${inWatch ? ' active' : ''}`}
                aria-label={inWatch ? 'Remove from watchlist' : 'Add to watchlist'}
                onClick={(e) => {
                    e.stopPropagation();
                    onToggleWatch(movie);
                }}
            >
                <HeartIcon filled={inWatch} />
            </button>

            <div className="card-overlay">
                {movie.release_date && (
                    <span className="card-year">{String(movie.release_date).slice(0, 4)}</span>
                )}
                <h4 className="card-title">{movie.title}</h4>
                {movie.overview && <p className="card-overview">{movie.overview}</p>}
            </div>
        </article>
    );
}

function App() {
    const [query, setQuery] = useState('');
    const [allMovies, setAllMovies] = useState([]);
    const [suggestions, setSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const [selectedTitles, setSelectedTitles] = useState([]);

    const [recommendations, setRecommendations] = useState([]);
    const [resultsFor, setResultsFor] = useState('');
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const [genreFilter, setGenreFilter] = useState('All');

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [moviesLoading, setMoviesLoading] = useState(true);

    const [trending, setTrending] = useState([]);
    const [selectedMovie, setSelectedMovie] = useState(null);

    const [watchlist, setWatchlist] = useState([]);
    const [showWatchlist, setShowWatchlist] = useState(false);

    const debounceRef = useRef(null);

    // --- Server connection check ---
    useEffect(() => {
        axios.get(`${API_BASE}/api/health`).catch((err) => {
            console.error('Server connection failed:', err);
            setError('Cannot connect to server. Make sure the backend is running on port 5001.');
        });
    }, []);

    // --- Load all movie titles ---
    useEffect(() => {
        const fetchAllMovies = async () => {
            try {
                setMoviesLoading(true);
                const response = await axios.get(`${API_BASE}/api/movies`);
                if (Array.isArray(response.data)) {
                    setAllMovies(response.data);
                    if (response.data.length === 0) setError('No movies found in the database.');
                } else {
                    setError('Invalid movie data received from server.');
                }
            } catch (err) {
                console.error('Could not fetch movie list:', err);
                if (err.response) setError(`Server error: ${err.response.data.error || 'Unknown error'}`);
                else if (err.request) setError('Cannot reach the server. Make sure the backend is running.');
                else setError('Network error occurred.');
            } finally {
                setMoviesLoading(false);
            }
        };
        fetchAllMovies();
    }, []);

    // --- Trending (home screen) ---
    useEffect(() => {
        axios.get(`${API_BASE}/api/trending`)
            .then((r) => Array.isArray(r.data) && setTrending(r.data))
            .catch((err) => console.error('Could not fetch trending:', err.message));
    }, []);

    // --- Watchlist persistence ---
    useEffect(() => {
        try {
            const saved = JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]');
            if (Array.isArray(saved)) setWatchlist(saved);
        } catch (_) {
            // corrupt/missing — start empty
        }
    }, []);

    const persistWatchlist = (next) => {
        setWatchlist(next);
        try {
            localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
        } catch (_) {
            // storage full / disabled — keep in-memory only
        }
    };

    const isInWatch = (id) => watchlist.some((m) => m.id === id);

    const toggleWatch = (movie) => {
        persistWatchlist(
            isInWatch(movie.id)
                ? watchlist.filter((m) => m.id !== movie.id)
                : [...watchlist, movie]
        );
    };

    // Clear debounce timer on unmount
    useEffect(() => () => clearTimeout(debounceRef.current), []);

    // Modal: Escape to close + body scroll lock
    useEffect(() => {
        if (!selectedMovie) return;
        const onKey = (e) => e.key === 'Escape' && setSelectedMovie(null);
        document.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prev;
        };
    }, [selectedMovie]);

    const handleInputChange = (event) => {
        const value = event.target.value;
        setQuery(value);
        setError('');

        clearTimeout(debounceRef.current);
        if (value.length > 0 && allMovies.length > 0) {
            debounceRef.current = setTimeout(() => {
                const needle = value.toLowerCase();
                setSuggestions(
                    allMovies.filter((t) => t.toLowerCase().includes(needle)).slice(0, 10)
                );
                setShowSuggestions(true);
                setShowDropdown(true);
            }, 160);
        } else {
            setSuggestions([]);
            setShowSuggestions(false);
            setShowDropdown(false);
        }
    };

    const addTitle = (title) => {
        setSelectedTitles((prev) => {
            if (prev.some((t) => t.toLowerCase() === title.toLowerCase())) return prev;
            if (prev.length >= MAX_SELECTED) return prev;
            return [...prev, title];
        });
    };

    const handleSuggestionClick = (suggestion) => {
        clearTimeout(debounceRef.current);
        addTitle(suggestion);
        setQuery('');
        setSuggestions([]);
        setShowSuggestions(false);
        setShowDropdown(false);
        setError('');
    };

    const removeTitle = (title) =>
        setSelectedTitles((prev) => prev.filter((t) => t !== title));

    const handleInputFocus = () => {
        if (suggestions.length > 0) {
            setShowSuggestions(true);
            setShowDropdown(true);
        }
    };

    const handleInputBlur = () => {
        setTimeout(() => {
            setShowSuggestions(false);
            setShowDropdown(false);
        }, 200);
    };

    const getRecommendations = async () => {
        const typed = query.trim();
        const titles = selectedTitles.length
            ? [...selectedTitles]
            : typed
                ? [typed]
                : [];

        if (titles.length === 0) {
            setError('Pick at least one movie from the suggestions list.');
            return;
        }

        const unknown = titles.find(
            (t) => !allMovies.some((m) => m.toLowerCase() === t.toLowerCase())
        );
        if (unknown) {
            setError(`"${unknown}" is not in the database. Pick it from the suggestions dropdown.`);
            return;
        }

        setIsLoading(true);
        setError('');
        setRecommendations([]);
        setShowWatchlist(false);
        setShowSuggestions(false);
        setShowDropdown(false);
        setSuggestions([]);
        setVisibleCount(PAGE_SIZE);
        setGenreFilter('All');
        setResultsFor(titles.join(' & '));

        try {
            const movieParam = encodeURIComponent(titles.join(','));
            const response = await axios.get(
                `${API_BASE}/api/recommend?movie=${movieParam}&limit=${RECOMMEND_LIMIT}`
            );
            setRecommendations(response.data);
            if (response.data.length === 0) setError('No recommendations found.');
        } catch (err) {
            console.error('Recommendation error:', err);
            setError(err.response?.data?.error || 'Could not fetch recommendations.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') getRecommendations();
    };

    // --- Derived: genre filter + pagination ---
    const availableGenres = Array.from(
        new Set(recommendations.flatMap((m) => m.genres || []))
    ).sort();

    const filteredRecs =
        genreFilter === 'All'
            ? recommendations
            : recommendations.filter((m) => (m.genres || []).includes(genreFilter));

    const visibleRecs = filteredRecs.slice(0, visibleCount);
    const showResults = isLoading || recommendations.length > 0;

    return (
        <div className="app">
            <nav className="topnav">
                <div className="nav-lines" aria-hidden="true">
                    <span></span><span></span><span></span>
                </div>
                <h1 className="wordmark">
                    Smart<span className="dot">Picks</span>
                </h1>
                <button
                    className={`nav-btn${showWatchlist ? ' active' : ''}`}
                    onClick={() => setShowWatchlist((v) => !v)}
                >
                    ♥ Watchlist {watchlist.length > 0 && `(${watchlist.length})`}
                </button>
            </nav>

            <aside className="siderail" aria-hidden="true">
                <div className="rail-chip">Discover</div>
                <div className="rail-text">The Film Of Your Year</div>
                <div className="rail-social">
                    <a href="#" aria-label="X">
                        <svg viewBox="0 0 24 24"><path d="M18.9 1.6h3.5l-7.6 8.7L23.7 22h-7l-5.5-7.2L4.9 22H1.4l8.1-9.3L.7 1.6h7.2l5 6.6 5.9-6.6Zm-1.2 18.3h1.9L6.4 3.6H4.3l13.4 16.3Z"/></svg>
                    </a>
                    <a href="#" aria-label="Instagram">
                        <svg viewBox="0 0 24 24"><path d="M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.3 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.3 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.3-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c.1-1.2.3-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4 1.3-.1 1.7-.1 4.9-.1Zm0 5.3a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm0 7.4a2.9 2.9 0 1 1 0-5.8 2.9 2.9 0 0 1 0 5.8Zm5.7-7.6a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0Z"/></svg>
                    </a>
                    <a href="#" aria-label="Facebook">
                        <svg viewBox="0 0 24 24"><path d="M13.5 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.3-1.5 1.6-1.5h1.7V3.6c-.3 0-1.3-.1-2.5-.1-2.5 0-4.1 1.5-4.1 4.2v2.2H7.5V13h2.7v8h3.3Z"/></svg>
                    </a>
                </div>
            </aside>

            <main className="stage">
                <section className="hero">
                    <p className="hero-eyebrow">AI-Powered · Content-Based</p>
                    <h2 className="hero-title">
                        Find your<br />next <span className="accent">obsession</span>
                    </h2>
                    <p className="hero-sub">
                        Pick one or more films you love — SmartPicks blends their DNA and
                        surfaces titles cut from the same cloth.
                    </p>

                    {selectedTitles.length > 0 && (
                        <div className="chips">
                            {selectedTitles.map((t) => (
                                <span key={t} className="chip">
                                    {t}
                                    <button onClick={() => removeTitle(t)} aria-label={`Remove ${t}`}>✕</button>
                                </span>
                            ))}
                        </div>
                    )}

                    <div className="search">
                        <div className="search-field">
                            <input
                                type="text"
                                className="search-input"
                                placeholder={
                                    moviesLoading
                                        ? 'Loading library…'
                                        : selectedTitles.length
                                            ? 'Add another movie (optional)…'
                                            : 'Type a movie — e.g. Avatar, The Dark Knight…'
                                }
                                value={query}
                                onChange={handleInputChange}
                                onFocus={handleInputFocus}
                                onBlur={handleInputBlur}
                                onKeyDown={handleKeyDown}
                                disabled={moviesLoading || allMovies.length === 0}
                                autoComplete="off"
                            />

                            {showDropdown && showSuggestions && !isLoading && (
                                <ul className="suggestions-list">
                                    {suggestions.length > 0 ? (
                                        suggestions.map((s, i) => (
                                            <li
                                                key={i}
                                                onClick={() => handleSuggestionClick(s)}
                                                onMouseDown={(e) => e.preventDefault()}
                                            >
                                                {s}
                                            </li>
                                        ))
                                    ) : (
                                        <li className="empty">No films matching “{query}”</li>
                                    )}
                                </ul>
                            )}
                        </div>

                        <button
                            className="cta"
                            onClick={getRecommendations}
                            disabled={isLoading || moviesLoading || (!query.trim() && selectedTitles.length === 0)}
                        >
                            {isLoading ? 'Finding…' : 'Get Recommendations'}
                        </button>
                    </div>

                    {error && <div className="error">{error}</div>}
                </section>

                {/* Watchlist view */}
                {showWatchlist && (
                    <section className="results">
                        <div className="results-head">
                            <p className="results-kicker">Saved for later</p>
                            <h3 className="results-title">Your Watchlist</h3>
                        </div>
                        {watchlist.length === 0 ? (
                            <p className="empty-note">
                                No saved films yet. Tap the ♥ on any poster to add it here.
                            </p>
                        ) : (
                            <div className="grid">
                                {watchlist.map((m) => (
                                    <MovieCard
                                        key={m.id}
                                        movie={m}
                                        onOpen={setSelectedMovie}
                                        inWatch={isInWatch(m.id)}
                                        onToggleWatch={toggleWatch}
                                    />
                                ))}
                            </div>
                        )}
                    </section>
                )}

                {/* Recommendation results */}
                {!showWatchlist && showResults && (
                    <section className="results">
                        <div className="results-head">
                            <p className="results-kicker">
                                {isLoading ? 'Curating picks for' : 'Because you liked'}
                            </p>
                            <h3 className="results-title">{resultsFor}</h3>
                        </div>

                        {!isLoading && availableGenres.length > 0 && (
                            <div className="genre-bar">
                                {['All', ...availableGenres].map((g) => (
                                    <button
                                        key={g}
                                        className={`genre-chip${genreFilter === g ? ' active' : ''}`}
                                        onClick={() => { setGenreFilter(g); setVisibleCount(PAGE_SIZE); }}
                                    >
                                        {g}
                                    </button>
                                ))}
                            </div>
                        )}

                        <div className="grid">
                            {isLoading
                                ? Array.from({ length: SKELETON_COUNT }).map((_, i) => (
                                    <div key={i} className="card skeleton" aria-hidden="true" />
                                ))
                                : visibleRecs.map((rec) => (
                                    <MovieCard
                                        key={rec.id}
                                        movie={rec}
                                        onOpen={setSelectedMovie}
                                        inWatch={isInWatch(rec.id)}
                                        onToggleWatch={toggleWatch}
                                    />
                                ))}
                        </div>

                        {!isLoading && filteredRecs.length > visibleCount && (
                            <button
                                className="load-more"
                                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                            >
                                Load More ({filteredRecs.length - visibleCount} left)
                            </button>
                        )}
                    </section>
                )}

                {/* Trending (home screen only) */}
                {!showWatchlist && !showResults && trending.length > 0 && (
                    <section className="results">
                        <div className="results-head">
                            <p className="results-kicker">Hot right now</p>
                            <h3 className="results-title">Trending This Week</h3>
                        </div>
                        <div className="grid">
                            {trending.map((m) => (
                                <MovieCard
                                    key={m.id}
                                    movie={m}
                                    onOpen={setSelectedMovie}
                                    inWatch={isInWatch(m.id)}
                                    onToggleWatch={toggleWatch}
                                />
                            ))}
                        </div>
                    </section>
                )}

                <footer className="statusbar">
                    <span className="badge">Winner · <b>Best Picks</b> Engine 2026</span>
                    <span>Content-Based Filtering · TMDB</span>
                    <span>
                        {moviesLoading ? 'Syncing library' : `${allMovies.length} films indexed`}
                    </span>
                </footer>
            </main>

            {selectedMovie && (
                <div className="modal-backdrop" onClick={() => setSelectedMovie(null)}>
                    <div
                        className="modal"
                        role="dialog"
                        aria-modal="true"
                        aria-label={selectedMovie.title}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            className="modal-close"
                            onClick={() => setSelectedMovie(null)}
                            aria-label="Close"
                        >
                            ✕
                        </button>

                        <div className="modal-poster">
                            {selectedMovie.poster_path ? (
                                <img src={selectedMovie.poster_path} alt={selectedMovie.title} />
                            ) : (
                                <div className="no-poster">No Poster</div>
                            )}
                        </div>

                        <div className="modal-body">
                            {selectedMovie.release_date && (
                                <span className="modal-year">
                                    {String(selectedMovie.release_date).slice(0, 4)}
                                </span>
                            )}
                            <h2 className="modal-title">{selectedMovie.title}</h2>

                            {selectedMovie.genres && selectedMovie.genres.length > 0 && (
                                <div className="modal-genres">
                                    {selectedMovie.genres.map((g) => (
                                        <span key={g}>{g}</span>
                                    ))}
                                </div>
                            )}

                            <p className="modal-overview">
                                {selectedMovie.overview || 'No synopsis available for this title.'}
                            </p>

                            <div className="modal-actions">
                                <button
                                    className={`modal-fav${isInWatch(selectedMovie.id) ? ' active' : ''}`}
                                    onClick={() => toggleWatch(selectedMovie)}
                                >
                                    <HeartIcon filled={isInWatch(selectedMovie.id)} />
                                    {isInWatch(selectedMovie.id) ? 'In Watchlist' : 'Add to Watchlist'}
                                </button>
                                <a
                                    className="modal-link"
                                    href={`https://www.themoviedb.org/movie/${selectedMovie.id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    View on TMDB ↗
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;
