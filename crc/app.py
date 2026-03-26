import json
import mimetypes
import os
import secrets
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path

from flask import (
    Flask,
    abort,
    flash,
    g,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    url_for,
)
from werkzeug.utils import secure_filename


BASE_DIR = Path(__file__).resolve().parent

# Vercel filesystem is read-only except /tmp. Use /tmp for uploads + sqlite when deployed.
if os.environ.get("VERCEL"):
    INSTANCE_DIR = Path("/tmp") / "courseflow_instance"
    UPLOAD_DIR = Path("/tmp") / "courseflow_uploads"
else:
    INSTANCE_DIR = BASE_DIR / "instance"
    UPLOAD_DIR = BASE_DIR / "uploads"

DATABASE_PATH = INSTANCE_DIR / "course_manager.sqlite3"


app = Flask(__name__)
app.config["SECRET_KEY"] = "course-manager-secret"
app.config["DATABASE"] = DATABASE_PATH
app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024 * 250
app.config["UPLOAD_FOLDER"] = UPLOAD_DIR
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0


def ensure_directories():
    INSTANCE_DIR.mkdir(exist_ok=True)
    UPLOAD_DIR.mkdir(exist_ok=True)


@app.context_processor
def inject_static_version():
    def mtime(path: Path) -> int:
        try:
            return int(path.stat().st_mtime)
        except FileNotFoundError:
            return 0

    version = max(mtime(BASE_DIR / "static" / "style.css"), mtime(BASE_DIR / "static" / "app.js"))
    return {"static_version": version}


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_error):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def now_iso():
    return datetime.utcnow().isoformat(timespec="seconds")


def init_db():
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS courses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            pinned INTEGER NOT NULL DEFAULT 0,
            share_token TEXT UNIQUE,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS nodes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id INTEGER NOT NULL,
            parent_id INTEGER,
            type TEXT NOT NULL CHECK (type IN ('folder', 'file', 'link')),
            name TEXT NOT NULL,
            pinned INTEGER NOT NULL DEFAULT 0,
            file_path TEXT,
            file_original_name TEXT,
            mime_type TEXT,
            external_url TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
            FOREIGN KEY(parent_id) REFERENCES nodes(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS activities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id INTEGER,
            node_id INTEGER,
            action TEXT NOT NULL,
            details TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
            FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS reading_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id INTEGER NOT NULL,
            node_id INTEGER,
            seconds INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
            FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE SET NULL
        );
        """
    )
    db.execute(
        "INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)",
        ("theme", "system"),
    )
    db.commit()


def log_activity(action, course_id=None, node_id=None, details=None):
    db = get_db()
    db.execute(
        """
        INSERT INTO activities (course_id, node_id, action, details, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (course_id, node_id, action, details, now_iso()),
    )
    db.commit()


def fetchone(query, params=()):
    return get_db().execute(query, params).fetchone()


def fetchall(query, params=()):
    return get_db().execute(query, params).fetchall()


def get_theme():
    row = fetchone("SELECT value FROM settings WHERE key = 'theme'")
    return row["value"] if row else "system"


def build_tree(course_id):
    rows = fetchall(
        """
        SELECT *
        FROM nodes
        WHERE course_id = ?
        ORDER BY pinned DESC, type DESC, name COLLATE NOCASE ASC, id ASC
        """,
        (course_id,),
    )
    items = {}
    roots = []
    for row in rows:
        item = dict(row)
        item["children"] = []
        items[item["id"]] = item
    for item in items.values():
        parent_id = item["parent_id"]
        if parent_id and parent_id in items:
            items[parent_id]["children"].append(item)
        else:
            roots.append(item)
    return roots, items


def build_breadcrumb(items, active_node):
    if not active_node:
        return []
    breadcrumb = []
    current = active_node
    while current:
        breadcrumb.append(current)
        parent_id = current["parent_id"]
        current = items.get(parent_id) if parent_id else None
    breadcrumb.reverse()
    return breadcrumb


def descendants(node_map, node_id):
    collected = []
    for item in node_map.values():
        if item["parent_id"] == node_id:
            collected.append(item)
            collected.extend(descendants(node_map, item["id"]))
    return collected


def allowed_parent(parent_id, course_id):
    if parent_id is None:
        return True
    row = fetchone(
        "SELECT id FROM nodes WHERE id = ? AND course_id = ? AND type = 'folder'",
        (parent_id, course_id),
    )
    return row is not None


def get_course_or_404(course_id):
    course = fetchone("SELECT * FROM courses WHERE id = ?", (course_id,))
    if not course:
        abort(404)
    return course


def get_node_or_404(node_id):
    node = fetchone("SELECT * FROM nodes WHERE id = ?", (node_id,))
    if not node:
        abort(404)
    return node


def serialize_course(course):
    return {
        "id": course["id"],
        "name": course["name"],
        "pinned": bool(course["pinned"]),
        "share_token": course["share_token"],
        "created_at": course["created_at"],
        "updated_at": course["updated_at"],
    }


def render_course_page(course, read_only=False, active_node_id=None, shared=False):
    tree, item_map = build_tree(course["id"])
    active_node = None
    if active_node_id:
        active_node = item_map.get(active_node_id)
    breadcrumb = build_breadcrumb(item_map, active_node)
    active_branch_ids = {item["id"] for item in breadcrumb}
    siblings = []
    if active_node and active_node["type"] == "folder":
        siblings = active_node["children"]
    elif not active_node:
        siblings = tree
    recent_activities = fetchall(
        """
        SELECT action, details, created_at
        FROM activities
        WHERE course_id = ?
        ORDER BY id DESC
        LIMIT 10
        """,
        (course["id"],),
    )
    return render_template(
        "course.html",
        course=dict(course),
        tree=tree,
        active_node=active_node,
        active_branch_ids=active_branch_ids,
        breadcrumb=breadcrumb,
        root_items=tree,
        current_items=siblings,
        theme=get_theme(),
        read_only=read_only,
        shared=shared,
        activities=recent_activities,
    )


@app.context_processor
def inject_globals():
    return {"current_theme": get_theme()}


@app.route("/")
def index():
    courses = fetchall(
        """
        SELECT *,
               (SELECT COUNT(*) FROM nodes WHERE nodes.course_id = courses.id) AS item_count
        FROM courses
        ORDER BY pinned DESC, updated_at DESC, name COLLATE NOCASE ASC
        """
    )
    activity_rows = fetchall(
        """
        SELECT activities.action, activities.details, activities.created_at, courses.name AS course_name
        FROM activities
        LEFT JOIN courses ON courses.id = activities.course_id
        ORDER BY activities.id DESC
        LIMIT 12
        """
    )
    return render_template(
        "index.html",
        courses=courses,
        theme=get_theme(),
        activities=activity_rows,
    )


@app.route("/courses/<int:course_id>")
def course_view(course_id):
    course = get_course_or_404(course_id)
    active_node_id = request.args.get("node", type=int)
    if active_node_id:
        node = get_node_or_404(active_node_id)
        if node["course_id"] != course_id:
            abort(404)
        log_activity("node_opened", course_id=course_id, node_id=active_node_id, details=f'Opened "{node["name"]}"')
    return render_course_page(course, active_node_id=active_node_id)


@app.route("/shared/<token>")
def shared_course_view(token):
    course = fetchone("SELECT * FROM courses WHERE share_token = ?", (token,))
    if not course:
        abort(404)
    active_node_id = request.args.get("node", type=int)
    if active_node_id:
        node = get_node_or_404(active_node_id)
        if node["course_id"] != course["id"]:
            abort(404)
    return render_course_page(course, read_only=True, active_node_id=active_node_id, shared=True)


@app.route("/uploads/<path:relative_path>")
def uploaded_file(relative_path):
    return send_from_directory(app.config["UPLOAD_FOLDER"], relative_path, as_attachment=False)


@app.post("/api/theme")
def update_theme():
    data = request.get_json(force=True)
    theme = data.get("theme", "system")
    if theme not in {"system", "light", "dark"}:
        return jsonify({"error": "Invalid theme"}), 400
    db = get_db()
    db.execute("REPLACE INTO settings(key, value) VALUES (?, ?)", ("theme", theme))
    db.commit()
    return jsonify({"ok": True, "theme": theme})


@app.post("/api/track-reading")
def track_reading():
    data = request.get_json(force=True)
    course_id = data.get("course_id")
    node_id = data.get("node_id")
    seconds = data.get("seconds")

    try:
        course_id = int(course_id)
        node_id = int(node_id) if node_id is not None and node_id != "" else None
        seconds = int(seconds)
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid payload"}), 400

    if seconds <= 0 or seconds > 60 * 60 * 24:
        return jsonify({"error": "Invalid duration"}), 400

    # Validate course exists; node is optional (can be null for future use)
    course = fetchone("SELECT id FROM courses WHERE id = ?", (course_id,))
    if not course:
        return jsonify({"error": "Course not found"}), 404

    if node_id is not None:
        node = fetchone("SELECT id, course_id FROM nodes WHERE id = ?", (node_id,))
        if not node or node["course_id"] != course_id:
            return jsonify({"error": "Node not found"}), 404

    db = get_db()
    db.execute(
        "INSERT INTO reading_events (course_id, node_id, seconds, created_at) VALUES (?, ?, ?, ?)",
        (course_id, node_id, seconds, now_iso()),
    )
    db.commit()
    return jsonify({"ok": True})


@app.get("/api/analytics/course-time")
def analytics_course_time():
    rows = fetchall(
        """
        SELECT courses.id AS course_id,
               courses.name AS course_name,
               COALESCE(SUM(reading_events.seconds), 0) AS seconds
        FROM courses
        LEFT JOIN reading_events ON reading_events.course_id = courses.id
        GROUP BY courses.id
        ORDER BY seconds DESC, courses.name COLLATE NOCASE ASC
        """
    )
    return jsonify(
        {
            "items": [
                {"course_id": row["course_id"], "label": row["course_name"], "seconds": row["seconds"]}
                for row in rows
            ]
        }
    )


@app.get("/api/history/recent")
def recent_history():
    rows = fetchall(
        """
        SELECT activities.created_at,
               activities.course_id,
               activities.node_id,
               courses.name AS course_name,
               nodes.name AS node_name,
               nodes.type AS node_type
        FROM activities
        LEFT JOIN courses ON courses.id = activities.course_id
        LEFT JOIN nodes ON nodes.id = activities.node_id
        WHERE activities.action = 'node_opened'
        ORDER BY activities.id DESC
        LIMIT 20
        """
    )
    items = []
    for row in rows:
        if not row["node_id"] or not row["course_id"]:
            continue
        items.append(
            {
                "created_at": row["created_at"],
                "course_id": row["course_id"],
                "course_name": row["course_name"],
                "node_id": row["node_id"],
                "node_name": row["node_name"] or "Item",
                "node_type": row["node_type"] or "item",
                "href": url_for("course_view", course_id=row["course_id"], node=row["node_id"]),
            }
        )
    return jsonify({"items": items})


@app.post("/api/courses")
def create_course():
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Course name is required"}), 400
    db = get_db()
    timestamp = now_iso()
    cursor = db.execute(
        """
        INSERT INTO courses (name, created_at, updated_at)
        VALUES (?, ?, ?)
        """,
        (name, timestamp, timestamp),
    )
    db.commit()
    course_id = cursor.lastrowid
    log_activity("course_created", course_id=course_id, details=f'Created course "{name}"')
    return jsonify({"ok": True, "course_id": course_id, "redirect": url_for("course_view", course_id=course_id)})


@app.patch("/api/courses/<int:course_id>")
def update_course(course_id):
    course = get_course_or_404(course_id)
    data = request.get_json(force=True)
    updates = []
    params = []
    detail_bits = []

    if "name" in data:
        name = (data.get("name") or "").strip()
        if not name:
            return jsonify({"error": "Course name cannot be empty"}), 400
        updates.append("name = ?")
        params.append(name)
        detail_bits.append(f'Renamed to "{name}"')
    if "pinned" in data:
        pinned = 1 if data.get("pinned") else 0
        updates.append("pinned = ?")
        params.append(pinned)
        detail_bits.append("Pinned" if pinned else "Unpinned")

    if not updates:
        return jsonify({"error": "Nothing to update"}), 400

    updates.append("updated_at = ?")
    params.append(now_iso())
    params.append(course_id)

    db = get_db()
    db.execute(f"UPDATE courses SET {', '.join(updates)} WHERE id = ?", params)
    db.commit()
    log_activity("course_updated", course_id=course_id, details=", ".join(detail_bits))
    refreshed = fetchone("SELECT * FROM courses WHERE id = ?", (course_id,))
    return jsonify({"ok": True, "course": serialize_course(refreshed)})


@app.delete("/api/courses/<int:course_id>")
def delete_course(course_id):
    course = get_course_or_404(course_id)
    file_rows = fetchall(
        "SELECT file_path FROM nodes WHERE course_id = ? AND type = 'file' AND file_path IS NOT NULL",
        (course_id,),
    )
    for row in file_rows:
        file_target = app.config["UPLOAD_FOLDER"] / row["file_path"]
        if file_target.exists():
            file_target.unlink()
    db = get_db()
    db.execute("DELETE FROM courses WHERE id = ?", (course_id,))
    db.commit()
    log_activity("course_deleted", details=f'Deleted course "{course["name"]}"')
    return jsonify({"ok": True, "redirect": url_for("index")})


@app.post("/api/courses/<int:course_id>/share")
def share_course(course_id):
    course = get_course_or_404(course_id)
    token = course["share_token"] or secrets.token_urlsafe(12)
    db = get_db()
    db.execute(
        "UPDATE courses SET share_token = ?, updated_at = ? WHERE id = ?",
        (token, now_iso(), course_id),
    )
    db.commit()
    share_url = url_for("shared_course_view", token=token, _external=True)
    log_activity("course_shared", course_id=course_id, details=f'Shared course "{course["name"]}"')
    return jsonify({"ok": True, "share_url": share_url})


@app.post("/api/courses/<int:course_id>/nodes")
def create_node(course_id):
    course = get_course_or_404(course_id)
    content_type = request.content_type or ""
    parent_value = None
    name = ""
    node_type = ""

    if content_type.startswith("application/json"):
        data = request.get_json(force=True)
        parent_value = data.get("parent_id")
        name = (data.get("name") or "").strip()
        node_type = data.get("type") or ""
        external_url = (data.get("external_url") or "").strip()
        upload = None
    else:
        parent_value = request.form.get("parent_id")
        name = (request.form.get("name") or "").strip()
        node_type = request.form.get("type") or ""
        external_url = (request.form.get("external_url") or "").strip()
        upload = request.files.get("file")

    parent_id = int(parent_value) if parent_value not in (None, "") else None
    if not allowed_parent(parent_id, course_id):
        return jsonify({"error": "Invalid parent"}), 400
    if node_type not in {"folder", "file", "link"}:
        return jsonify({"error": "Invalid item type"}), 400

    db = get_db()
    timestamp = now_iso()
    file_path = None
    file_original_name = None
    mime_type = None

    if node_type == "file":
        if upload is None or not upload.filename:
            return jsonify({"error": "Please select a file to upload"}), 400
        file_original_name = secure_filename(upload.filename)
        stored_name = f"{uuid.uuid4().hex}_{file_original_name}"
        upload.save(app.config["UPLOAD_FOLDER"] / stored_name)
        file_path = stored_name
        mime_type = upload.mimetype or mimetypes.guess_type(file_original_name)[0] or "application/octet-stream"
        name = name or Path(file_original_name).stem
    elif node_type == "link":
        if not external_url:
            return jsonify({"error": "Link URL is required"}), 400
        name = name or external_url
    elif not name:
        return jsonify({"error": "Folder name is required"}), 400

    if not name:
        return jsonify({"error": "Name is required"}), 400

    cursor = db.execute(
        """
        INSERT INTO nodes (
            course_id, parent_id, type, name, pinned, file_path, file_original_name,
            mime_type, external_url, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
        """,
        (
            course_id,
            parent_id,
            node_type,
            name,
            file_path,
            file_original_name,
            mime_type,
            external_url if node_type == "link" else None,
            timestamp,
            timestamp,
        ),
    )
    db.execute("UPDATE courses SET updated_at = ? WHERE id = ?", (timestamp, course_id))
    db.commit()
    node_id = cursor.lastrowid
    log_activity(
        "item_created",
        course_id=course["id"],
        node_id=node_id,
        details=f'Created {node_type} "{name}"',
    )
    return jsonify({"ok": True, "node_id": node_id})


@app.patch("/api/nodes/<int:node_id>")
def update_node(node_id):
    node = get_node_or_404(node_id)
    data = request.get_json(force=True)
    updates = []
    params = []
    detail_bits = []

    if "name" in data:
        name = (data.get("name") or "").strip()
        if not name:
            return jsonify({"error": "Name cannot be empty"}), 400
        updates.append("name = ?")
        params.append(name)
        detail_bits.append(f'Renamed to "{name}"')
    if "pinned" in data:
        pinned = 1 if data.get("pinned") else 0
        updates.append("pinned = ?")
        params.append(pinned)
        detail_bits.append("Pinned" if pinned else "Unpinned")

    if not updates:
        return jsonify({"error": "Nothing to update"}), 400

    timestamp = now_iso()
    updates.append("updated_at = ?")
    params.append(timestamp)
    params.append(node_id)

    db = get_db()
    db.execute(f"UPDATE nodes SET {', '.join(updates)} WHERE id = ?", params)
    db.execute("UPDATE courses SET updated_at = ? WHERE id = ?", (timestamp, node["course_id"]))
    db.commit()
    log_activity(
        "item_updated",
        course_id=node["course_id"],
        node_id=node_id,
        details=", ".join(detail_bits),
    )
    return jsonify({"ok": True})


@app.delete("/api/nodes/<int:node_id>")
def delete_node(node_id):
    node = get_node_or_404(node_id)
    course_id = node["course_id"]
    tree, item_map = build_tree(course_id)
    for descendant in descendants(item_map, node_id):
        if descendant["type"] == "file" and descendant["file_path"]:
            file_target = app.config["UPLOAD_FOLDER"] / descendant["file_path"]
            if file_target.exists():
                file_target.unlink()
    if node["type"] == "file" and node["file_path"]:
        file_target = app.config["UPLOAD_FOLDER"] / node["file_path"]
        if file_target.exists():
            file_target.unlink()
    db = get_db()
    db.execute("DELETE FROM nodes WHERE id = ?", (node_id,))
    db.execute("UPDATE courses SET updated_at = ? WHERE id = ?", (now_iso(), course_id))
    db.commit()
    log_activity(
        "item_deleted",
        course_id=course_id,
        details=f'Deleted {node["type"]} "{node["name"]}"',
    )
    return jsonify({"ok": True})


@app.route("/go/<int:node_id>")
def go_to_node(node_id):
    node = get_node_or_404(node_id)
    if node["type"] == "link":
        if node["external_url"]:
            log_activity("link_opened", course_id=node["course_id"], node_id=node_id, details=f'Opened link "{node["name"]}"')
            return redirect(node["external_url"])
        abort(404)
    log_activity("item_opened", course_id=node["course_id"], node_id=node_id, details=f'Opened {node["type"]} "{node["name"]}"')
    token = request.args.get("shared")
    if token:
        return redirect(url_for("shared_course_view", token=token, node=node_id))
    return redirect(url_for("course_view", course_id=node["course_id"], node=node_id))


ensure_directories()
with app.app_context():
    init_db()


if __name__ == "__main__":
    app.run(debug=True)
