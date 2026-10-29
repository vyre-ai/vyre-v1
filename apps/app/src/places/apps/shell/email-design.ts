import type { EmailBlock } from "../../../../../../ui/src/EmailBuilder/props.ts";
interface ServerBlock { type: string; props: Record<string, unknown> }
export function serverBlock(block: EmailBlock): ServerBlock {
  const { kind, children, ...props } = block;
  return { type: kind, props: { ...props, ...(kind === "columns" ? { cols: (children ?? []).map((child) => [serverBlock(child)]) } : {}), ...(kind === "saved" && children?.[0] ? { block: serverBlock(children[0]) } : {}), ...(kind === "merge" ? { key: block.field, fallback: block.text } : {}), ...(kind === "button" ? { label: block.text } : {}), ...(kind === "html" ? { code: block.text } : {}) } };
}
export function visibleBlock(block: ServerBlock, id: string): EmailBlock {
  const p = block.props;
  return { ...p, id, kind: block.type as EmailBlock["kind"], text: String(p.text ?? p.label ?? p.code ?? p.fallback ?? ""), ...(block.type === "merge" ? { field: String(p.key ?? "") } : {}), ...(block.type === "columns" ? { children: ((p.cols ?? []) as ServerBlock[][]).flatMap((col, i) => col.map((child, j) => visibleBlock(child, `${id}-${i}-${j}`))) } : {}), ...(block.type === "saved" && p.block ? { children: [visibleBlock(p.block as ServerBlock, `${id}-saved`)] } : {}) };
}
