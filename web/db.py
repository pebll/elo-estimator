"""
SQLite database module for caching game analysis results.
"""

import sqlite3
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "elo_estimator.db")


def get_connection():
    """Get a database connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Initialize the database schema."""
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS game_analysis (
            game_id TEXT PRIMARY KEY,
            white_elo INTEGER NOT NULL,
            black_elo INTEGER NOT NULL,
            analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    conn.commit()
    conn.close()


def get_cached_analysis(game_id):
    """
    Look up a cached analysis by game ID.
    Returns dict with white_elo, black_elo or None if not found.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute(
        "SELECT white_elo, black_elo, analyzed_at FROM game_analysis WHERE game_id = ?",
        (game_id,)
    )
    
    row = cursor.fetchone()
    conn.close()
    
    if row:
        return {
            "white_elo": row["white_elo"],
            "black_elo": row["black_elo"],
            "analyzed_at": row["analyzed_at"]
        }
    return None


def get_cached_analyses(game_ids):
    """
    Look up multiple cached analyses by game IDs.
    Returns dict mapping game_id to analysis data.
    """
    if not game_ids:
        return {}
    
    conn = get_connection()
    cursor = conn.cursor()
    
    placeholders = ",".join("?" * len(game_ids))
    cursor.execute(
        f"SELECT game_id, white_elo, black_elo FROM game_analysis WHERE game_id IN ({placeholders})",
        game_ids
    )
    
    results = {}
    for row in cursor.fetchall():
        results[row["game_id"]] = {
            "white_elo": row["white_elo"],
            "black_elo": row["black_elo"]
        }
    
    conn.close()
    return results


def save_analysis(game_id, white_elo, black_elo):
    """
    Save an analysis result to the database.
    Uses INSERT OR REPLACE to handle duplicates.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute(
        """
        INSERT OR REPLACE INTO game_analysis (game_id, white_elo, black_elo, analyzed_at)
        VALUES (?, ?, ?, ?)
        """,
        (game_id, white_elo, black_elo, datetime.now().isoformat())
    )
    
    conn.commit()
    conn.close()


def get_stats():
    """Get database statistics."""
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT COUNT(*) as count FROM game_analysis")
    count = cursor.fetchone()["count"]
    
    conn.close()
    return {"total_cached": count}


# Initialize database on module import
init_db()
