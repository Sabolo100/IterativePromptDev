#!/usr/bin/env python3
from dotenv import load_dotenv
load_dotenv()

from app.main import create_app
from config import PORT

app = create_app()

if __name__ == "__main__":
    app.run(debug=True, port=PORT, threaded=True)
