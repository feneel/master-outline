import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import { useState } from "react";
import type { SectionNode } from "../types";
import { DeleteOutlined, EditOutlined, RightOutlined, DownOutlined } from "@ant-design/icons";
import { Input } from "antd";

type RowProps = {
  node: SectionNode;
  depth: number;
  activeId: string | null;
  overId: string | null;
  renamingId: string | null;
  onRename: (sectionId: string, name: string) => Promise<void>;
  creatingId: string | null;
  onCreateSection: (
    name: string,
    parentId: string | null,
    anchorId: string | null,
    mode: "sibling" | "child"
  ) => Promise<void>;
  deletingId: string | null;
  onDeleteSection: (node: SectionNode) => Promise<void>;
  isCollapsed: boolean;
  onToggleCollapse: (sectionId: string) => void;
};

export function SectionRow({
  node,
  depth,
  activeId,
  overId,
  renamingId,
  onRename,
  creatingId,
  onCreateSection,
  deletingId,
  onDeleteSection,
  isCollapsed,
  onToggleCollapse
}: RowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: node.id });

  const indent = depth * 20;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };
  const isOver = overId === node.id && activeId !== node.id;
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(node.name);
  const [addMode, setAddMode] = useState<"sibling" | "child" | null>(null);
  const [addDraftName, setAddDraftName] = useState("");
  const isSaving = renamingId === node.id;
  const isCreating = creatingId === node.id;
  const isDeleting = deletingId === node.id;

  async function handleSave() {
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === node.name) {
      setIsEditing(false);
      setDraftName(node.name);
      return;
    }
    await onRename(node.id, trimmed);
    setIsEditing(false);
  }

  function handleCancel() {
    setDraftName(node.name);
    setIsEditing(false);
  }

  async function handleCreate() {
    const trimmed = addDraftName.trim();
    if (!trimmed || !addMode) return;
    const parentId = addMode === "child" ? node.id : node.parent_id;
    const anchorId = addMode === "sibling" ? node.id : null;
    await onCreateSection(trimmed, parentId, anchorId, addMode);
    setAddDraftName("");
    setAddMode(null);
  }

  return (
    <div
      ref={setNodeRef}
      className="toc-row-wrap"
      style={{ marginLeft: indent, ...style }}
    >
      <div className={`toc-row ${isDragging ? "dragging" : ""} ${isOver ? "over" : ""}`}>
        <span
          {...attributes}
          {...listeners}
          title="Drag to move"
          className="drag-handle"
        >
          ≡
        </span>

        <button
          className="collapse-btn"
          title={isCollapsed ? "Expand section" : "Collapse section"}
          aria-label={isCollapsed ? "Expand section" : "Collapse section"}
          onClick={() => onToggleCollapse(node.id)}
          disabled={!node.children?.length}
        >
          {node.children?.length ? (isCollapsed ? <RightOutlined /> : <DownOutlined />) : null}
        </button>

        <span className="section-key">{node.section_key || "(no key)"}</span>
        {isEditing ? (
          <div className="rename-wrap">
            <Input
              className="rename-input"
              value={draftName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraftName(e.target.value)}
              autoFocus
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Enter") void handleSave();
                if (e.key === "Escape") handleCancel();
              }}
            />
            <button
              className="tiny-btn"
              onClick={() => void handleSave()}
              disabled={isSaving}
            >
              Save
            </button>
            <button className="tiny-btn secondary" onClick={handleCancel} disabled={isSaving}>
              Cancel
            </button>
          </div>
        ) : (
          <>
            <span className="section-name">{node.name}</span>
            <div className="row-actions">
              <button
                className="icon-btn"
                title="Rename section"
                aria-label="Rename section"
                onClick={() => {
                  setDraftName(node.name);
                  setIsEditing(true);
                }}
              >
                <EditOutlined />
              </button>
              <button
                className="icon-btn"
                title="Add sibling"
                aria-label="Add sibling section"
                onClick={() => {
                  setAddMode("sibling");
                  setAddDraftName("");
                }}
                disabled={isCreating}
              >
                ⤵
              </button>
              <button
                className="icon-btn"
                title="Add child"
                aria-label="Add child section"
                onClick={() => {
                  setAddMode("child");
                  setAddDraftName("");
                }}
                disabled={isCreating}
              >
                ↵
              </button>
              <button
                className="icon-btn danger"
                title="Delete section"
                aria-label="Delete section"
                onClick={() => void onDeleteSection(node)}
                disabled={isDeleting}
              >
                <DeleteOutlined />
              </button>
            </div>
          </>
        )}
      </div>
      {addMode && (
        <div className="add-wrap">
          <Input
            className="rename-input"
            placeholder={addMode === "child" ? "New child section name" : "New sibling section name"}
            value={addDraftName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddDraftName(e.target.value)}
            autoFocus
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") void handleCreate();
              if (e.key === "Escape") {
                setAddMode(null);
                setAddDraftName("");
              }
            }}
          />
          <button className="tiny-btn" onClick={() => void handleCreate()} disabled={isCreating}>
            Add
          </button>
          <button
            className="tiny-btn secondary"
            onClick={() => {
              setAddMode(null);
              setAddDraftName("");
            }}
            disabled={isCreating}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
