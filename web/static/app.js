// Elo Estimator Frontend Application

let currentGames = [];
let currentUsername = "";
let currentView = "list";
let eloChart = null;
let hasMoreGames = true;
let oldestGameTime = null;
let pendingJobIds = [];
let batchCancelled = false;

// DOM Elements
const usernameInput = document.getElementById("username-input");
const searchBtn = document.getElementById("search-btn"); const errorMessage = document.getElementById("error-message");
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
const queueIndicator = document.getElementById("queue-indicator");
const queueCount = document.getElementById("queue-count");
const batchCancelBtn = document.getElementById("batch-cancel-btn");
const toggleRaw = document.getElementById("toggle-raw");
const toggleMa = document.getElementById("toggle-ma");

// Event Listeners
searchBtn.addEventListener("click", searchGames);
batchAnalyzeBtn.addEventListener("click", batchAnalyze);
loadMoreBtn.addEventListener("click", loadMoreGames);
batchCancelBtn.addEventListener("click", cancelBatchAnalysis);
toggleRaw.addEventListener("change", updateChartVisibility);
toggleMa.addEventListener("change", updateChartVisibility);

function updateChartVisibility() {
    if (!eloChart) return;
    
    const showRaw = toggleRaw.checked;
    const showMa = toggleMa.checked;
    
    // Datasets: 0=True raw, 1=True MA, 2=Est raw, 3=Est MA
    eloChart.data.datasets[0].hidden = !showRaw;  // True ELO raw
    eloChart.data.datasets[2].hidden = !showRaw;  // Estimated ELO raw
    eloChart.data.datasets[1].hidden = !showMa;   // True ELO MA
    eloChart.data.datasets[3].hidden = !showMa;   // Estimated ELO MA
    
    eloChart.update();
}
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
    
    showLoading("Submitting to queue...");
    
    try {
        // Submit job to queue
        const response = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pgn: game.pgn, game_id: game.id })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Analysis failed");
        }

        // If already cached, update immediately
        if (data.cached) {
            game.cached_white_elo = data.result.white_elo;
            game.cached_black_elo = data.result.black_elo;
            updateGameCard(index);
            hideLoading();
            return;
        }

        // Poll for job completion
        const result = await pollJobStatus(data.job_id);
        
        if (result.error) {
            throw new Error(result.error);
        }
        
        game.cached_white_elo = result.white_elo;
        game.cached_black_elo = result.black_elo;
        
        updateGameCard(index);
        
    } catch (error) {
        showError(error.message);
    } finally {
        hideLoading();
    }
}

async function pollJobStatus(jobId) {
    while (true) {
        const response = await fetch(`/api/job/${jobId}`);
        const data = await response.json();
        
        if (!response.ok) {
            return { error: data.error || "Job not found" };
        }
        
        if (data.status === "complete") {
            return data.result;
        }
        
        if (data.status === "error") {
            return { error: data.error || "Analysis failed" };
        }
        
        // Update loading message with queue position
        if (data.status === "queued") {
            showLoading(`In queue: position ${data.position}`);
        } else if (data.status === "processing") {
            showLoading("Analyzing game...");
        }
        
        // Wait before polling again
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

function updateGameCard(index) {
    const game = currentGames[index];
    const oldCard = document.getElementById(`game-card-${index}`);
    if (oldCard) {
        const newCard = createGameCard(game, index);
        oldCard.replaceWith(newCard);
    }
    
    updateBatchButtonText();
    
    if (currentView === "graph") {
        renderGraph();
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
    
    // Reset state
    pendingJobIds = [];
    batchCancelled = false;
    
    // Show progress bar, hide button
    batchAnalyzeBtn.classList.add("hidden");
    batchProgress.classList.remove("hidden");
    updateBatchProgress(completed, total, "Submitting...");
    
    // Process one game at a time (fair queuing)
    for (const index of unanalyzedIndices) {
        // Check if cancelled
        if (batchCancelled) {
            break;
        }
        
        const game = currentGames[index];
        
        try {
            // Submit job
            const response = await fetch("/api/analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pgn: game.pgn, game_id: game.id })
            });

            const data = await response.json();

            if (!response.ok) {
                console.error(`Failed to submit game ${index}:`, data.error);
                completed++;
                updateBatchProgress(completed, total);
                continue;
            }

            // If already cached, update immediately
            if (data.cached) {
                game.cached_white_elo = data.result.white_elo;
                game.cached_black_elo = data.result.black_elo;
                updateGameCard(index);
                completed++;
                updateBatchProgress(completed, total);
                continue;
            }

            // Track job ID for potential cancellation
            pendingJobIds.push(data.job_id);

            // Poll for this job to complete before submitting next
            const result = await pollBatchJobStatus(data.job_id, completed, total);
            
            // Remove from pending once complete
            pendingJobIds = pendingJobIds.filter(id => id !== data.job_id);
            
            if (result && !result.error && !result.cancelled) {
                game.cached_white_elo = result.white_elo;
                game.cached_black_elo = result.black_elo;
                updateGameCard(index);
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
    pendingJobIds = [];
    batchCancelled = false;
    updateBatchButtonText();
    
    // Update graph if in graph view
    if (currentView === "graph") {
        renderGraph();
    }
}

async function pollBatchJobStatus(jobId, completed, total) {
    while (true) {
        // Check if cancelled
        if (batchCancelled) {
            return { cancelled: true };
        }
        
        const response = await fetch(`/api/job/${jobId}`);
        const data = await response.json();
        
        if (!response.ok) {
            return { error: data.error || "Job not found" };
        }
        
        if (data.status === "complete") {
            return data.result;
        }
        
        if (data.status === "error") {
            return { error: data.error || "Analysis failed" };
        }
        
        if (data.status === "cancelled") {
            return { cancelled: true };
        }
        
        // Update progress with queue position
        if (data.status === "queued") {
            updateBatchProgress(completed, total, `Queue position: ${data.position}`);
        } else if (data.status === "processing") {
            updateBatchProgress(completed, total, "Analyzing...");
        }
        
        // Wait before polling again
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

async function cancelBatchAnalysis() {
    batchCancelled = true;
    updateBatchProgress(0, 0, "Cancelling...");
    
    // Cancel all pending jobs on server
    for (const jobId of pendingJobIds) {
        try {
            await fetch(`/api/job/${jobId}`, { method: "DELETE" });
        } catch (error) {
            console.error(`Failed to cancel job ${jobId}:`, error);
        }
    }
    
    pendingJobIds = [];
}

async function cancelPendingJobs() {
    // Cancel all pending jobs (called on page unload)
    for (const jobId of pendingJobIds) {
        try {
            // Use sendBeacon for reliability during page unload
            navigator.sendBeacon(`/api/job/${jobId}/cancel`);
        } catch (error) {
            // Fallback to fetch
            fetch(`/api/job/${jobId}`, { method: "DELETE" }).catch(() => {});
        }
    }
    pendingJobIds = [];
}

// Cancel pending jobs when page is closed/reloaded
window.addEventListener("beforeunload", () => {
    if (pendingJobIds.length > 0) {
        cancelPendingJobs();
    }
});

function updateBatchProgress(completed, total, statusText = null) {
    const percent = Math.round((completed / total) * 100);
    
    if (completed === total) {
        progressText.textContent = `Completed ${total} games!`;
    } else if (statusText) {
        progressText.textContent = `Game ${completed + 1}/${total} - ${statusText}`;
    } else {
        progressText.textContent = `Game ${completed + 1}/${total}`;
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
                    order: 3,
                    hidden: !toggleRaw.checked
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
                    order: 2,
                    hidden: !toggleMa.checked
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
                    order: 1,
                    hidden: !toggleRaw.checked
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
                    order: 0,
                    hidden: !toggleMa.checked
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

// ============ QUEUE STATUS ============

async function updateQueueStatus() {
    try {
        const response = await fetch("/api/queue/status");
        const data = await response.json();
        
        if (response.ok) {
            const count = data.queue_length || 0;
            queueCount.textContent = count;
            
            if (count > 0) {
                queueIndicator.classList.remove("hidden");
                queueIndicator.classList.add("active");
            } else {
                queueIndicator.classList.remove("active");
                queueIndicator.classList.add("hidden");
            }
        }
    } catch (error) {
        // Silently fail - queue status is not critical
    }
}

// Poll queue status every 3 seconds
setInterval(updateQueueStatus, 3000);

// Initial queue status check
updateQueueStatus();
