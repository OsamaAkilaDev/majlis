import { Button } from '@/components/ui/button';

/** The tail of a cursor-paginated list. A null cursor is the last page. */
export function LoadMore({
  cursor,
  onClick,
  busy,
}: {
  cursor: string | null;
  onClick: () => void;
  busy?: boolean;
}) {
  if (!cursor) return null;
  return (
    <Button variant="outline" onClick={onClick} disabled={busy} className="self-center">
      Load more
    </Button>
  );
}
