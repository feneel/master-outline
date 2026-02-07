import { type ChangeEvent, useEffect, useRef, useState } from "react";
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  createSectionRequest,
  deleteSectionRequest,
  fetchSections,
  importSectionsRequest,
  moveSectionRequest,
  renameSectionRequest
} from "./api";
import { Modal } from "antd";
import { SectionTree } from "./components/SectionTree";
import type { SectionNode } from "./types";

export default function App() {
  const [tree, setTree] = useState<SectionNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [moving, setMoving] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const importInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 }
    })
  );

  async function loadSections(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false;
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const data = await fetchSections();
      setTree(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    loadSections();
  }, []);

  function getNodeMeta(nodes: SectionNode[]) {
    const meta = new Map<string, { parentId: string | null; order: number }>();
    const walk = (list: SectionNode[]) => {
      for (const n of list) {
        meta.set(n.id, { parentId: n.parent_id, order: n.order });
        if (n.children?.length) walk(n.children);
      }
    };
    walk(nodes);
    return meta;
  }

  function reorderTreeLocally(
    nodes: SectionNode[],
    sectionId: string,
    targetId: string,
    position: "before" | "after"
  ): SectionNode[] {
    const walk = (list: SectionNode[]): { list: SectionNode[]; changed: boolean } => {
      const from = list.findIndex((n) => n.id === sectionId);
      const to = list.findIndex((n) => n.id === targetId);
      if (from !== -1 && to !== -1) {
        const next = [...list];
        const [moved] = next.splice(from, 1);
        let insertAt = to;
        if (from < to) {
          insertAt = position === "before" ? to - 1 : to;
        } else {
          insertAt = position === "before" ? to : to + 1;
        }
        next.splice(insertAt, 0, moved);
        return { list: normalizeLocalOrders(next), changed: true };
      }

      let changed = false;
      const next = list.map((n) => {
        if (!n.children?.length) return n;
        const result = walk(n.children);
        if (!result.changed) return n;
        changed = true;
        return { ...n, children: result.list };
      });
      return { list: changed ? next : list, changed };
    };

    return walk(nodes).list;
  }

  function normalizeLocalOrders(list: SectionNode[]): SectionNode[] {
    return list.map((n, idx) => ({ ...n, order: idx + 1 }));
  }

  async function moveSectionByAnchor(sectionId: string, targetId: string) {
    if (sectionId === targetId) return;

    const meta = getNodeMeta(tree);
    const dragged = meta.get(sectionId);
    const target = meta.get(targetId);
    if (!dragged || !target) return;

    if (dragged.parentId !== target.parentId) {
      setError("Cross-parent moves are not allowed.");
      return;
    }

    const position = dragged.order < target.order ? "after" : "before";
    setMoving(true);
    setError("");
    const previousScrollY = window.scrollY;
    const previousTree = tree;
    setTree((prev) => reorderTreeLocally(prev, sectionId, targetId, position));
    try {
      await moveSectionRequest(sectionId, targetId, position);
      await loadSections({ silent: true });
      requestAnimationFrame(() => window.scrollTo({ top: previousScrollY }));
    } catch (e) {
      setTree(previousTree);
      setError(e instanceof Error ? e.message : "Move failed");
    } finally {
      setMoving(false);
      setActiveId(null);
      setOverId(null);
    }
  }

  async function renameSection(sectionId: string, name: string) {
    setError("");
    setRenamingId(sectionId);
    const previousScrollY = window.scrollY;
    try {
      await renameSectionRequest(sectionId, name);
      await loadSections({ silent: true });
      requestAnimationFrame(() => window.scrollTo({ top: previousScrollY }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rename failed");
    } finally {
      setRenamingId(null);
    }
  }

  async function onCreateSection(
    name: string,
    parentId: string | null,
    anchorId: string | null,
    mode: "sibling" | "child"
  ) {
    if (!name.trim()) return;
    if (anchorId) setCreatingId(anchorId);
    setError("");
    const previousScrollY = window.scrollY;
    try {
      await createSectionRequest(
        name.trim(),
        parentId,
        mode === "sibling" ? anchorId ?? undefined : undefined,
        "after"
      );
      await loadSections({ silent: true });
      requestAnimationFrame(() => window.scrollTo({ top: previousScrollY }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreatingId(null);
    }
  }

  async function onDeleteSection(node: SectionNode) {
    // Requirement: if node has children, ask "Delete children too?".
    // If user declines, do NOT delete parent.
    if (node.children?.length) {
      Modal.confirm({
        title: "Delete children too?",
        content:
          "This section has children. Click Delete All to remove the parent and all children, or Keep to cancel deletion.",
        okText: "Delete All",
        cancelText: "Keep",
        okButtonProps: { danger: true },
        onOk: async () => {
          setDeletingId(node.id);
          setError("");
          const previousScrollY = window.scrollY;
          try {
            await deleteSectionRequest(node.id, "cascade");
            await loadSections({ silent: true });
            requestAnimationFrame(() => window.scrollTo({ top: previousScrollY }));
          } catch (e) {
            setError(e instanceof Error ? e.message : "Delete failed");
          } finally {
            setDeletingId(null);
          }
        },
        // onCancel: () => {
        //   setError("Section not deleted because it has children.");
        // }
      });
      return;
    }

    // Leaf node: no prompt, delete directly.
    setDeletingId(node.id);
    setError("");
    const previousScrollY = window.scrollY;
    try {
      await deleteSectionRequest(node.id, "lift_children");
      await loadSections({ silent: true });
      requestAnimationFrame(() => window.scrollTo({ top: previousScrollY }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  async function onDragEnd(event: DragEndEvent) {
    const active = String(event.active.id);
    const over = event.over ? String(event.over.id) : null;
    if (!over) {
      setActiveId(null);
      setOverId(null);
      return;
    }
    await moveSectionByAnchor(active, over);
  }

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function onDragOver(event: DragOverEvent) {
    setOverId(event.over ? String(event.over.id) : null);
  }

  function toggleCollapse(sectionId: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  async function onImportChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError("");
    setInfo("");
    try {
      const result = await importSectionsRequest(file);
      await loadSections({ silent: true });
      setInfo(
        `Imported ${result.inserted} sections from ${result.source} (${result.roots} roots, ${result.leaves} leaves).`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  }

  return (
    <main className="toc-page">
      <header className="toc-header">
        <h1>Table of Contents</h1>
        <div className="toc-header-actions">
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden-file-input"
            onChange={onImportChange}
          />
          <button onClick={() => importInputRef.current?.click()} disabled={importing}>
            {importing ? "Importing..." : "Import JSON"}
          </button>
          <button onClick={() => loadSections()} disabled={loading || importing}>
            Reload
          </button>
        </div>
      </header>
      <p className="toc-help">Drag the handle and drop before/after another section to reorder.</p>

      {loading && <p>Loading...</p>}
      {info && <p className="info">{info}</p>}
      {/* {moving && <p className="info">Updating order...</p>} */}
      {error && <p className="error">{error}</p>}

      {(!loading || tree.length > 0) && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            setActiveId(null);
            setOverId(null);
          }}
        >
          <SectionTree
            nodes={tree}
            depth={0}
            activeId={activeId}
            overId={overId}
            renamingId={renamingId}
            onRename={renameSection}
            creatingId={creatingId}
            onCreateSection={onCreateSection}
            deletingId={deletingId}
            onDeleteSection={onDeleteSection}
            collapsedIds={collapsedIds}
            onToggleCollapse={toggleCollapse}
          />
        </DndContext>
      )}
    </main>
  );
}
