import json
import os
import time
from pathlib import Path
from urllib.parse import quote
import folder_paths
import server
from aiohttp import web
from . import logger

TAGS_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "tags"))
TRANSLATIONS_DIR = os.path.normpath(os.path.join(TAGS_DIR, "translations"))
DATA_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "data"))

def get_available_tag_files():
    """
    Scans tags/ directory for primary/extra tag CSVs,
    and tags/translations/ directory for translation CSVs.
    """
    tag_files = []
    translation_files = []
    seen = set()

    # 1. Scan primary/extra tag files in tags/ (and data/ fallback)
    for search_dir in [TAGS_DIR, DATA_DIR]:
        if os.path.exists(search_dir):
            for file in os.listdir(search_dir):
                full_path = os.path.join(search_dir, file)
                if os.path.isfile(full_path) and file.endswith(".csv") and file not in seen:
                    seen.add(file)
                    tag_files.append({
                        "filename": file,
                        "size": os.path.getsize(full_path),
                        "is_translation": False,
                    })

    # 2. Scan translation files in tags/translations/
    if os.path.exists(TRANSLATIONS_DIR):
        for file in os.listdir(TRANSLATIONS_DIR):
            full_path = os.path.join(TRANSLATIONS_DIR, file)
            if os.path.isfile(full_path) and file.endswith(".csv"):
                translation_files.append({
                    "filename": file,
                    "size": os.path.getsize(full_path),
                    "is_translation": True,
                })

    tag_files.sort(key=lambda x: x["filename"].lower())
    translation_files.sort(key=lambda x: x["filename"].lower())
    return tag_files, translation_files


def find_file_path(filename):
    """
    Locates the target file in translations, tags, or data directory, preventing directory traversal.
    """
    clean_name = os.path.basename(filename)
    for search_dir in [TRANSLATIONS_DIR, TAGS_DIR, DATA_DIR]:
        candidate = os.path.join(search_dir, clean_name)
        if os.path.exists(candidate) and os.path.isfile(candidate):
            return candidate
    return None

@server.PromptServer.instance.routes.get("/autocomplete-plus-plus/tags/list")
@server.PromptServer.instance.routes.get("/autocomplete-plus/tags/list")
async def get_tags_list(_request):
    """
    Returns list of all available tag and translation CSV files.
    """
    try:
        tag_files, translation_files = get_available_tag_files()
        tag_names = [f["filename"] for f in tag_files]
        translation_names = ["None"] + [f["filename"] for f in translation_files]

        return web.json_response({
            "success": True,
            "tags": tag_names,
            "translations": translation_names,
            "files": tag_files + translation_files
        })
    except Exception as e:
        logger.error(f"Error scanning tag files: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@server.PromptServer.instance.routes.get("/autocomplete-plus-plus/tags/file/{filename}")
@server.PromptServer.instance.routes.get("/autocomplete-plus/tags/file/{filename}")
async def get_tag_file(request):
    """
    Serves a specific tag or translation CSV/JSON file.
    """
    filename = request.match_info.get("filename", "")
    file_path = find_file_path(filename)

    if not file_path:
        logger.warning(f"Requested tag file '{filename}' was not found in tags directory.")
        return web.json_response({"error": f"File '{filename}' not found"}, status=404)

    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            count = sum(1 for line in f if line.strip() and not line.startswith("#"))
        logger.info(f"Loaded {count} tags from {filename}")
    except Exception:
        logger.info(f"Loaded {filename}")

    return web.FileResponse(file_path, headers={
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600"
    })


@server.PromptServer.instance.routes.get("/autocomplete-plus-plus/models/loras")
@server.PromptServer.instance.routes.get("/autocomplete-plus-plus/loras")
@server.PromptServer.instance.routes.get("/autocomplete-plus/models/loras")
@server.PromptServer.instance.routes.get("/autocomplete-plus/loras")
async def get_loras(_request):
    """
    Returns list of local LoRA models available in ComfyUI with exact extensions.
    """
    try:
        loras = folder_paths.get_filename_list("loras")
        return web.json_response([f.replace("\\", "/") for f in loras])
    except Exception as e:
        logger.warning(f"Could not load local LoRA models list: {e}")
        return web.json_response([], status=200)


@server.PromptServer.instance.routes.get("/autocomplete-plus-plus/models/embeddings")
@server.PromptServer.instance.routes.get("/autocomplete-plus-plus/embeddings")
@server.PromptServer.instance.routes.get("/autocomplete-plus/models/embeddings")
@server.PromptServer.instance.routes.get("/autocomplete-plus/embeddings")
async def get_embeddings(_request):
    """
    Returns list of local Embedding models available in ComfyUI with exact extensions.
    """
    try:
        embeddings = folder_paths.get_filename_list("embeddings")
        return web.json_response([f.replace("\\", "/") for f in embeddings])
    except Exception as e:
        logger.warning(f"Could not load local Embedding models list: {e}")
        return web.json_response([], status=200)


def get_wildcard_candidate_dirs(comfy_dir=None):
    if comfy_dir is None:
        comfy_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    candidate_paths = [
        os.path.join(comfy_dir, "wildcards")
    ]
    custom_nodes_dir = os.path.join(comfy_dir, "custom_nodes")
    if os.path.isdir(custom_nodes_dir):
        try:
            for entry in sorted(os.listdir(custom_nodes_dir)):
                wc_dir = os.path.join(custom_nodes_dir, entry, "wildcards")
                if os.path.isdir(wc_dir) and wc_dir not in candidate_paths:
                    candidate_paths.append(wc_dir)
        except Exception:
            pass
    wc_tags = os.path.join(TAGS_DIR, "wildcards")
    if wc_tags not in candidate_paths:
        candidate_paths.append(wc_tags)
    return candidate_paths


@server.PromptServer.instance.routes.get("/autocomplete-plus-plus/models/wildcards")
@server.PromptServer.instance.routes.get("/autocomplete-plus/models/wildcards")
async def get_wildcards(_request):
    """
    Returns list of local Wildcard files if any wildcards directory exists.
    """
    wildcards = []
    try:
        candidate_paths = get_wildcard_candidate_dirs()

        for p in candidate_paths:
            if os.path.exists(p) and os.path.isdir(p):
                for root, _, files in os.walk(p):
                    for f in files:
                        if f.endswith(".txt"):
                            rel = os.path.relpath(os.path.join(root, f), p)
                            clean = os.path.splitext(rel)[0].replace("\\", "/")
                            wildcards.append(clean)

        return web.json_response(list(set(wildcards)))
    except Exception as e:
        logger.warning(f"Could not scan wildcard files: {e}")
        return web.json_response([])


@server.PromptServer.instance.routes.get("/autocomplete-plus-plus/wildcards/all-data")
@server.PromptServer.instance.routes.get("/autocomplete-plus/wildcards/all-data")
async def get_all_wildcard_data(_request):
    """
    Returns full content map for all detected wildcards { [cleanName]: [lines] }.
    """
    result = {}
    try:
        candidate_paths = get_wildcard_candidate_dirs()

        for p in candidate_paths:
            if os.path.exists(p) and os.path.isdir(p):
                for root, _, files in os.walk(p):
                    for f in files:
                        if f.endswith(".txt"):
                            rel = os.path.relpath(os.path.join(root, f), p)
                            clean = os.path.splitext(rel)[0].replace("\\", "/")
                            full_path = os.path.join(root, f)
                            if clean not in result and os.path.isfile(full_path):
                                try:
                                    with open(full_path, "r", encoding="utf-8", errors="ignore") as file_obj:
                                        lines = [line.strip() for line in file_obj if line.strip() and not line.strip().startswith("#")]
                                    result[clean] = lines
                                except Exception as err:
                                    logger.warning(f"Error reading wildcard '{full_path}': {err}")

        return web.json_response({"success": True, "wildcards": result})
    except Exception as e:
        logger.error(f"Failed to load all wildcard data: {e}")
        return web.json_response({"success": False, "wildcards": {}, "error": str(e)}, status=500)


@server.PromptServer.instance.routes.get("/autocomplete-plus-plus/wildcards/content")
@server.PromptServer.instance.routes.get("/autocomplete-plus/wildcards/content")
async def get_wildcard_content(request):
    """
    Returns text lines inside a given wildcard file.
    """
    name = request.rel_url.query.get("name", "").strip()
    if not name:
        return web.json_response({"success": True, "lines": []})

    clean_rel = name.replace("\\", "/").strip("/")
    if not clean_rel.endswith(".txt"):
        clean_txt = clean_rel + ".txt"
    else:
        clean_txt = clean_rel

    candidate_dirs = get_wildcard_candidate_dirs() + [TAGS_DIR]

    for cdir in candidate_dirs:
        for fname in [clean_txt, clean_rel]:
            target = os.path.normpath(os.path.join(cdir, fname))
            if os.path.exists(target) and os.path.isfile(target):
                try:
                    with open(target, "r", encoding="utf-8", errors="ignore") as f:
                        lines = [line.strip() for line in f if line.strip() and not line.strip().startswith("#")]
                    return web.json_response({
                        "success": True,
                        "name": clean_rel,
                        "lines": lines
                    })
                except Exception as e:
                    logger.error(f"Error reading wildcard file '{target}': {e}")
                    return web.json_response({"success": False, "error": str(e)}, status=500)

    return web.json_response({"success": True, "name": clean_rel, "lines": []})


MODEL_EXTENSIONS = (
    ".safetensors", ".ckpt", ".pt", ".bin", ".pth", ".onnx"
)

IMAGE_EXTS = [
    ".png", ".jpg", ".jpeg", ".webp",
    ".preview.png", ".preview.jpg", ".preview.jpeg", ".preview.webp",
    ".thumb.png", ".thumb.jpg", ".thumb.webp", ".thumb.jpeg",
    ".thumbnail.png", ".thumbnail.jpg", ".thumbnail.webp",
    "_preview.png", "_preview.jpg", "_preview.webp",
    "_thumb.png", "_thumb.jpg", "_thumb.webp"
]

GENERIC_COVER_NAMES = [
    "cover", "preview", "thumbnail", "thumb", "default"
]


def strip_model_extension(name: str) -> str:
    """
    Safely strips only known model extensions without corrupting version dots (e.g. 'foo_v1.0' remains intact).
    """
    if not name:
        return ""
    clean = name.replace("\\", "/").strip("/")
    clean_lower = clean.lower()
    for ext in MODEL_EXTENSIONS:
        if clean_lower.endswith(ext):
            return clean[:-len(ext)]
    return clean


def find_image_in_directory(dir_path: str, base_names: list[str]) -> str | None:
    """
    Checks for candidate image files in a directory using direct checks and case-insensitive scanning.
    """
    if not os.path.isdir(dir_path):
        return None

    # 1. Direct fast-path check
    for base in base_names:
        for ext in IMAGE_EXTS:
            cand = os.path.join(dir_path, base + ext)
            if os.path.isfile(cand) and os.path.getsize(cand) > 0:
                return cand

    # 2. Case-insensitive directory scan
    try:
        entries = os.listdir(dir_path)
    except Exception:
        return None

    lower_map = {f.lower(): f for f in entries if os.path.isfile(os.path.join(dir_path, f))}

    # Try matching specific base names with all image extensions
    for base in base_names:
        base_l = base.lower()
        for ext in IMAGE_EXTS:
            target_l = (base_l + ext).lower()
            if target_l in lower_map:
                full_p = os.path.join(dir_path, lower_map[target_l])
                if os.path.getsize(full_p) > 0:
                    return full_p

    # Try generic cover names if the directory itself is a dedicated model folder
    for gen in GENERIC_COVER_NAMES:
        for ext in [".png", ".jpg", ".jpeg", ".webp"]:
            target_l = (gen + ext).lower()
            if target_l in lower_map:
                full_p = os.path.join(dir_path, lower_map[target_l])
                if os.path.getsize(full_p) > 0:
                    return full_p

    return None


_thumbnail_cache: dict[tuple[str, str], str | None] = {}


def find_model_thumbnail(folder_type: str, model_name: str) -> str | None:
    """
    Finds preview/thumbnail image for a given model (loras or embeddings).
    Cached in memory to reduce filesystem lookups.
    """
    if not model_name:
        return None

    cache_key = (folder_type, model_name.lower().replace("\\", "/").strip("/"))
    if cache_key in _thumbnail_cache:
        cached = _thumbnail_cache[cache_key]
        if cached is None:
            return None
        if os.path.isfile(cached):
            return cached
        del _thumbnail_cache[cache_key]

    clean_name = strip_model_extension(model_name)
    base_filename = os.path.basename(clean_name)
    clean_name_lower = clean_name.lower()
    base_filename_lower = base_filename.lower()

    # 1. Direct path lookup from ComfyUI folder_paths
    try:
        full_p = folder_paths.get_full_path(folder_type, model_name)
        if full_p and os.path.isfile(full_p):
            model_dir = os.path.dirname(full_p)
            model_base = strip_model_extension(os.path.basename(full_p))
            search_bases = [model_base, base_filename, os.path.basename(model_dir)]
            found = find_image_in_directory(model_dir, search_bases)
            if found:
                _thumbnail_cache[cache_key] = found
                return found
    except Exception:
        pass

    # 2. Match against known ComfyUI model files list
    try:
        known_files = folder_paths.get_filename_list(folder_type)
    except Exception:
        known_files = []

    for rel_f in known_files:
        rel_clean = strip_model_extension(rel_f.replace("\\", "/"))
        rel_clean_lower = rel_clean.lower()
        base_clean_lower = os.path.basename(rel_clean_lower)

        if rel_clean_lower == clean_name_lower or base_clean_lower == base_filename_lower:
            full_model_p = folder_paths.get_full_path(folder_type, rel_f)
            if full_model_p and os.path.exists(full_model_p):
                model_dir = os.path.dirname(full_model_p)
                model_base = strip_model_extension(os.path.basename(full_model_p))
                parent_dir_name = os.path.basename(model_dir)

                search_bases = [
                    model_base,
                    model_base + ".safetensors",
                    model_base + ".ckpt",
                    model_base + ".pt",
                    base_filename,
                    parent_dir_name
                ]
                seen_b = set()
                unique_search_bases = [b for b in search_bases if b and not (b.lower() in seen_b or seen_b.add(b.lower()))]

                found = find_image_in_directory(model_dir, unique_search_bases)
                if found:
                    _thumbnail_cache[cache_key] = found
                    return found

    _thumbnail_cache[cache_key] = None
    return None


@server.PromptServer.instance.routes.get("/autocomplete-plus-plus/models/thumbnail")
@server.PromptServer.instance.routes.get("/autocomplete-plus/models/thumbnail")
async def get_model_thumbnail(request):
    """
    Serves thumbnail image for LoRA or Embedding models if available,
    or returns thumbnail metadata/probe if info=1 is requested.
    """
    folder_type = request.rel_url.query.get("type", "loras").strip()
    name = request.rel_url.query.get("name", "").strip()
    is_info = request.rel_url.query.get("info", "").strip() == "1"

    if folder_type not in ["loras", "embeddings"] or not name:
        if is_info:
            return web.json_response({"has_thumbnail": False, "url": ""})
        return web.json_response({"error": "Invalid parameters"}, status=400)

    image_path = find_model_thumbnail(folder_type, name)
    has_image = bool(image_path and os.path.exists(image_path))

    if is_info:
        if has_image:
            url = f"/autocomplete-plus-plus/models/thumbnail?type={folder_type}&name={quote(name)}"
            return web.json_response({"has_thumbnail": True, "url": url})
        else:
            return web.json_response({"has_thumbnail": False, "url": ""})

    if not has_image:
        return web.json_response({"error": "Thumbnail not found"}, status=404)

    ext = os.path.splitext(image_path)[1].lower()
    content_type = "image/png"
    if ext in [".jpg", ".jpeg"]:
        content_type = "image/jpeg"
    elif ext == ".webp":
        content_type = "image/webp"

    return web.FileResponse(image_path, headers={
        "Content-Type": content_type,
        "Cache-Control": "public, max-age=86400"
    })

@server.PromptServer.instance.routes.get("/autocomplete-plus-plus/open-in-lm")
@server.PromptServer.instance.routes.get("/autocomplete-plus/open-in-lm")
async def open_in_lora_manager(_request):
    html = """
    <!doctype html>
    <html><head><meta charset="utf-8"></head>
    <body><script>
      (function () {
        var qs = new URLSearchParams(location.search);
        var list = [];
        var single = qs.get("hash");
        var multi  = qs.get("hashes");
        list = (multi !== null ? multi : (single || "")).split(",");
        list = list.map(function (h) { return h.trim().toLowerCase(); }).filter(Boolean);

        if (list.length === 1) {
          sessionStorage.setItem("lora_manager_recipe_to_lora_filterLoraHash", list[0]);
        } else if (list.length > 1) {
          sessionStorage.setItem("lora_manager_recipe_to_lora_filterLoraHashes", JSON.stringify(list));
        }
        sessionStorage.setItem("lora_manager_filterRecipeName", "Autocomplete++");
        location.replace("/loras");
      })();
    </script></body></html>
    """
    return web.Response(text=html, content_type="text/html")


# User data persistence storage
USER_DATA_FILE = os.path.join(DATA_DIR, "user_data.json")

def _read_user_data():
    if not os.path.exists(USER_DATA_FILE):
        return {
            "version": 1,
            "last_updated_usage": 0,
            "last_updated_settings": 0,
            "settings": {},
            "tag_usage": {}
        }
    try:
        with open(USER_DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                return {
                    "version": data.get("version", 1),
                    "last_updated_usage": data.get("last_updated_usage", 0),
                    "last_updated_settings": data.get("last_updated_settings", 0),
                    "settings": data.get("settings", {}) if isinstance(data.get("settings"), dict) else {},
                    "tag_usage": data.get("tag_usage", {}) if isinstance(data.get("tag_usage"), dict) else {}
                }
    except Exception as e:
        logger.error(f"[Autocomplete++] Error reading user_data.json: {e}")
    return {
        "version": 1,
        "last_updated_usage": 0,
        "last_updated_settings": 0,
        "settings": {},
        "tag_usage": {}
    }

def _write_user_data(data):
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        tmp_file = USER_DATA_FILE + ".tmp"
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp_file, USER_DATA_FILE)
        return True
    except Exception as e:
        logger.error(f"[Autocomplete++] Error writing user_data.json: {e}")
        return False

@server.PromptServer.instance.routes.get("/autocomplete-plus-plus/user-data")
@server.PromptServer.instance.routes.get("/autocomplete-plus/user-data")
async def get_user_data(_request):
    data = _read_user_data()
    return web.json_response({"success": True, "data": data})

@server.PromptServer.instance.routes.post("/autocomplete-plus-plus/user-data")
@server.PromptServer.instance.routes.post("/autocomplete-plus/user-data")
async def post_user_data(request):
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"success": False, "error": "Invalid JSON"}, status=400)

    if not isinstance(payload, dict):
        return web.json_response({"success": False, "error": "Payload must be object"}, status=400)

    action = payload.get("action", "")
    current = _read_user_data()
    now_ts = int(time.time() * 1000)

    if action == "save_settings":
        incoming_settings = payload.get("settings", {})
        if isinstance(incoming_settings, dict):
            current["settings"].update(incoming_settings)
            current["last_updated_settings"] = payload.get("timestamp", now_ts)
            _write_user_data(current)
            return web.json_response({"success": True, "data": current})

    elif action == "save_usage":
        incoming_usage = payload.get("tag_usage", {})
        if isinstance(incoming_usage, dict):
            current["tag_usage"] = incoming_usage
            current["last_updated_usage"] = payload.get("timestamp", now_ts)
            _write_user_data(current)
            return web.json_response({"success": True, "data": current})

    elif action == "clear_usage":
        current["tag_usage"] = {}
        current["last_updated_usage"] = payload.get("timestamp", now_ts)
        _write_user_data(current)
        return web.json_response({"success": True, "data": current})

    elif action == "save_all":
        if "settings" in payload and isinstance(payload["settings"], dict):
            current["settings"] = payload["settings"]
            current["last_updated_settings"] = payload.get("timestamp", now_ts)
        if "tag_usage" in payload and isinstance(payload["tag_usage"], dict):
            current["tag_usage"] = payload["tag_usage"]
            current["last_updated_usage"] = payload.get("timestamp", now_ts)
        _write_user_data(current)
        return web.json_response({"success": True, "data": current})

    return web.json_response({"success": False, "error": f"Unknown action: {action}"}, status=400)