import type { TranscriptionModel } from 'ai';
import { experimental_transcribe as transcribeAi } from 'ai';
import { PROVIDERS } from '../providers';
import { getActiveModelConfigId, getModelConfigWithApiKey } from './db';
import { vox } from './invoke';

/**
 * Batch transcription path. Realtime models must be driven by the
 * recording controller's streaming branch instead — they don't accept a
 * one-shot Blob. Throws clearly if called with a realtime model active so
 * a wiring mistake fails loudly rather than silently producing garbage.
 */
export async function transcribe(audio: Blob): Promise<string> {
    const activeId = await getActiveModelConfigId();
    if (!activeId) throw new Error('No model selected');
    const cfg = await getModelConfigWithApiKey(activeId);
    if (!cfg) throw new Error(`Active model config ${activeId} no longer exists`);
    const provider = PROVIDERS.find((p) => p.id === cfg.providerId);
    if (!provider) throw new Error(`Unknown provider: ${cfg.providerId}`);
    const modelEntry = provider.defaultModels.find((m) => m.id === cfg.modelId);
    if (modelEntry?.mode === 'realtime') {
        throw new Error(
            `${cfg.modelId} is a realtime model — transcribe() is for batch only. Use the recording controller's realtime path.`,
        );
    }
    const apiKey = await vox.getSecret(cfg.apiKeyId);
    if (!apiKey) throw new Error(`No API key found in keychain for ${cfg.apiKeyNickname}`);
    // Providers the AI SDK can't model (e.g. xAI Grok STT) implement a direct
    // REST call via transcribeBatch instead of an experimental_transcribe model.
    if (provider.transcribeBatch) {
        return provider.transcribeBatch(
            new Uint8Array(await audio.arrayBuffer()),
            cfg.modelId,
            apiKey,
        );
    }
    const model = provider.makeModel(cfg.modelId, apiKey);
    const { text } = await transcribeAi({
        model: model as TranscriptionModel,
        audio: new Uint8Array(await audio.arrayBuffer()),
    });
    return text;
}
