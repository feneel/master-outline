import json
import psycopg

with open("study_template.json") as f:
    rows = json.load(f)

with psycopg.connect("postgresql://feneel:password@localhost:5432/toc_db") as conn:
    with conn.cursor() as cur:
        cur.execute("BEGIN;")
        cur.execute("TRUNCATE TABLE document_section RESTART IDENTITY CASCADE;")

        for r in rows:
            cur.execute(
                """
                INSERT INTO document_section (section_key, name, parent_id, is_leaf, "order")
                VALUES (%s, %s, NULL, TRUE, %s)
                """,
                (r["section_key"], r["name"], r["order"]),
            )

        for r in rows:
            if r["parent_key"] is not None:
                cur.execute(
                    """
                    UPDATE document_section child
                    SET parent_id = parent.id
                    FROM document_section parent
                    WHERE child.section_key = %s
                      AND parent.section_key = %s
                    """,
                    (r["section_key"], r["parent_key"]),
                )

        cur.execute(
            """
            UPDATE document_section ds
            SET is_leaf = NOT EXISTS (
              SELECT 1 FROM document_section c WHERE c.parent_id = ds.id
            )
            """
        )
        cur.execute("COMMIT;")
