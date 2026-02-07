import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { SectionRow } from "./SectionRow";
import type { SectionNode } from "../types";

type TreeProps = {
  nodes: SectionNode[];
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
  collapsedIds: Set<string>;
  onToggleCollapse: (sectionId: string) => void;
};

export function SectionTree({
  nodes,
  depth,
  activeId,
  overId,
  renamingId,
  onRename,
  creatingId,
  onCreateSection,
  deletingId,
  onDeleteSection,
  collapsedIds,
  onToggleCollapse
}: TreeProps) {
  return (
    <SortableContext items={nodes.map((n) => n.id)} strategy={verticalListSortingStrategy}>
      <div>
        {nodes.map((node) => (
          <div key={node.id}>
            <SectionRow
              node={node}
              depth={depth}
              activeId={activeId}
              overId={overId}
              renamingId={renamingId}
              onRename={onRename}
              creatingId={creatingId}
              onCreateSection={onCreateSection}
              deletingId={deletingId}
              onDeleteSection={onDeleteSection}
              isCollapsed={collapsedIds.has(node.id)}
              onToggleCollapse={onToggleCollapse}
            />
            {node.children?.length > 0 && !collapsedIds.has(node.id) && (
              <SectionTree
                nodes={node.children}
                depth={depth + 1}
                activeId={activeId}
                overId={overId}
                renamingId={renamingId}
                onRename={onRename}
                creatingId={creatingId}
                onCreateSection={onCreateSection}
                deletingId={deletingId}
                onDeleteSection={onDeleteSection}
                collapsedIds={collapsedIds}
                onToggleCollapse={onToggleCollapse}
              />
            )}
          </div>
        ))}
      </div>
    </SortableContext>
  );
}
