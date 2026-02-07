import json
import logging
import os
import re
from typing import Any
from uuid import UUID

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from app.db import get_conn
from app.schemas import (
    BasicResponse,
    CreatePayload,
    IdResponse,
    ImportByPathPayload,
    ImportResponse,
    ImportTemplateItem,
    MovePayload,
    RenamePayload,
    SectionNode,
)

app = FastAPI(title="TOC API")
TOC_JSON_PATH = os.getenv("TOC_JSON_PATH", "study_template.json")
logger = logging.getLogger(__name__)
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def build_tree(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    nodes = {}
    roots = []

    for r in rows:
        node = {
            "id": str(r["id"]),
            "parent_id": str(r["parent_id"]) if r["parent_id"] else None,
            "section_key": r["section_key"],
            "name": r["name"],
            "is_leaf": r["is_leaf"],
            "order": r["order"],
            "children": [],
        }
        nodes[node["id"]] = node

    for n in nodes.values():
        if n["parent_id"] is None:
            roots.append(n)
        else:
            parent = nodes.get(n["parent_id"])
            if parent:
                parent["children"].append(n)

    def sort_nodes(items):
        items.sort(key=lambda x: x["order"])
        for i in items:
            sort_nodes(i["children"])

    sort_nodes(roots)
    return roots


def normalize_template_items(raw_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    sibling_counts: dict[str, int] = {}
    generated_key_counts: dict[str, int] = {}

    for raw in raw_items:
        section_key = (raw.get("section_key") or raw.get("section_id") or "").strip()
        name = (raw.get("name") or raw.get("section_title") or "").strip()
        if not name:
            raise HTTPException(
                status_code=400,
                detail="Each section must include name/section_title",
            )

        # Support unnumbered sections (e.g., "Preface") by generating a stable functional key.
        generated_key = False
        if not section_key:
            generated_key = True
            base_slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "untitled"
            generated_key_counts[base_slug] = generated_key_counts.get(base_slug, 0) + 1
            suffix = generated_key_counts[base_slug]
            section_key = f"u.{base_slug}" if suffix == 1 else f"u.{base_slug}.{suffix}"

        parent_key = raw.get("parent_key")
        if parent_key is None and "." in section_key and not generated_key:
            parent_key = section_key.rsplit(".", 1)[0]

        order = raw.get("order")
        if order is None:
            sibling_bucket = parent_key if parent_key is not None else "__ROOT__"
            sibling_counts[sibling_bucket] = sibling_counts.get(sibling_bucket, 0) + 1
            order = sibling_counts[sibling_bucket]

        normalized.append(
            {
                "section_key": section_key,
                "name": name,
                "parent_key": parent_key,
                "order": order,
            }
        )

    return normalized


def validate_template_items(raw_items: list[dict[str, Any]]) -> list[ImportTemplateItem]:
    items = [ImportTemplateItem.model_validate(item) for item in normalize_template_items(raw_items)]
    section_keys = set()
    for item in items:
        if item.section_key in section_keys:
            raise HTTPException(status_code=400, detail=f"Duplicate section_key: {item.section_key}")
        section_keys.add(item.section_key)

    for item in items:
        if item.parent_key is not None and item.parent_key not in section_keys:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid parent_key '{item.parent_key}' for section_key '{item.section_key}'",
            )
    return items


@app.post("/sections/import", response_model=ImportResponse)
def import_sections(file: UploadFile | None = File(default=None)):
    source = TOC_JSON_PATH
    try:
        if file is not None:
            source = file.filename or "uploaded_file"
            raw_items = json.loads(file.file.read().decode("utf-8"))
        else:
            with open(TOC_JSON_PATH, "r", encoding="utf-8") as f:
                raw_items = json.load(f)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Template file not found: {TOC_JSON_PATH}")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Uploaded file must be UTF-8 encoded JSON")
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail=f"Invalid JSON in template file: {source}")

    items = validate_template_items(raw_items)
    logger.info("Starting TOC import from %s (%d items)", source, len(items))

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("TRUNCATE TABLE document_section CASCADE")

        # Insert all sections first with parent_id as NULL.
        for item in items:
            cur.execute(
                """
                INSERT INTO document_section (section_key, name, parent_id, is_leaf, "order")
                VALUES (%s, %s, NULL, TRUE, %s)
                """,
                (item.section_key, item.name, item.order),
            )

        # Resolve parent_id with section_key -> id lookup.
        for item in items:
            parent_key = item.parent_key
            if parent_key is not None:
                cur.execute(
                    """
                    UPDATE document_section child
                    SET parent_id = parent.id, updated_at = NOW()
                    FROM document_section parent
                    WHERE child.section_key = %s
                      AND parent.section_key = %s
                    """,
                    (item.section_key, parent_key),
                )
                if cur.rowcount != 1:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid parent_key mapping for section_key={item.section_key}",
                    )

        # Compute leaf flags from actual parent-child relationships.
        cur.execute(
            """
            UPDATE document_section ds
            SET is_leaf = NOT EXISTS (
                SELECT 1 FROM document_section c WHERE c.parent_id = ds.id
            ),
            updated_at = NOW()
            """
        )

        cur.execute("SELECT COUNT(*) AS c FROM document_section")
        inserted = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*) AS c FROM document_section WHERE parent_id IS NULL")
        roots = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*) AS c FROM document_section WHERE is_leaf = TRUE")
        leaves = cur.fetchone()["c"]

        conn.commit()

    logger.info("Completed TOC import from %s: inserted=%d roots=%d leaves=%d", source, inserted, roots, leaves)
    return {"ok": True, "inserted": inserted, "roots": roots, "leaves": leaves, "source": source}


@app.post("/sections/import/path", response_model=ImportResponse)
def import_sections_by_path(payload: ImportByPathPayload):
    source = payload.file_path
    try:
        with open(source, "r", encoding="utf-8") as f:
            raw_items = json.load(f)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Template file not found: {source}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail=f"Invalid JSON in template file: {source}")

    items = validate_template_items(raw_items)
    logger.info("Starting TOC import from %s (%d items)", source, len(items))

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("TRUNCATE TABLE document_section CASCADE")
        for item in items:
            cur.execute(
                """
                INSERT INTO document_section (section_key, name, parent_id, is_leaf, "order")
                VALUES (%s, %s, NULL, TRUE, %s)
                """,
                (item.section_key, item.name, item.order),
            )
        for item in items:
            if item.parent_key is not None:
                cur.execute(
                    """
                    UPDATE document_section child
                    SET parent_id = parent.id, updated_at = NOW()
                    FROM document_section parent
                    WHERE child.section_key = %s
                      AND parent.section_key = %s
                    """,
                    (item.section_key, item.parent_key),
                )
                if cur.rowcount != 1:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid parent_key mapping for section_key={item.section_key}",
                    )
        cur.execute(
            """
            UPDATE document_section ds
            SET is_leaf = NOT EXISTS (
                SELECT 1 FROM document_section c WHERE c.parent_id = ds.id
            ),
            updated_at = NOW()
            """
        )
        cur.execute("SELECT COUNT(*) AS c FROM document_section")
        inserted = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*) AS c FROM document_section WHERE parent_id IS NULL")
        roots = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*) AS c FROM document_section WHERE is_leaf = TRUE")
        leaves = cur.fetchone()["c"]
        conn.commit()

    logger.info("Completed TOC import from %s: inserted=%d roots=%d leaves=%d", source, inserted, roots, leaves)
    return {"ok": True, "inserted": inserted, "roots": roots, "leaves": leaves, "source": source}

@app.get("/sections", response_model=list[SectionNode])
def get_sections():
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, parent_id, section_key, name, is_leaf, "order"
            FROM document_section
        """)
        rows = cur.fetchall()
    return build_tree(rows)

@app.patch("/sections/{section_id}", response_model=IdResponse)
def rename_section(section_id: UUID, payload: RenamePayload):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE document_section
            SET name = %s, updated_at = NOW()
            WHERE id = %s
            RETURNING id
        """, (payload.name, section_id))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Section not found")
        conn.commit()
    return {"ok": True, "id": row["id"]}

@app.post("/sections", response_model=IdResponse)
def create_section(payload: CreatePayload):
    with get_conn() as conn, conn.cursor() as cur:
        if payload.parent_id:
            cur.execute("SELECT id FROM document_section WHERE id = %s", (payload.parent_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Parent section not found")

        cur.execute("""
            SELECT COALESCE(MAX("order"), 0) + 1 AS next_order
            FROM document_section
            WHERE parent_id IS NOT DISTINCT FROM %s
        """, (payload.parent_id,))
        next_order = cur.fetchone()["next_order"]

        # temp unique key; replace with your key-generation logic later
        cur.execute("""
            INSERT INTO document_section (section_key, name, parent_id, is_leaf, "order")
            VALUES (concat('new-', gen_random_uuid()::text), %s, %s, TRUE, %s)
            RETURNING id, parent_id
        """, (payload.name, payload.parent_id, next_order))
        new_row = cur.fetchone()

        if payload.parent_id:
            cur.execute("""
                UPDATE document_section
                SET is_leaf = FALSE, updated_at = NOW()
                WHERE id = %s
            """, (payload.parent_id,))

        conn.commit()
    return {"ok": True, "id": new_row["id"]}

@app.delete("/sections/{section_id}", response_model=BasicResponse)
def delete_section(
    section_id: UUID, strategy: str = Query("lift_children", pattern="^(lift_children|cascade)$")
):
    # Strategy:
    # - lift_children: move children to deleted node's parent, then delete node
    # - cascade: delete subtree recursively
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute('SELECT parent_id, "order" FROM document_section WHERE id = %s', (section_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Section not found")
        parent_id = row["parent_id"]
        deleted_order = row["order"]

        if strategy == "lift_children":
            cur.execute(
                """
                SELECT id
                FROM document_section
                WHERE parent_id = %s
                ORDER BY "order", id
                """,
                (section_id,),
            )
            child_ids = [r["id"] for r in cur.fetchall()]

            cur.execute(
                """
                SELECT COALESCE(MAX("order"), 0) AS max_order
                FROM document_section
                WHERE parent_id IS NOT DISTINCT FROM %s
                  AND id <> %s
                """,
                (parent_id, section_id),
            )
            base_order = cur.fetchone()["max_order"]

            for idx, child_id in enumerate(child_ids, start=1):
                cur.execute(
                    """
                    UPDATE document_section
                    SET parent_id = %s, "order" = %s, updated_at = NOW()
                    WHERE id = %s
                    """,
                    (parent_id, base_order + idx, child_id),
                )

            cur.execute("DELETE FROM document_section WHERE id = %s", (section_id,))
        else:
            cur.execute(
                """
                WITH RECURSIVE subtree AS (
                  SELECT id FROM document_section WHERE id = %s
                  UNION ALL
                  SELECT d.id
                  FROM document_section d
                  JOIN subtree s ON d.parent_id = s.id
                )
                DELETE FROM document_section
                WHERE id IN (SELECT id FROM subtree)
                """,
                (section_id,),
            )

        if parent_id:
            cur.execute(
                """
                UPDATE document_section
                SET "order" = "order" - 1
                WHERE parent_id IS NOT DISTINCT FROM %s
                  AND "order" > %s
                """,
                (parent_id, deleted_order),
            )

        if parent_id:
            cur.execute("""
                UPDATE document_section p
                SET is_leaf = NOT EXISTS (
                    SELECT 1 FROM document_section c WHERE c.parent_id = p.id
                ),
                updated_at = NOW()
                WHERE p.id = %s
            """, (parent_id,))

        conn.commit()
    return {"ok": True}

@app.put("/sections/move", response_model=BasicResponse)
def move_section(payload: MovePayload) -> BasicResponse:
    with get_conn() as conn, conn.cursor() as cur:
        # existing
        cur.execute('SELECT id, parent_id, "order" FROM document_section WHERE id = %s', (payload.section_id,))
        section = cur.fetchone()
        if not section:
            raise HTTPException(status_code=404, detail="Section not found")

        old_parent = section["parent_id"]
        old_order = section["order"]
        new_parent = payload.new_parent_id
        new_order = payload.new_order

        if new_order < 1:
            raise HTTPException(status_code=400, detail="new_order must be >= 1")

        if new_parent:
            cur.execute("SELECT id FROM document_section WHERE id = %s", (new_parent,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Target parent section not found")

        # prevent move into own descendant
        if new_parent:
            cur.execute("""
                WITH RECURSIVE descendants AS (
                  SELECT id, parent_id FROM document_section WHERE id = %s
                  UNION ALL
                  SELECT d.id, d.parent_id
                  FROM document_section d
                  JOIN descendants x ON d.parent_id = x.id
                )
                SELECT 1 FROM descendants WHERE id = %s LIMIT 1
            """, (payload.section_id, new_parent))
            if cur.fetchone():
                raise HTTPException(status_code=400, detail="Invalid move: cannot move into descendant")

        cur.execute(
            """
            SELECT COALESCE(MAX("order"), 0) + 1 AS max_next
            FROM document_section
            WHERE parent_id IS NOT DISTINCT FROM %s
              AND id <> %s
            """,
            (new_parent, payload.section_id),
        )
        max_next = cur.fetchone()["max_next"]
        if new_order > max_next:
            raise HTTPException(
                status_code=400,
                detail=f"new_order out of range for target parent (max allowed: {max_next})",
            )

        # close old gap
        cur.execute("""
            UPDATE document_section
            SET "order" = "order" - 1
            WHERE parent_id IS NOT DISTINCT FROM %s
              AND "order" > %s
        """, (old_parent, old_order))

        # open new slot
        cur.execute("""
            UPDATE document_section
            SET "order" = "order" + 1
            WHERE parent_id IS NOT DISTINCT FROM %s
              AND "order" >= %s
        """, (new_parent, new_order))

        # move item
        cur.execute("""
            UPDATE document_section
            SET parent_id = %s, "order" = %s, updated_at = NOW()
            WHERE id = %s
        """, (new_parent, new_order, payload.section_id))

        # recompute leafs for affected parents
        for pid in [old_parent, new_parent]:
            if pid:
                cur.execute("""
                    UPDATE document_section p
                    SET is_leaf = NOT EXISTS (
                      SELECT 1 FROM document_section c WHERE c.parent_id = p.id
                    ),
                    updated_at = NOW()
                    WHERE p.id = %s
                """, (pid,))

        conn.commit()
    return {"ok": True}
