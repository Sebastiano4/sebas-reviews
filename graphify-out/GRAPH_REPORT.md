# Graph Report - sebas-reviews  (2026-05-29)

## Corpus Check
- 19 files · ~356,661 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 377 nodes · 715 edges · 20 communities (16 shown, 4 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 7 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `85854387`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]

## God Nodes (most connected - your core abstractions)
1. `escapeHtml()` - 23 edges
2. `escapeAttr` - 17 edges
3. `fetchAllMovies()` - 15 edges
4. `closeModal()` - 15 edges
5. `tmdbFetch()` - 13 edges
6. `openModal()` - 12 edges
7. `loadMoreMovies()` - 11 edges
8. `getMovieDetails()` - 11 edges
9. `findBestMovieMatch()` - 11 edges
10. `buildEloRanking()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `buildVaultMovieCountryMap()` --calls--> `fetchAllMovies()`  [INFERRED]
  src/js/stats.js → src/js/app.js
- `updateAdvancedStats()` --calls--> `fetchAllMovies()`  [INFERRED]
  src/js/stats.js → src/js/app.js
- `startRepairWithProgress()` --calls--> `fetchAllMovies()`  [INFERRED]
  src/js/ui.js → src/js/app.js
- `buildActorsRanking()` --calls--> `fetchAllMovies()`  [INFERRED]
  src/js/stats.js → src/js/app.js
- `buildDirectorsRanking()` --calls--> `fetchAllMovies()`  [INFERRED]
  src/js/stats.js → src/js/app.js

## Communities (20 total, 4 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (53): registerPopStateInterceptor(), activateVaultTab(), buildEloRanking(), buildMappingFromWatched(), buildVaultMapLayer(), buildVaultMovieCountryMap(), cleanupStats(), countryAvgRating (+45 more)

### Community 1 - "Community 1"
Cohesion: 0.04
Nodes (42): appContent, appRoot, barEl, battleBtn, bottomBattleBtn, cards, chatBtn, chatInput (+34 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (40): a, actorsModal, attachProfileListeners(), blob, btn, currentMovieId, currentUser, dataStr (+32 more)

### Community 3 - "Community 3"
Cohesion: 0.10
Nodes (36): data, fetchExploreMovies(), loadExploreGenres(), openReview(), showSimilarMovies(), clearImdbCache(), discoverMovies(), fetchActorImage() (+28 more)

### Community 4 - "Community 4"
Cohesion: 0.14
Nodes (29): calculateAverageEloByRating(), clearNextBattleTimer(), closeBattleModal(), computeLeapfrogElo(), finishRatingUpdate(), formatDelta(), getAnomalyDirection(), getEloRanking() (+21 more)

### Community 5 - "Community 5"
Cohesion: 0.11
Nodes (19): analyzeReviewFn, generateReviewTitle(), getAiReviewAdvice(), getReviewImprovementTips(), app, auth, db, firebaseConfig (+11 more)

### Community 6 - "Community 6"
Cohesion: 0.18
Nodes (22): apriFilmGrab(), createCardElement(), createDiscoveryCard(), createSmallCard(), fetchAllMovies(), getAIResponse(), openSurpriseModal(), populateFilters() (+14 more)

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (14): admin, adminDb, ALLOWED_TMDB_PATHS, apiKey, cached, cacheRef, createAiModel(), getGeminiApiKey() (+6 more)

### Community 8 - "Community 8"
Cohesion: 0.10
Nodes (19): dependencies, dotenv, firebase-admin, firebase-functions, @google/generative-ai, description, devDependencies, firebase-functions-test (+11 more)

### Community 9 - "Community 9"
Cohesion: 0.16
Nodes (17): closeAllModals(), closeModal(), closeModalById(), debugModalStack(), getCurrentModal(), hideModalElement(), initGlobalBackButtonHandler(), initModalSystem() (+9 more)

### Community 10 - "Community 10"
Cohesion: 0.18
Nodes (12): getFilteredMovies(), loadMoreMovies(), renderGallery(), resetInfiniteScroll(), showRecommendations(), syncFilterUI(), updateMovieInCache(), updateSpotlightAndCounters() (+4 more)

### Community 11 - "Community 11"
Cohesion: 0.22
Nodes (8): background_color, description, display, icons, name, short_name, start_url, theme_color

### Community 12 - "Community 12"
Cohesion: 0.25
Nodes (7): functions, runtime, source, hosting, ignore, public, rewrites

### Community 13 - "Community 13"
Cohesion: 0.40
Nodes (5): askRating(), getWatchlistCandidates(), pickRandomFromList(), rollSurprise(), hapticFeedback()

## Knowledge Gaps
- **135 isolated node(s):** `public`, `ignore`, `rewrites`, `source`, `runtime` (+130 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `escapeHtml()` connect `Community 6` to `Community 0`, `Community 1`, `Community 3`, `Community 4`, `Community 10`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `closeModal()` connect `Community 9` to `Community 1`, `Community 2`, `Community 4`, `Community 6`, `Community 13`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **Why does `auth` connect `Community 5` to `Community 1`, `Community 2`, `Community 3`, `Community 4`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `fetchAllMovies()` (e.g. with `buildActorsRanking()` and `buildDirectorsRanking()`) actually correct?**
  _`fetchAllMovies()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **What connects `public`, `ignore`, `rewrites` to the rest of the system?**
  _135 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05727644652250146 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.0392156862745098 - nodes in this community are weakly interconnected._