// Elo Estimator Frontend Application

let currentGames = [];
let currentUsername = "";

// DOM Elements
const usernameInput = document.getElementById("username-input");
const searchBtn = document.getElementById("search-btn");
const errorMessage = document.getElementById("error-message");
const gamesSection = document.getElementById("games-section");
const gamesList = document.getElementById("games-list");
const displayUsername = document.getElementById("display-username");
const loadingOverlay = document.getElementById("loading-overlay");
const loadingText = document.getElementById("loading-text");
const variantFilter = document.getElementById("variant-filter");
const timeFilter = document.getElementById("time-filter");

// Event Listeners
searchBtn.addEventListener("click", searchGames);
usernameInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") searchGames();
});
variantFilter.addEventListener("change", onVariantChange);
timeFilter.addEventListener("change", onFilterChange);

function onVariantChange() {
    // Update time control options based on variant
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
    
    // Re-search if we already have a username
    if (currentUsername) {
        searchGames();
    }
}

function onFilterChange() {
    // Re-search if we already have a username
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

    const variant = variantFilter.value;
    const timeControl = timeFilter.value;

    try {
        const params = new URLSearchParams({
            max: 20,
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
        return;
    }

    currentGames.forEach((game, index) => {
        const gameCard = createGameCard(game, index);
        gamesList.appendChild(gameCard);
    });

    gamesSection.classList.remove("hidden");
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
    
    // Determine if current user is white or black
    const isUserWhite = game.white.toLowerCase() === currentUsername.toLowerCase();
    
    // Build prediction display (user's ELO bold on left, opponent on right)
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
            ${isAnalyzed ? '<span class="analyzed-badge">✓</span>' : '<span class="analyze-hint">Click to analyze</span>'}
        </div>
        ${predictionHtml}
    `;

    return card;
}

async function analyzeGame(index) {
    const game = currentGames[index];
    
    // Skip if already analyzed
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

        // Update game data with cached predictions
        game.cached_white_elo = data.white_elo;
        game.cached_black_elo = data.black_elo;

        // Re-render just this card
        const oldCard = document.getElementById(`game-card-${index}`);
        const newCard = createGameCard(game, index);
        oldCard.replaceWith(newCard);
        
    } catch (error) {
        showError(error.message);
    } finally {
        hideLoading();
    }
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
