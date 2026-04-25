"""
index.py — Índice em memória de todos os arquivos .md em docs/.

Populado em DocsConfig.ready(). Cada entrada resolve título, tags,
nível de acesso e permissão Django a partir da convenção de path:

    docs/user/{app}/file.md              → qualquer perm em {app}
    docs/user/{app}/{model}/file.md      → qualquer perm sobre {app}.{model}
    docs/user/{app}/{model}/{action}/    → perm exata {app}.{action}_{model}
    docs/{qualquer-outra-coisa}/         → doc_level = 'staff'

Ações reconhecidas como verbos Django: add, change, delete, view.
"""

import re
from pathlib import Path

import frontmatter
from django.conf import settings

DOCS_DIR = settings.BASE_DIR / "docs"
DJANGO_ACTIONS = {"add", "change", "delete", "view"}

DOC_INDEX: dict[str, dict] = {}


def build_index() -> None:
    DOC_INDEX.clear()
    for md_file in sorted(DOCS_DIR.rglob("*.md")):
        rel = md_file.relative_to(DOCS_DIR)
        parts = list(rel.parts)

        # Ignora arquivos sem conteúdo relevante
        if md_file.stat().st_size == 0:
            continue

        slug = str(rel.with_suffix(""))

        try:
            post = frontmatter.load(str(md_file))
        except Exception:
            continue

        title = (
            post.metadata.get("title")
            or _extract_h1(post.content)
            or md_file.stem.replace("-", " ").replace("_", " ").title()
        )
        tags = list(post.metadata.get("tags", []))
        excerpt = _make_excerpt(post.content)

        access, required_perm, app_required, model_required = _resolve_access(parts)

        DOC_INDEX[slug] = {
            "title": title,
            "tags": tags,
            "access": access,
            "required_perm": required_perm,   # ex: "pessoal.add_escala" ou None
            "app_required": app_required,      # ex: "pessoal" ou None
            "model_required": model_required,  # ex: "escala" ou None
            "excerpt": excerpt,
            "path": str(md_file),
        }


def can_access(user, entry: dict) -> bool:
    if entry["access"] == "staff":
        profile = getattr(user, "profile", None)
        return profile is not None and profile.doc_level == "staff"

    if perm := entry.get("required_perm"):
        return user.has_perm(perm)

    if model := entry.get("model_required"):
        app = entry.get("app_required", "")
        return any(
            p.startswith(f"{app}.") and f"_{model}" in p
            for p in user.get_all_permissions()
        )

    if app := entry.get("app_required"):
        return any(p.startswith(f"{app}.") for p in user.get_all_permissions())

    return user.is_authenticated


def visible_for(user) -> dict[str, dict]:
    return {slug: e for slug, e in DOC_INDEX.items() if can_access(user, e)}


# ---------------------------------------------------------------------------
# Helpers internos
# ---------------------------------------------------------------------------

def _resolve_access(parts: list[str]):
    """
    Retorna (access, required_perm, app_required, model_required).
    parts inclui o nome do arquivo com extensão como último elemento.
    """
    if not parts or parts[0] != "user":
        return "staff", None, None, None

    # dir_parts: segmentos após 'user/', sem o filename
    dir_parts = parts[1:-1]  # ex: ['pessoal', 'escala', 'add']

    if not dir_parts:
        # docs/user/file.md → qualquer usuário autenticado
        return "user", None, None, None

    app = dir_parts[0]

    if len(dir_parts) == 1:
        # docs/user/{app}/file.md
        return "user", None, app, None

    if len(dir_parts) >= 3 and dir_parts[-1] in DJANGO_ACTIONS:
        # docs/user/{app}/{model}/{action}/file.md
        model = dir_parts[-2]
        action = dir_parts[-1]
        return "user", f"{app}.{action}_{model}", app, model

    # docs/user/{app}/{model}/file.md (sem action)
    model = dir_parts[-1]
    return "user", None, app, model


def _extract_h1(text: str) -> str:
    m = re.search(r"^#\s+(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _make_excerpt(text: str, length: int = 200) -> str:
    clean = re.sub(r"^#+\s+.+$", "", text, flags=re.MULTILINE)  # remove headings
    clean = re.sub(r"[`*_\[\]()>#\-]", "", clean)
    clean = re.sub(r"\s+", " ", clean).strip()
    return clean[:length].rstrip()
