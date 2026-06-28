import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type HistoryStats, getHistoryStats } from '@/lib/db';
import { useEffect, useState } from 'react';

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

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <Card className="border border-border/70 bg-surface/95 shadow-card transition-shadow hover:shadow-card-lg">
            <CardHeader className="mb-1 pb-0">
                <CardTitle className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-muted-foreground">
                    {label}
                </CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-black leading-none tracking-tight text-brand-navy dark:text-fg">
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
    const topProvider = stats?.topProvider ?? '—';
    const projectedCost = stats ? formatMonthlyCost(stats.projectedMonthlyUSD) : '—';

    return (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Stat label="Total words" value={totalWords} />
            <Stat label="Streak (days)" value={streakDays} />
            <Stat label="Avg WPM" value={avgWPM} />
            <Stat label="Time saved" value={timeSaved} />
            <Stat label="Top provider" value={topProvider} />
            <Stat label="Est. cost / mo" value={projectedCost} />
        </div>
    );
}
