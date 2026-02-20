"""
Flask web application for Elo Estimator.
Allows users to fetch their Lichess games and get AI-powered Elo predictions.
"""

import os
import sys
import io
import tempfile
from flask import Flask, render_template, jsonify, request

import requests
import chess.pgn
import chess.engine
import torch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from elo_ai.models import complex_network
from elo_ai.helper_functions import game_analysis, position_converters
from elo_ai.helper_functions.elo_range import get_elo_prediction, get_rating_ranges
from elo_ai.helper_functions.get_device import get_device

import db

app = Flask(__name__)

device = get_device()
MODEL = None
ENGINE_PATH = "/usr/bin/stockfish"


def load_model():
    """Load the trained LSTM model."""
    global MODEL
    if MODEL is None:
        input_size = 17
        channels = 2
        classes = len(get_rating_ranges())
        MODEL = complex_network.EloGuesser(input_size, input_channels=channels, num_classes=classes)
        model_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 
                                   "elo_ai/models/rating_ranges/boards_mirrors.pt")
        MODEL.load_state_dict(torch.load(model_path, map_location=device))
        MODEL.eval()
    return MODEL


@app.route("/")
def index():
    """Serve the main page."""
    return render_template("index.html")


@app.route("/api/games/<username>")
def get_games(username):
    """Fetch recent games for a Lichess user."""
    max_games = request.args.get("max", 20, type=int)
    variant = request.args.get("variant", "standard")
    time_control = request.args.get("time_control", "all")
    until = request.args.get("until", None, type=int)
    
    # Build perfType parameter based on filters
    if variant == "chess960":
        perf_type = "chess960"
        # Fetch more games if filtering by specific time control (to ensure we get enough matches)
        fetch_max = max_games * 5 if time_control != "all" else max_games
    elif time_control == "all":
        perf_type = "ultraBullet,bullet,blitz,rapid,classical,correspondence"
        fetch_max = max_games
    else:
        perf_type = time_control
        fetch_max = max_games
    
    # Fetch extra to determine if there are more games
    fetch_max += 1
    
    url = f"https://lichess.org/api/games/user/{username}"
    headers = {"Accept": "application/x-chess-pgn"}
    params = {
        "max": fetch_max,
        "pgnInJson": False,
        "clocks": False,
        "evals": False,
        "opening": True,
        "perfType": perf_type,
    }
    
    if until:
        params["until"] = until
    
    try:
        response = requests.get(url, headers=headers, params=params, timeout=30)
        if response.status_code == 404:
            return jsonify({"error": "User not found"}), 404
        response.raise_for_status()
    except requests.RequestException as e:
        return jsonify({"error": str(e)}), 500
    
    pgn_text = response.text
    games = []
    pgn_io = io.StringIO(pgn_text)
    
    while True:
        game = chess.pgn.read_game(pgn_io)
        if game is None:
            break
        
        headers = game.headers
        moves = list(game.mainline_moves())
        
        # Skip games with 5 or fewer moves
        if len(moves) <= 5:
            continue
        
        # Parse timestamp for pagination
        utc_date = headers.get("UTCDate", "")
        utc_time = headers.get("UTCTime", "00:00:00")
        game_timestamp = None
        if utc_date:
            try:
                from datetime import datetime
                dt = datetime.strptime(f"{utc_date} {utc_time}", "%Y.%m.%d %H:%M:%S")
                game_timestamp = int(dt.timestamp() * 1000)
            except:
                pass
        
        games.append({
            "id": headers.get("Site", "").split("/")[-1],
            "white": headers.get("White", "Unknown"),
            "black": headers.get("Black", "Unknown"),
            "white_elo": headers.get("WhiteElo", "?"),
            "black_elo": headers.get("BlackElo", "?"),
            "result": headers.get("Result", "*"),
            "date": headers.get("UTCDate", ""),
            "time_control": headers.get("TimeControl", ""),
            "opening": headers.get("Opening", "Unknown"),
            "num_moves": len(moves),
            "pgn": str(game),
            "timestamp": game_timestamp,
        })
    
    # Filter Chess960 games by specific time control if requested
    if variant == "chess960" and time_control == "15+10":
        games = [g for g in games if g["time_control"] == "900+10"]
    
    # Check if there are more games (we fetched max+1)
    requested_max = max_games - 1  # We added 1 earlier
    has_more = len(games) > requested_max
    
    # Limit to requested max after filtering
    games = games[:requested_max]
    
    # Get oldest game timestamp for pagination
    oldest_time = None
    if games:
        oldest_time = games[-1].get("timestamp")
    
    # Check database for cached analyses
    game_ids = [g["id"] for g in games]
    cached = db.get_cached_analyses(game_ids)
    
    # Add cached predictions to games
    for game in games:
        if game["id"] in cached:
            game["cached_white_elo"] = cached[game["id"]]["white_elo"]
            game["cached_black_elo"] = cached[game["id"]]["black_elo"]
    
    return jsonify({
        "games": games,
        "username": username,
        "has_more": has_more,
        "oldest_time": oldest_time
    })


@app.route("/api/analyze", methods=["POST"])
def analyze_game_endpoint():
    """Analyze a game and return Elo predictions."""
    data = request.get_json()
    pgn_text = data.get("pgn")
    game_id = data.get("game_id")
    
    if not pgn_text:
        return jsonify({"error": "No PGN provided"}), 400
    
    # Check cache first if game_id provided
    if game_id:
        cached = db.get_cached_analysis(game_id)
        if cached:
            # Return cached result (without progression data - need to recompute for display)
            # But we still need to run analysis for the charts
            pass  # Fall through to full analysis for charts
    
    try:
        pgn_io = io.StringIO(pgn_text)
        game = chess.pgn.read_game(pgn_io)
        
        if game is None:
            return jsonify({"error": "Invalid PGN"}), 400
        
        moves = list(game.mainline_moves())
        if len(moves) < 5:
            return jsonify({"error": "Game too short (minimum 5 moves)"}), 400
        
        # Extract game_id from PGN if not provided
        if not game_id:
            game_id = game.headers.get("Site", "").split("/")[-1]
        
        # Check cache - if we have cached elo, we still need to run analysis for charts
        cached = db.get_cached_analysis(game_id) if game_id else None
        
        engine = chess.engine.SimpleEngine.popen_uci(ENGINE_PATH)
        
        try:
            analysis = game_analysis.analyze_game(game, engine, progress_bar=False, time_limit=0.1)
            
            func = position_converters.fen_to_board_mirror
            positions, _elo = position_converters.convert_position(game, func)
            
            model = load_model()
            predictions = get_sequential_predictions(model, positions.to(device), analysis.to(device))
            
            final_pred = predictions[-1]
            white_elo = get_elo_prediction(final_pred[0], is_chessdotcom=False, round=True)[0]
            black_elo = get_elo_prediction(final_pred[1], is_chessdotcom=False, round=True)[0]
            
            # Save to database
            if game_id:
                db.save_analysis(game_id, white_elo, black_elo)
            
        finally:
            engine.close()
        
        return jsonify({
            "white_elo": white_elo,
            "black_elo": black_elo,
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def get_sequential_predictions(model, positions, analysis):
    """Get predictions for each move in the game."""
    c, h = None, None
    moves = analysis.size(1)
    
    predictions = []
    for move in range(moves):
        pos = positions[:, move].unsqueeze(1)
        evaluation = analysis[:, move].unsqueeze(1)
        prediction, (h, c) = model((pos, evaluation), h, c)
        predictions.append(prediction.detach().cpu())
    
    return predictions


if __name__ == "__main__":
    print("Loading model...")
    load_model()
    print("Model loaded! Starting server...")
    app.run(debug=True, host="127.0.0.1", port=5000)
