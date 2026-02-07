import type { DropPosition, SectionNode } from "./types";

export const API_BASE = "http://127.0.0.1:8000";

type ImportResponse = {
  ok: boolean;
  inserted: number;
  roots: number;
  leaves: number;
  source: string;
};

export async function fetchSections(): Promise<SectionNode[]> {
  const res = await fetch(`${API_BASE}/sections`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Failed to load sections");
  return data;
}

export async function importSectionsRequest(file: File): Promise<ImportResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_BASE}/sections/import`, {
    method: "POST",
    body: formData
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Import failed");
  return data;
}

export async function moveSectionRequest(
  sectionId: string,
  targetSectionId: string,
  position: DropPosition
): Promise<void> {
  const res = await fetch(`${API_BASE}/sections/move`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      section_id: sectionId,
      target_section_id: targetSectionId,
      position
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Move failed");
}

export async function renameSectionRequest(sectionId: string, name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/sections/${sectionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Rename failed");
}

export async function createSectionRequest(
  name: string,
  parentId: string | null,
  anchorSectionId?: string,
  anchorPosition: "before" | "after" = "after"
): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE}/sections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      parent_id: parentId,
      anchor_section_id: anchorSectionId,
      anchor_position: anchorPosition
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Create failed");
  return data;
}

export async function deleteSectionRequest(
  sectionId: string,
  strategy: "lift_children" | "cascade" = "lift_children"
): Promise<void> {
  const res = await fetch(`${API_BASE}/sections/${sectionId}?strategy=${strategy}`, {
    method: "DELETE"
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Delete failed");
}
