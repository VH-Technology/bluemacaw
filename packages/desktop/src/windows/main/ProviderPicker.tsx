import { cn } from '@/lib/utils';
import type { ProviderConfig } from '@/providers';

interface ProviderPickerProps {
    providers: readonly ProviderConfig[];
    selectedProviderId: string;
    onSelect: (providerId: string) => void;
}

export function ProviderPicker({ providers, selectedProviderId, onSelect }: ProviderPickerProps) {
    return (
        <div
            className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
            data-testid="provider-picker"
        >
            {providers.map((provider) => {
                const selected = provider.id === selectedProviderId;
                const realtimeCount = provider.defaultModels.filter(
                    (model) => model.mode === 'realtime',
                ).length;
                return (
                    <button
                        key={provider.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => onSelect(provider.id)}
                        data-testid={`provider-card-${provider.id}`}
                        className={cn(
                            'flex min-h-32 flex-col items-center justify-center gap-2 rounded-2xl border p-3 text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-main/40',
                            selected
                                ? 'border-main bg-main/10 shadow-card'
                                : 'border-border bg-surface hover:-translate-y-0.5 hover:border-main/40 hover:shadow-card',
                        )}
                    >
                        {provider.logoSrc ? (
                            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-muted p-2">
                                <img
                                    src={provider.logoSrc}
                                    alt=""
                                    aria-hidden="true"
                                    data-testid={`provider-logo-${provider.id}`}
                                    className="h-full w-full object-contain opacity-90 dark:invert"
                                />
                            </span>
                        ) : (
                            <span
                                aria-hidden="true"
                                className={cn(
                                    'flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-extrabold uppercase',
                                    selected ? 'bg-main text-main-foreground' : 'bg-muted text-fg',
                                )}
                            >
                                {provider.name.slice(0, 2)}
                            </span>
                        )}
                        <span className="flex min-w-0 flex-col items-center gap-1">
                            <span className="text-sm font-extrabold leading-tight">
                                {provider.name}
                            </span>
                            <span className="text-[11px] font-medium leading-tight text-muted-foreground">
                                {provider.defaultModels.length} model
                                {provider.defaultModels.length === 1 ? '' : 's'}
                                {realtimeCount > 0 ? ` · ${realtimeCount} realtime` : ' · batch'}
                            </span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
