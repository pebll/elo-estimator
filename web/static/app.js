// Elo Estimator Frontend Application

let currentGames = [];
let currentUsername = "";
let charts = {};

// DOM Elements
const usernameInput = document.getElementById("username-input");
const searchBtn = document.getElementById("search-btn");
const errorMessage = document.getElementById("error-message");
const gamesSection = document.getElementById("games-section");
const gamesList = document.getElementById("games-list");
const displayUsername = document.getElementById("display-username");
const analysisSection = document.getElementById("analysis-section");
const backBtn = document.getElementById("back-btn");
const loadingOverlay = document.getElementById("loading-overlay");
const loadingText = document.getElementById("loading-text");

// Event Listeners
searchBtn.addEventListener("click", searchGames);
usernameInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") searchGames();
});
backBtn.addEventListener("click", showGamesList);

async function searchGames() {
    const username = usernameInput.value.trim();
    if (!username) {
        showError("Please enter a username");
        return;
    }

    hideError();
    showLoading("Fetching games from Lichess...");

    try {
        const response = await fetch(`/api/games/${encodeURIComponent(username)}?max=20`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Failed to fetch games");
        }

        currentGames = data.games;
        currentUsername = data.username;
        displayGames();
    } catch (error) {
        showError(error.message);
    } finally {
        hideLoading();
    }
}

function displayGames() {
    displayUsername.textContent = currentUsername;
    gamesList.innerHTML = "";

    if (currentGames.length === 0) {
        gamesList.innerHTML = '<p class="no-games">No games found for this user</p>';
        gamesSection.classList.remove("hidden");
        analysisSection.classList.add("hidden");
        return;
    }

    currentGames.forEach((game, index) => {
        const gameCard = createGameCard(game, index);
        gamesList.appendChild(gameCard);
    });

    gamesSection.classList.remove("hidden");
    analysisSection.classList.add("hidden");
}

function createGameCard(game, index) {
    const card = document.createElement("div");
    card.className = "game-card";
    card.onclick = () => analyzeGame(index);

    const resultClass = getResultClass(game.result, game.white, currentUsername);
    const timeControl = formatTimeControl(game.time_control);

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
        <div class="game-moves">${game.num_moves} moves</div>
        <div class="analyze-hint">Click to analyze</div>
    `;

    return card;
}

async function analyzeGame(index) {
    const game = currentGames[index];
    
    showLoading("Analyzing game with Stockfish...");
    
    try {
        const response = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pgn: game.pgn })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Analysis failed");
        }

        displayAnalysis(game, data);
    } catch (error) {
        showError(error.message);
    } finally {
        hideLoading();
    }
}

function displayAnalysis(game, analysis) {
    gamesSection.classList.add("hidden");
    analysisSection.classList.remove("hidden");

    // Game info
    document.getElementById("game-info").innerHTML = `
        <span class="info-item"><strong>${escapeHtml(game.white)}</strong> vs <strong>${escapeHtml(game.black)}</strong></span>
        <span class="info-item">${escapeHtml(game.opening)}</span>
        <span class="info-item">${formatDate(game.date)}</span>
        <span class="info-item">${formatResult(game.result)}</span>
    `;

    // Predictions
    document.getElementById("white-elo").textContent = analysis.white_elo;
    document.getElementById("black-elo").textContent = analysis.black_elo;
    document.getElementById("white-actual").textContent = `Actual: ${game.white_elo}`;
    document.getElementById("black-actual").textContent = `Actual: ${game.black_elo}`;

    // Color predictions based on accuracy
    colorPrediction("white-elo", analysis.white_elo, parseInt(game.white_elo) || 0);
    colorPrediction("black-elo", analysis.black_elo, parseInt(game.black_elo) || 0);

    // Draw charts
    drawProgressionChart("white-progression-chart", analysis.white_progression, "White", "#f0d9b5");
    drawProgressionChart("black-progression-chart", analysis.black_progression, "Black", "#b58863");
    drawDistributionChart("white-distribution-chart", analysis.white_probabilities[analysis.white_probabilities.length - 1], analysis.rating_ranges, "#f0d9b5");
    drawDistributionChart("black-distribution-chart", analysis.black_probabilities[analysis.black_probabilities.length - 1], analysis.rating_ranges, "#b58863");
}

function colorPrediction(elementId, predicted, actual) {
    const element = document.getElementById(elementId);
    const diff = Math.abs(predicted - actual);
    
    if (actual === 0 || isNaN(actual)) {
        element.classList.add("neutral");
    } else if (diff <= 100) {
        element.classList.add("excellent");
    } else if (diff <= 200) {
        element.classList.add("good");
    } else if (diff <= 300) {
        element.classList.add("fair");
    } else {
        element.classList.add("poor");
    }
}

function drawProgressionChart(canvasId, data, label, color) {
    const ctx = document.getElementById(canvasId).getContext("2d");
    
    if (charts[canvasId]) {
        charts[canvasId].destroy();
    }

    const labels = data.map((_, i) => `Move ${i + 1}`);

    charts[canvasId] = new Chart(ctx, {
        type: "line",
        data: {
            labels: labels,
            datasets: [{
                label: `${label} Predicted Elo`,
                data: data,
                borderColor: color,
                backgroundColor: color + "40",
                fill: true,
                tension: 0.3,
                pointRadius: 2,
                pointHoverRadius: 5,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: "#bababa" }
                }
            },
            scales: {
                x: {
                    ticks: { color: "#bababa", maxTicksLimit: 10 },
                    grid: { color: "#404040" }
                },
                y: {
                    ticks: { color: "#bababa" },
                    grid: { color: "#404040" },
                    suggestedMin: 800,
                    suggestedMax: 2400
                }
            }
        }
    });
}

function drawDistributionChart(canvasId, data, ratingRanges, color) {
    const ctx = document.getElementById(canvasId).getContext("2d");
    
    if (charts[canvasId]) {
        charts[canvasId].destroy();
    }

    const labels = ratingRanges.filter((_, i) => i % 4 === 0).map(r => r.toString());
    const filteredData = data.filter((_, i) => i % 4 === 0);

    charts[canvasId] = new Chart(ctx, {
        type: "bar",
        data: {
            labels: ratingRanges.map(r => r.toString()),
            datasets: [{
                label: "Probability",
                data: data,
                backgroundColor: color + "80",
                borderColor: color,
                borderWidth: 1,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: "#bababa" }
                }
            },
            scales: {
                x: {
                    ticks: { 
                        color: "#bababa",
                        maxTicksLimit: 10,
                        callback: function(value, index) {
                            return index % 5 === 0 ? ratingRanges[index] : '';
                        }
                    },
                    grid: { color: "#404040" }
                },
                y: {
                    ticks: { color: "#bababa" },
                    grid: { color: "#404040" },
                    beginAtZero: true
                }
            }
        }
    });
}

function showGamesList() {
    gamesSection.classList.remove("hidden");
    analysisSection.classList.add("hidden");
}

// Utility functions
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
