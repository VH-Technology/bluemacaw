import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { DEFAULT_LOCAL_MODELS } from '@/providers/local';
import { useEffect, useMemo, useState } from 'react';

interface AddLocalModelDialogProps {
    open: boolean;
    onClose: () => void;
    onDownload: (modelId: string, url: string | undefined, displayName: string) => void;
}

export function AddLocalModelDialog({ open, onClose, onDownload }: AddLocalModelDialogProps) {
    const [selectedSize, setSelectedSize] = useState('ggml-medium.en');
    const [customUrl, setCustomUrl] = useState('');

    const selectedMeta = useMemo(
        () => DEFAULT_LOCAL_MODELS.find((model) => model.id === selectedSize),
        [selectedSize],
    );

    useEffect(() => {
        if (!open) return;
        setSelectedSize('ggml-medium.en');
        setCustomUrl('');
    }, [open]);

    function handleDownload() {
        const url = customUrl.trim() || undefined;
        onDownload(selectedSize, url, selectedMeta?.displayName ?? selectedSize);
        onClose();
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
        >
            <DialogContent data-testid="add-local-model-dialog">
                <DialogHeader>
                    <DialogTitle>Add local model</DialogTitle>
                    <DialogDescription>
                        Download a Whisper model to run on-device.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-3 text-sm font-medium normal-case">
                    <div className="flex flex-col gap-2">
                        <Label>Model size</Label>
                        <div className="flex flex-col gap-2">
                            {DEFAULT_LOCAL_MODELS.map((model) => (
                                <label
                                    key={model.id}
                                    className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${
                                        selectedSize === model.id
                                            ? 'border-brand-blue bg-brand-blue/5'
                                            : 'border-border'
                                    }`}
                                >
                                    <input
                                        type="radio"
                                        name="model-size"
                                        value={model.id}
                                        checked={selectedSize === model.id}
                                        onChange={() => setSelectedSize(model.id)}
                                    />
                                    <div className="flex flex-col gap-0.5">
                                        <span className="text-sm font-bold">
                                            {model.displayName}
                                        </span>
                                        <span className="font-mono text-xs text-muted-foreground">
                                            {model.id}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                            {model.description}
                                        </span>
                                    </div>
                                </label>
                            ))}
                        </div>
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label>Custom URL (optional)</Label>
                        <input
                            type="text"
                            value={customUrl}
                            onChange={(event) => setCustomUrl(event.target.value)}
                            placeholder="https://huggingface.co/.../ggml-custom.bin"
                            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-fg"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button onClick={handleDownload} data-testid="download-local-model">
                        Download
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
