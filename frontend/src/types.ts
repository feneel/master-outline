export type SectionNode = {
  id: string;
  parent_id: string | null;
  section_key: string;
  name: string;
  is_leaf: boolean;
  order: number;
  children: SectionNode[];
};

export type DropPosition = "before" | "after";
