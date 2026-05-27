import { PROVIDERS } from './index';

/**
 * Resolves a provider id to its display name, or returns the id verbatim if unknown.
 */
export function providerName(id: string): string {
    return PROVIDERS.find((p) => p.id === id)?.name ?? id;
}

/**
 * Formats a per-minute USD price as a human-readable label.
 *
 * Cent-or-more rates use 4 decimals (e.g. "$0.0060/min"). Sub-cent rates use up
 * to 6 decimals with trailing zeros trimmed.
 */
export function formatPricePerMin(perMinuteUSD: number): string {
    if (perMinuteUSD >= 0.01) return `$${perMinuteUSD.toFixed(4)}/min`;
    return `$${perMinuteUSD.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}/min`;
}

/**
 * Returns the formatted price-per-min for a given provider/model pair, or null
 * when the provider is unknown or the model has no pricing entry.
 */
export function modelPriceLabel(providerId: string, modelId: string): string | null {
    const entry = PROVIDERS.find((p) => p.id === providerId)?.pricing[modelId];
    if (!entry) return null;
    return formatPricePerMin(entry.perMinuteUSD);
}

/**
 * Returns the raw per-minute USD rate for a provider/model pair, or null when
 * the provider is unknown or the model has no pricing entry. Used by the cost
 * forecast to turn recorded audio minutes into a dollar estimate.
 */
export function modelPricePerMinute(providerId: string, modelId: string): number | null {
    return PROVIDERS.find((p) => p.id === providerId)?.pricing[modelId]?.perMinuteUSD ?? null;
}
