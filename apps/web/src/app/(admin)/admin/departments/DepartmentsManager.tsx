'use client';

import type { Department, DepartmentPage } from '@majlis/contracts';
import { Plus } from '@phosphor-icons/react/ssr';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { Field } from '@/components/Field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { createDepartment, listDepartments, removeDepartment, updateDepartment } from '@/lib/clubs';
import { PAGE } from '@/lib/page-size';
import { ProblemError } from '@/lib/api';

function DepartmentForm({
  department,
  onSaved,
}: {
  department?: Department;
  onSaved: (d: Department) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(department?.name ?? '');
  const [code, setCode] = useState(department?.code ?? '');
  const [description, setDescription] = useState(department?.description ?? '');
  const [error, setError] = useState<ProblemError | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const body = { name, code, description: description || undefined };
      const saved = department ? await updateDepartment(department.id, body) : await createDepartment(body);
      onSaved(saved);
      setOpen(false);
    } catch (err) {
      if (err instanceof ProblemError) setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        {department ? (
          <Button variant="outline" size="sm">
            Edit
          </Button>
        ) : (
          <Button>
            <Plus data-icon="inline-start" aria-hidden />
            New department
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{department ? 'Edit department' : 'New department'}</DialogTitle>
        </DialogHeader>
        <Field label="Name" error={error?.fieldError('name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Code" error={error?.fieldError('code')}>
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required />
        </Field>
        <Field label="Description" error={error?.fieldError('description')}>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {error && error.errors.length === 0 ? <p className="text-sm text-bad-fg">{error.detail ?? error.title}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !name.trim() || !code.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DepartmentsManager({ initial }: { initial: DepartmentPage | null }) {
  const [items, setItems] = useState<Department[] | null>(initial?.items ?? null);
  const [cursor, setCursor] = useState<string | null>(initial?.nextCursor ?? null);

  async function load(reset: boolean) {
    const page = await listDepartments({ limit: PAGE, cursor: reset ? undefined : (cursor ?? undefined) });
    setItems((prev) => (reset || !prev ? page.items : [...prev, ...page.items]));
    setCursor(page.nextCursor);
  }

  useEffect(() => {
    if (!initial) load(true);
  }, [initial]);

  function onSaved(saved: Department) {
    setItems((prev) => {
      if (!prev) return [saved];
      const exists = prev.some((d) => d.id === saved.id);
      return exists ? prev.map((d) => (d.id === saved.id ? saved : d)) : [saved, ...prev];
    });
  }

  async function onDelete(id: string) {
    await removeDepartment(id);
    setItems((prev) => prev?.filter((d) => d.id !== id) ?? null);
  }

  if (items === null) return <Skeleton className="h-40 w-full" />;

  if (items.length === 0) {
    return <EmptyState title="No departments" action={<DepartmentForm onSaved={onSaved} />} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <DepartmentForm onSaved={onSaved} />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Clubs</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((d) => (
            <TableRow key={d.id}>
              <TableCell className="font-medium text-ink">{d.name}</TableCell>
              <TableCell className="tabular">{d.code}</TableCell>
              <TableCell className="tabular">{d.clubCount}</TableCell>
              <TableCell>
                <div className="flex justify-end gap-2">
                  <DepartmentForm department={d} onSaved={onSaved} />
                  <ConfirmDialog
                    trigger={
                      <Button variant="destructive" size="sm">
                        Delete
                      </Button>
                    }
                    title={`Delete ${d.name}?`}
                    destructive
                    confirmLabel="Delete"
                    onConfirm={() => onDelete(d.id)}
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {cursor ? (
        <Button variant="outline" onClick={() => load(false)} className="self-center">
          Load more
        </Button>
      ) : null}
    </div>
  );
}
