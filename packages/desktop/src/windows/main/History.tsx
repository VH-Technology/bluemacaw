import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { TranscriptionRow } from '@/lib/db';
import { downloadBlob, formatBulkAsMd, formatRowAsMd, formatRowAsTxt } from '@/lib/export';
import { useId, useMemo, useState } from 'react';

export interface HistoryEntry {
    id: string;
    text: string;
    provider: string;
    model: string;
    createdAt: string;
    durationMs: number;
    wordCount: number;
}

export interface HistoryProps {
    entries: readonly HistoryEntry[];
    pageSize?: number;
    onDelete?: (id: string) => void;
    onExportFiltered?: (rows: readonly HistoryEntry[]) => void;
}

const COLLAPSE_TEXT_AT = 280;

function toTranscriptionRow(e: HistoryEntry): TranscriptionRow {
    return {
        id: Number(e.id),
        createdAt: Date.parse(e.createdAt),
        text: e.text,
        durationMs: e.durationMs,
        wordCount: e.wordCount,
        providerId: e.provider,
        modelId: e.model,
    };
}

/**
 * Render a stored timestamp as `YYYY-MM-DD HH:MM:SS` in local time for the
 * history list. The stored value stays a full ISO-8601 string (it's also
 * re-parsed via Date.parse for export/sort) — we only trim the millisecond
 * + timezone noise for display. Falls back to the raw string if unparseable.
 */
function formatTimestamp(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function exportRow(e: HistoryEntry, format: 'txt' | 'md') {
    const row = toTranscriptionRow(e);
    if (format === 'txt') {
        downloadBlob(`bluemacaw-${row.id}.txt`, formatRowAsTxt(row), 'text/plain');
    } else {
        downloadBlob(`bluemacaw-${row.id}.md`, formatRowAsMd(row), 'text/markdown');
    }
}

export function History({ entries, pageSize = 25, onDelete, onExportFiltered }: HistoryProps) {
    const [search, setSearch] = useState('');
    const [providerFilter, setProviderFilter] = useState('all');
    const [page, setPage] = useState(0);
    const [expandedRows, setExpandedRows] = useState<ReadonlySet<string>>(() => new Set());
    const searchId = useId();
    const providerSelectId = useId();

    function toggleExpanded(id: string) {
        setExpandedRows((current) => {
            const next = new Set(current);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }

    const providers = useMemo(() => {
        const set = new Set(entries.map((e) => e.provider));
        return Array.from(set).sort();
    }, [entries]);

    const filtered = useMemo(() => {
        const lower = search.trim().toLowerCase();
        return entries.filter((e) => {
            if (providerFilter !== 'all' && e.provider !== providerFilter) return false;
            if (lower && !e.text.toLowerCase().includes(lower)) return false;
            return true;
        });
    }, [entries, search, providerFilter]);

    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    const safePage = Math.min(page, pageCount - 1);
    const start = safePage * pageSize;
    const visible = filtered.slice(start, start + pageSize);

    return (
        <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <div className="flex flex-1 flex-col gap-1">
                    <Label htmlFor={searchId}>Search</Label>
                    <Input
                        id={searchId}
                        placeholder="Search transcripts"
                        value={search}
                        onChange={(e) => {
                            setSearch(e.target.value);
                            setPage(0);
                        }}
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <Label htmlFor={providerSelectId}>Provider</Label>
                    <select
                        id={providerSelectId}
                        className="h-10 rounded-xl border border-border bg-surface px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-main/40 focus-visible:border-main"
                        value={providerFilter}
                        onChange={(e) => {
                            setProviderFilter(e.target.value);
                            setPage(0);
                        }}
                    >
                        <option value="all">All</option>
                        {providers.map((p) => (
                            <option key={p} value={p}>
                                {p}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="flex flex-col gap-1">
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                            const md = formatBulkAsMd(filtered.map(toTranscriptionRow), 'filtered');
                            downloadBlob('bluemacaw-history.md', md, 'text/markdown');
                            onExportFiltered?.(filtered);
                        }}
                    >
                        Export filtered
                    </Button>
                </div>
            </div>

            {filtered.length === 0 ? (
                <Card>
                    <CardContent className="text-base font-medium">
                        No transcriptions yet.
                    </CardContent>
                </Card>
            ) : (
                <ul className="flex flex-col gap-2">
                    {visible.map((entry) => {
                        const shouldCollapse = entry.text.length > COLLAPSE_TEXT_AT;
                        const expanded = expandedRows.has(entry.id);
                        const visibleText =
                            shouldCollapse && !expanded
                                ? `${entry.text.slice(0, COLLAPSE_TEXT_AT).trimEnd()}…`
                                : entry.text;
                        return (
                            <li key={entry.id} data-testid="history-row">
                                <Card>
                                    <CardContent className="flex flex-col gap-3 text-sm font-medium normal-case">
                                        {shouldCollapse ? (
                                            <button
                                                type="button"
                                                aria-expanded={expanded}
                                                aria-label={
                                                    expanded
                                                        ? 'Collapse transcription'
                                                        : 'Expand transcription'
                                                }
                                                data-testid={`history-text-toggle-${entry.id}`}
                                                onClick={() => toggleExpanded(entry.id)}
                                                className="rounded-2xl px-2 py-1 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-main/40"
                                            >
                                                <span className="block whitespace-pre-wrap text-base leading-relaxed">
                                                    {visibleText}
                                                </span>
                                            </button>
                                        ) : (
                                            <p className="whitespace-pre-wrap text-base leading-relaxed">
                                                {entry.text}
                                            </p>
                                        )}
                                        <p className="text-xs uppercase tracking-wider opacity-70">
                                            {entry.provider} · {entry.model} ·{' '}
                                            {formatTimestamp(entry.createdAt)}
                                        </p>
                                        <div className="flex flex-wrap gap-2">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() =>
                                                    void navigator.clipboard.writeText(entry.text)
                                                }
                                            >
                                                Copy
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => exportRow(entry, 'txt')}
                                            >
                                                Export .txt
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => exportRow(entry, 'md')}
                                            >
                                                Export .md
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="destructive"
                                                onClick={() => onDelete?.(entry.id)}
                                            >
                                                Delete
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            </li>
                        );
                    })}
                </ul>
            )}

            {filtered.length > pageSize && (
                <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-widest">
                        Page {safePage + 1} / {pageCount}
                    </span>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage((p) => Math.max(0, p - 1))}
                            disabled={safePage === 0}
                        >
                            Prev
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                            disabled={safePage === pageCount - 1}
                        >
                            Next
                        </Button>
                    </div>
                </div>
            )}
        </section>
    );
}
