import { cn } from '@/lib/utils';
import type { Model } from '@/providers';
import { modelPriceLabel } from '@/providers/util';

interface ModelModeBadgeProps {
    mode: Model['mode'];
    className?: string;
}

export function ModelModeBadge({ mode, className }: ModelModeBadgeProps) {
    if (mode !== 'realtime') return null;
    return (
        <span
            className={cn(
                'inline-flex items-center rounded-pill border border-main/30 bg-main/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-widest text-main',
                className,
            )}
        >
            Realtime
        </span>
    );
}

interface ModelPickerProps {
    models: Model[];
    selectedModelId: string;
    onSelect: (modelId: string) => void;
    providerId?: string;
    disabled?: boolean;
}

export function ModelPicker({
    models,
    selectedModelId,
    onSelect,
    providerId = '',
    disabled = false,
}: ModelPickerProps) {
    if (models.length === 0) {
        return (
            <div
                className="rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-5 text-sm text-muted-foreground"
                data-testid="model-picker-empty"
            >
                No models available.
            </div>
        );
    }

    return (
        <div className="grid gap-2 sm:grid-cols-2" data-testid="model-picker">
            {models.map((model) => {
                const selected = model.id === selectedModelId;
                const price = providerId ? modelPriceLabel(providerId, model.id) : null;
                return (
                    <button
                        key={model.id}
                        type="button"
                        aria-pressed={selected}
                        disabled={disabled}
                        onClick={() => onSelect(model.id)}
                        data-testid={`model-card-${model.id}`}
                        className={cn(
                            'flex min-h-28 flex-col gap-2 rounded-2xl border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-main/40 disabled:pointer-events-none disabled:opacity-50',
                            selected
                                ? 'border-main bg-main/10 shadow-card'
                                : 'border-border bg-surface hover:-translate-y-0.5 hover:border-main/40 hover:shadow-card',
                        )}
                    >
                        <span className="flex items-start justify-between gap-2">
                            <span className="text-sm font-extrabold leading-tight">
                                {model.displayName}
                            </span>
                            <ModelModeBadge mode={model.mode} />
                        </span>
                        <span className="font-mono text-[11px] font-bold text-muted-foreground">
                            {model.id}
                        </span>
                        {model.description && (
                            <span className="text-xs font-medium leading-snug text-muted-foreground">
                                {model.description}
                            </span>
                        )}
                        {price && (
                            <span className="mt-auto w-fit rounded-pill bg-muted px-2 py-1 text-[11px] font-extrabold text-fg/80">
                                {price}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
