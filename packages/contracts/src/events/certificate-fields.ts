/**
 * A certificate needs a title and a signatory or it renders a document signed
 * by nobody. Applied to the merged row, never to the patch alone: a patch that
 * only flips the toggle on carries neither field and is still valid if the
 * stored row already has both.
 */
export function certificateFieldsComplete(row: {
  certificateEnabled: boolean;
  certificateTitle: string | null;
  certificateSignatory: string | null;
}): boolean {
  if (!row.certificateEnabled) return true;
  return Boolean(row.certificateTitle?.trim() && row.certificateSignatory?.trim());
}
