from flask import Flask
from db.connection import init_db
from engine.prompts import DEFAULT_PRESETS
from db import repository as repo


def seed_presets():
    existing = repo.list_presets()
    existing_ids = {p["preset_id"] for p in existing}
    for preset in DEFAULT_PRESETS:
        if preset["preset_id"] not in existing_ids:
            repo.upsert_preset(**preset)


def create_app():
    app = Flask(__name__,
                static_folder="static",
                template_folder="templates")

    with app.app_context():
        init_db()
        seed_presets()

    from app.routes_demo import demo_bp
    from app.routes_api import api_bp
    from app.routes_admin import admin_bp

    app.register_blueprint(demo_bp)
    app.register_blueprint(api_bp, url_prefix="/api")
    app.register_blueprint(admin_bp)

    return app
