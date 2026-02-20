// Elo Estimator Frontend Application

let currentGames = [];
let currentUsername = "";
let currentView = "list";
let eloChart = null;
let hasMoreGames = true;
let oldestGameTime = null;

// DOM Elements
const usernameInput = document.getElementById("username-input");
const searchBtn = document.getElementById("search-btn");
const errorMessage = document.getElementById("error-message");
const resultsSection = document.getElementById("results-section");
const gamesList = document.getElementById("games-list");
const displayUsername = document.getElementById("display-username");
const loadingOverlay = document.getElementById("loading-overlay");
const loadingText = document.getElementById("loading-text");
const variantFilter = document.getElementById("variant-filter");
const timeFilter = document.getElementById("time-filter");
const listViewBtn = document.getElementById("list-view-btn");
const graphViewBtn = document.getElementById("graph-view-btn");
const listView = document.getElementById("list-view");
const graphView = document.getElementById("graph-view");
const batchAnalyzeBtn = document.getElementById("batch-analyze-btn");
const batchProgress = document.getElementById("batch-progress");
const progressText = document.getElementById("progress-text");
const progressPercent = document.getElementById("progress-percent");
const progressFill = document.getElementById("progress-fill");
const loadMoreBtn = document.getElementById("load-more-btn");

// Event Listeners
searchBtn.addEventListener("click", searchGames);
batchAnalyzeBtn.addEventListener("click", batchAnalyze);
loadMoreBtn.addEventListener("click", loadMoreGames);
usernameInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") searchGames();
});
variantFilter.addEventListener("change", onVariantChange);
timeFilter.addEventListener("change", onFilterChange);
listViewBtn.addEventListener("click", () => switchView("list"));
graphViewBtn.addEventListener("click", () => switchView("graph"));

function switchView(view) {
    currentView = view;
    
    if (view === "list") {
        listViewBtn.classList.add("active");
        graphViewBtn.classList.remove("active");
        listView.classList.remove("hidden");
        graphView.classList.add("hidden");
    } else {
        listViewBtn.classList.remove("active");
        graphViewBtn.classList.add("active");
        listView.classList.add("hidden");
        graphView.classList.remove("hidden");
        renderGraph();
    }
}

function onVariantChange() {
    const variant = variantFilter.value;
    
    if (variant === "chess960") {
        timeFilter.innerHTML = `
            <option value="all">All</option>
            <option value="15+10">15+10</option>
        `;
    } else {
        timeFilter.innerHTML = `
            <option value="all">All</option>
            <option value="bullet">Bullet</option>
            <option value="blitz">Blitz</option>
            <option value="rapid">Rapid</option>
            <option value="classical">Classical</option>
        `;
    }
    
    if (currentUsername) {
        searchGames();
    }
}

function onFilterChange() {
    if (currentUsername) {
        searchGames();
    }
}

async function searchGames() {
    const username = usernameInput.value.trim();
    if (!username) {
        showError("Please enter a username");
        return;
    }

    hideError();
    showLoading("Fetching games from Lichess...");

    // Reset state for new search
    currentGames = [];
    hasMoreGames = true;
    oldestGameTime = null;

    const variant = variantFilter.value;
    const timeControl = timeFilter.value;

    try {
        const params = new URLSearchParams({
            max: 50,
            variant: variant,
            time_control: timeControl
        });
        
        const response = await fetch(`/api/games/${encodeURIComponent(username)}?${params}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Failed to fetch games");
        }

        currentGames = data.games;
        currentUsername = data.username;
        hasMoreGames = data.has_more;
        oldestGameTime = data.oldest_time;
        
        displayResults();
    } catch (error) {
        showError(error.message);
    } finally {
        hideLoading();
    }
}

async function loadMoreGames() {
    if (!hasMoreGames || !oldestGameTime) return;
    
    showLoading("Fetching more games...");

    const variant = variantFilter.value;
    const timeControl = timeFilter.value;

    try {
        const params = new URLSearchParams({
            max: 50,
            variant: variant,
            time_control: timeControl,
            until: oldestGameTime
        });
        
        const response = await fetch(`/api/games/${encodeURIComponent(currentUsername)}?${params}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Failed to fetch games");
        }

        // Append new games
        const newGames = data.games;
        const startIndex = currentGames.length;
        currentGames = [...currentGames, ...newGames];
        hasMoreGames = data.has_more;
        oldestGameTime = data.oldest_time;
        
        // Add new game cards
        newGames.forEach((game, i) => {
            const gameCard = createGameCard(game, startIndex + i);
            gamesList.appendChild(gameCard);
        });
        
        updateBatchButtonText();
        updateLoadMoreButton();
        
        // Update graph if visible
        if (currentView === "graph") {
            renderGraph();
        }
        
    } catch (error) {
        showError(error.message);
    } finally {
        hideLoading();
    }
}

function displayResults() {
    displayUsername.textContent = currentUsername;
    resultsSection.classList.remove("hidden");
    
    displayGames();
    updateBatchButtonText();
    updateLoadMoreButton();
    
    if (currentView === "graph") {
        renderGraph();
    }
}

function updateLoadMoreButton() {
    if (hasMoreGames) {
        loadMoreBtn.classList.remove("hidden");
    } else {
        loadMoreBtn.classList.add("hidden");
    }
}

function displayGames() {
    gamesList.innerHTML = "";

    if (currentGames.length === 0) {
        gamesList.innerHTML = '<p class="no-games">No games found for this user</p>';
        return;
    }

    currentGames.forEach((game, index) => {
        const gameCard = createGameCard(game, index);
        gamesList.appendChild(gameCard);
    });
}

function createGameCard(game, index) {
    const card = document.createElement("div");
    card.className = "game-card";
    card.id = `game-card-${index}`;
    
    const isAnalyzed = game.cached_white_elo !== undefined;
    if (isAnalyzed) {
        card.classList.add("analyzed");
    } else {
        card.classList.add("clickable");
        card.onclick = () => analyzeGame(index);
    }

    const resultClass = getResultClass(game.result, game.white, currentUsername);
    const timeControl = formatTimeControl(game.time_control);
    
    const isUserWhite = game.white.toLowerCase() === currentUsername.toLowerCase();
    
    let predictionHtml = "";
    if (isAnalyzed) {
        const userElo = isUserWhite ? game.cached_white_elo : game.cached_black_elo;
        const opponentElo = isUserWhite ? game.cached_black_elo : game.cached_white_elo;
        predictionHtml = `
            <div class="prediction-display">
                <span class="prediction-label">Estimated:</span>
                <span class="user-elo">${userElo}</span>
                <span class="elo-separator">vs</span>
                <span class="opponent-elo">${opponentElo}</span>
            </div>
        `;
    }

    card.innerHTML = `
        <div class="game-card-header">
            <span class="game-date">${formatDate(game.date)}</span>
            <span class="game-time-control">${timeControl}</span>
        </div>
        <div class="game-players">
            <div class="player white-player">
                <span class="piece">♔</span>
                <span class="player-name">${escapeHtml(game.white)}</span>
                <span class="player-elo">(${game.white_elo})</span>
            </div>
            <div class="vs">vs</div>
            <div class="player black-player">
                <span class="piece">♚</span>
                <span class="player-name">${escapeHtml(game.black)}</span>
                <span class="player-elo">(${game.black_elo})</span>
            </div>
        </div>
        <div class="game-details">
            <span class="game-opening">${escapeHtml(game.opening)}</span>
            <span class="game-result ${resultClass}">${formatResult(game.result)}</span>
        </div>
        <div class="game-footer">
            <span class="game-moves">${game.num_moves} moves</span>
            <a href="https://lichess.org/${game.id}" target="_blank" class="lichess-link" onclick="event.stopPropagation()">View on Lichess ↗</a>
            ${isAnalyzed ? '<span class="analyzed-badge">✓</span>' : '<span class="analyze-hint">Click to analyze</span>'}
        </div>
        ${predictionHtml}
    `;

    return card;
}

async function analyzeGame(index) {
    const game = currentGames[index];
    
    if (game.cached_white_elo !== undefined) {
        return;
    }
    
    showLoading("Analyzing game with Stockfish...");
    
    try {
        const response = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pgn: game.pgn, game_id: game.id })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Analysis failed");
        }

        game.cached_white_elo = data.white_elo;
        game.cached_black_elo = data.black_elo;

        const oldCard = document.getElementById(`game-card-${index}`);
        const newCard = createGameCard(game, index);
        oldCard.replaceWith(newCard);
        
        // Update batch button text
        updateBatchButtonText();
        
        // Update graph if in graph view
        if (currentView === "graph") {
            renderGraph();
        }
        
    } catch (error) {
        showError(error.message);
    } finally {
        hideLoading();
    }
}

async function batchAnalyze() {
    // Find unanalyzed games (up to 10)
    const unanalyzedIndices = [];
    for (let i = 0; i < currentGames.length && unanalyzedIndices.length < 10; i++) {
        if (currentGames[i].cached_white_elo === undefined) {
            unanalyzedIndices.push(i);
        }
    }
    
    if (unanalyzedIndices.length === 0) {
        return;
    }
    
    const total = unanalyzedIndices.length;
    let completed = 0;
    
    // Show progress bar, hide button
    batchAnalyzeBtn.classList.add("hidden");
    batchProgress.classList.remove("hidden");
    updateBatchProgress(completed, total);
    
    for (const index of unanalyzedIndices) {
        const game = currentGames[index];
        
        try {
            const response = await fetch("/api/analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pgn: game.pgn, game_id: game.id })
            });

            const data = await response.json();

            if (response.ok) {
                game.cached_white_elo = data.white_elo;
                game.cached_black_elo = data.black_elo;

                // Update the card
                const oldCard = document.getElementById(`game-card-${index}`);
                if (oldCard) {
                    const newCard = createGameCard(game, index);
                    oldCard.replaceWith(newCard);
                }
            }
        } catch (error) {
            console.error(`Failed to analyze game ${index}:`, error);
        }
        
        completed++;
        updateBatchProgress(completed, total);
    }
    
    // Hide progress bar, show button
    batchProgress.classList.add("hidden");
    batchAnalyzeBtn.classList.remove("hidden");
    updateBatchButtonText();
    
    // Update graph if in graph view
    if (currentView === "graph") {
        renderGraph();
    }
}

function updateBatchProgress(completed, total) {
    const percent = Math.round((completed / total) * 100);
    progressText.textContent = `Analyzing game ${completed + 1}/${total}...`;
    if (completed === total) {
        progressText.textContent = `Completed ${total} games!`;
    }
    progressPercent.textContent = `${percent}%`;
    progressFill.style.width = `${percent}%`;
}

function updateBatchButtonText() {
    const unanalyzedCount = currentGames.filter(g => g.cached_white_elo === undefined).length;
    if (unanalyzedCount === 0) {
        batchAnalyzeBtn.textContent = "All Analyzed ✓";
        batchAnalyzeBtn.disabled = true;
        batchAnalyzeBtn.classList.add("disabled");
    } else {
        const toAnalyze = Math.min(unanalyzedCount, 10);
        batchAnalyzeBtn.textContent = `Analyze Next ${toAnalyze}`;
        batchAnalyzeBtn.disabled = false;
        batchAnalyzeBtn.classList.remove("disabled");
    }
}

// ============ GRAPH FUNCTIONS ============

function prepareGraphData() {
    // Reverse games so oldest is first (index 0 = oldest game)
    const games = [...currentGames].reverse();
    
    const trueElos = [];
    const estimatedElos = [];
    const isMissing = [];
    
    games.forEach((game, i) => {
        const isUserWhite = game.white.toLowerCase() === currentUsername.toLowerCase();
        
        // True ELO from game data
        const trueElo = parseInt(isUserWhite ? game.white_elo : game.black_elo) || null;
        trueElos.push(trueElo);
        
        // Estimated ELO (may be missing)
        if (game.cached_white_elo !== undefined) {
            const estElo = isUserWhite ? game.cached_white_elo : game.cached_black_elo;
            estimatedElos.push(estElo);
            isMissing.push(false);
        } else {
            estimatedElos.push(null);
            isMissing.push(true);
        }
    });
    
    // Interpolate missing estimated ELOs
    const interpolatedEstimated = interpolateValues(estimatedElos);
    
    // Calculate moving averages
    const trueMA10 = movingAverage(trueElos, 10);
    const estimatedMA10 = movingAverage(interpolatedEstimated, 10);
    
    return {
        labels: games.map((_, i) => i + 1),
        trueElos,
        estimatedElos: interpolatedEstimated,
        isMissing,
        trueMA10,
        estimatedMA10
    };
}

function interpolateValues(values) {
    const result = [...values];
    
    // Find first and last non-null indices
    let firstValid = values.findIndex(v => v !== null);
    let lastValid = values.length - 1 - [...values].reverse().findIndex(v => v !== null);
    
    if (firstValid === -1) {
        // All values are null, return as-is
        return result;
    }
    
    // Fill leading nulls with first valid value
    for (let i = 0; i < firstValid; i++) {
        result[i] = values[firstValid];
    }
    
    // Fill trailing nulls with last valid value
    for (let i = lastValid + 1; i < values.length; i++) {
        result[i] = values[lastValid];
    }
    
    // Interpolate middle nulls
    for (let i = firstValid; i <= lastValid; i++) {
        if (result[i] === null) {
            // Find previous and next valid values
            let prevIdx = i - 1;
            while (prevIdx >= 0 && values[prevIdx] === null) prevIdx--;
            
            let nextIdx = i + 1;
            while (nextIdx < values.length && values[nextIdx] === null) nextIdx++;
            
            if (prevIdx >= 0 && nextIdx < values.length) {
                // Linear interpolation
                const prevVal = values[prevIdx];
                const nextVal = values[nextIdx];
                const ratio = (i - prevIdx) / (nextIdx - prevIdx);
                result[i] = Math.round(prevVal + (nextVal - prevVal) * ratio);
            }
        }
    }
    
    return result;
}

function movingAverage(values, window) {
    const result = [];
    
    for (let i = 0; i < values.length; i++) {
        const start = Math.max(0, i - window + 1);
        const slice = values.slice(start, i + 1).filter(v => v !== null);
        
        if (slice.length > 0) {
            result.push(Math.round(slice.reduce((a, b) => a + b, 0) / slice.length));
        } else {
            result.push(null);
        }
    }
    
    return result;
}

function renderGraph() {
    const data = prepareGraphData();
    const ctx = document.getElementById("elo-chart").getContext("2d");
    
    if (eloChart) {
        eloChart.destroy();
    }
    
    // Create point colors for estimated raw (red for missing)
    const estimatedPointColors = data.isMissing.map(missing => 
        missing ? "#bf3030" : "#7cb342"
    );
    
    const estimatedPointRadius = data.isMissing.map(missing =>
        missing ? 5 : 3
    );
    
    eloChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: data.labels,
            datasets: [
                // True ELO - Raw (dotted blue)
                {
                    label: "True ELO (raw)",
                    data: data.trueElos,
                    borderColor: "#5c9ece",
                    backgroundColor: "transparent",
                    borderWidth: 1,
                    borderDash: [5, 5],
                    pointRadius: 2,
                    pointBackgroundColor: "#5c9ece",
                    tension: 0.1,
                    order: 3
                },
                // True ELO - MA10 (solid blue)
                {
                    label: "True ELO (MA10)",
                    data: data.trueMA10,
                    borderColor: "#5c9ece",
                    backgroundColor: "transparent",
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.3,
                    order: 2
                },
                // Estimated ELO - Raw (dotted green, red for missing)
                {
                    label: "Estimated ELO (raw)",
                    data: data.estimatedElos,
                    borderColor: "#7cb342",
                    backgroundColor: "transparent",
                    borderWidth: 1,
                    borderDash: [5, 5],
                    pointRadius: estimatedPointRadius,
                    pointBackgroundColor: estimatedPointColors,
                    tension: 0.1,
                    order: 1
                },
                // Estimated ELO - MA10 (solid green)
                {
                    label: "Estimated ELO (MA10)",
                    data: data.estimatedMA10,
                    borderColor: "#7cb342",
                    backgroundColor: "transparent",
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.3,
                    order: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: "index"
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        title: (items) => `Game ${items[0].label}`,
                        label: (item) => {
                            const datasetLabel = item.dataset.label;
                            const value = item.raw;
                            if (value === null) return null;
                            
                            // Check if this is a missing/interpolated point
                            if (datasetLabel === "Estimated ELO (raw)" && data.isMissing[item.dataIndex]) {
                                return `${datasetLabel}: ${value} (interpolated)`;
                            }
                            return `${datasetLabel}: ${value}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: "Game #",
                        color: "#bababa"
                    },
                    ticks: { 
                        color: "#bababa",
                        maxTicksLimit: 20
                    },
                    grid: { color: "#404040" }
                },
                y: {
                    title: {
                        display: true,
                        text: "ELO Rating",
                        color: "#bababa"
                    },
                    ticks: { color: "#bababa" },
                    grid: { color: "#404040" }
                }
            }
        }
    });
}

// ============ UTILITY FUNCTIONS ============

function showLoading(text) {
    loadingText.textContent = text;
    loadingOverlay.classList.remove("hidden");
}

function hideLoading() {
    loadingOverlay.classList.add("hidden");
}

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove("hidden");
}

function hideError() {
    errorMessage.classList.add("hidden");
}

function formatDate(dateStr) {
    if (!dateStr) return "Unknown date";
    const parts = dateStr.split(".");
    if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
}

function formatTimeControl(tc) {
    if (!tc || tc === "-") return "Unknown";
    const parts = tc.split("+");
    if (parts.length === 2) {
        const mins = Math.floor(parseInt(parts[0]) / 60);
        const inc = parts[1];
        return `${mins}+${inc}`;
    }
    return tc;
}

function formatResult(result) {
    switch (result) {
        case "1-0": return "White wins";
        case "0-1": return "Black wins";
        case "1/2-1/2": return "Draw";
        default: return result;
    }
}

function getResultClass(result, white, username) {
    const isWhite = white.toLowerCase() === username.toLowerCase();
    if (result === "1-0") return isWhite ? "win" : "loss";
    if (result === "0-1") return isWhite ? "loss" : "win";
    return "draw";
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}
