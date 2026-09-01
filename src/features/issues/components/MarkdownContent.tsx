import { MarkdownView } from "@/components/molecules/MarkdownView";

export function MarkdownContent({
  content,
  emptyLabel,
  className,
}: {
  content: string;
  emptyLabel: string;
  className?: string;
}) {
  return (
    <MarkdownView
      content={content}
      emptyLabel={emptyLabel}
      className={className}
    />
  );
}
