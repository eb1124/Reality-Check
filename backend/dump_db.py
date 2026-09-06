import sqlite3
import json
import os

db_path = os.path.join(os.path.dirname(__file__), 'data', 'verification.db')

def dump_db():
    if not os.path.exists(db_path):
        print(f"Database not found at {db_path}")
        return

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    try:
        # Check sessions table
        cursor.execute("SELECT * FROM sessions ORDER BY created_at DESC")
        rows = cursor.fetchall()
        
        print(f"Total sessions: {len(rows)}\n")
        
        for row in rows:
            print(dict(row))
            
    except Exception as e:
        print(f"Error querying DB: {e}")
    finally:
        conn.close()

if __name__ == '__main__':
    dump_db()
