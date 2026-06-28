import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type HistoryStats, getHistoryStats } from '@/lib/db';
import { PROVIDERS } from '@/providers';
import { type ReactNode, useEffect, useState } from 'react';
import { ProviderLogo } from './ProviderPicker';

export interface DashboardProps {
    /** When recordingState transitions to idle, the parent can bump this prop
     * to force a stats refetch. Defaults to 0 (no auto-refetch). */
    refreshKey?: number;
}

/**
 * Formats a projected monthly spend as currency. Sub-cent-but-nonzero spend
 * shows "<$0.01" rather than rounding to "$0.00"; a null projection (no priced
 * usage) renders as an em dash like the other empty stats.
 */
function formatMonthlyCost(usd: number | null): string {
    if (usd == null) return '—';
    if (usd > 0 && usd < 0.01) return '<$0.01';
    return `$${usd.toFixed(2)}`;
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
    return (
        <Card className="group flex min-h-40 flex-col border border-border/70 bg-surface/95 shadow-card transition-all duration-200 hover:-translate-y-1 hover:border-main/40 hover:bg-main/[0.04] hover:shadow-card-lg active:translate-y-0 active:scale-[0.99] dark:hover:bg-main/10">
            <CardHeader className="mb-0 w-full items-start pb-0 text-left">
                <CardTitle className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-muted-foreground transition-colors group-hover:text-main">
                    {label}
                </CardTitle>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 items-center justify-center text-center text-4xl font-black leading-none tracking-tight text-brand-navy transition-colors group-hover:text-main dark:text-fg dark:group-hover:text-main">
                {value}
            </CardContent>
        </Card>
    );
}

export function Dashboard({ refreshKey = 0 }: DashboardProps) {
    const [stats, setStats] = useState<HistoryStats | null>(null);

    useEffect(() => {
        // Reference refreshKey so biome sees it as used; bumping it re-fetches.
        void refreshKey;
        let cancelled = false;
        void getHistoryStats('all').then((s) => {
            if (!cancelled) setStats(s);
        });
        return () => {
            cancelled = true;
        };
    }, [refreshKey]);

    const totalWords = stats ? stats.totalWords.toLocaleString('en-US') : '—';
    const streakDays = stats ? String(stats.streakDays) : '—';
    const avgWPM = stats?.avgWPM != null ? stats.avgWPM.toFixed(1) : '—';
    const timeSaved = stats ? `${stats.timeSavedMinutes.toFixed(1)} min` : '—';
    const topProvider = stats?.topProvider
        ? PROVIDERS.find((provider) => provider.id === stats.topProvider)
        : null;
    const topProviderValue = stats?.topProvider ? (
        topProvider ? (
            <span className="flex min-w-0 flex-col items-center gap-2">
                <ProviderLogo provider={topProvider} testIdPrefix="top-provider-logo" />
                <span className="max-w-full truncate text-sm font-extrabold leading-tight">
                    {topProvider.name}
                </span>
            </span>
        ) : (
            stats.topProvider
        )
    ) : (
        '—'
    );
    const projectedCost = stats ? formatMonthlyCost(stats.projectedMonthlyUSD) : '—';

    return (
        <section aria-label="Statistics" className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Stat label="Total words" value={totalWords} />
            <Stat label="Streak (days)" value={streakDays} />
            <Stat label="Avg WPM" value={avgWPM} />
            <Stat label="Time saved" value={timeSaved} />
            <Stat label="Top provider" value={topProviderValue} />
            <Stat label="Est. cost / mo" value={projectedCost} />
        </section>
    );
}
