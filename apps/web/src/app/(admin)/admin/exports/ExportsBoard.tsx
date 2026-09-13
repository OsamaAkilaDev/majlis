'use client';

import { EXPORT_CAP_NOTICE, type EventSummary } from '@majlis/contracts';
import { DownloadSimple } from '@phosphor-icons/react/ssr';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ProblemError } from '@/lib/api';
import { listEvents } from '@/lib/events';
import { ICON_WEIGHT } from '@/lib/icons';
import { downloadCsv } from '@/lib/reporting';
import { useAsyncError } from '@/lib/use-async-error';

const PER_EVENT = [
  { key: 'registrations', label: 'Registrations' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'certificates', label: 'Certificates' },
] as const;

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
      <h2 className="font-display text-h2 text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function ExportsBoard({ initialEvents }: { initialEvents: EventSummary[] | null }) {
  const [events, setEvents] = useState<EventSummary[]>(initialEvents ?? []);
  const [eventId, setEventId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [capped, setCapped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fail = useAsyncError();

  useEffect(() => {
    if (initialEvents) return;
    listEvents({ limit: 100 })
      .then((page) => setEvents(page.items))
      .catch(fail);
  }, [initialEvents, fail]);

  async function run(key: string, path: string, filename: string) {
    setBusy(key);
    setCapped(false);
    setError(null);
    try {
      setCapped(await downloadCsv(path, filename));
    } catch (err) {
      setError(err instanceof ProblemError ? (err.detail ?? err.title) : 'That export failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* The API's own sentence, the one written into the file's trailer row,
          so the screen and the download cannot disagree about the cap. */}
      {capped ? (
        <p role="status" className="rounded-control bg-warn-soft px-3 py-2 text-sm text-warn-fg">
          {EXPORT_CAP_NOTICE}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-bad-fg">
          {error}
        </p>
      ) : null}

      <Card title="Platform">
        <div>
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() => run('events', '/exports/events.csv', 'events.csv')}
          >
            <DownloadSimple size={14} weight={ICON_WEIGHT} aria-hidden />
            Events
          </Button>
        </div>
      </Card>

      <Card title="One event">
        <div className="flex flex-wrap items-center gap-2">
          {/* A SelectTrigger is a button, which no <label htmlFor> can name. */}
          <Select value={eventId} onValueChange={setEventId}>
            <SelectTrigger aria-label="Event to export" className="w-full sm:w-80">
              <SelectValue placeholder="Event" />
            </SelectTrigger>
            <SelectContent>
              {events.map((event) => (
                <SelectItem key={event.id} value={event.id}>
                  {event.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {PER_EVENT.map(({ key, label }) => (
            <Button
              key={key}
              variant="outline"
              disabled={busy !== null || eventId === ''}
              onClick={() =>
                run(key, `/exports/${key}.csv?eventId=${eventId}`, `${key}-${eventId}.csv`)
              }
            >
              <DownloadSimple size={14} weight={ICON_WEIGHT} aria-hidden />
              {label}
            </Button>
          ))}
        </div>
      </Card>
    </div>
  );
}
