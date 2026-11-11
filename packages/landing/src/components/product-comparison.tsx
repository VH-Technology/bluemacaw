import Image from 'next/image';

type Product = 'bluemacaw' | 'Wispr Flow' | 'Vowen' | 'FluidVoice';
type Verdict = 'yes' | 'no' | 'mid' | 'bird';

const PRODUCTS: Array<{ name: Product; logo: React.ReactNode }> = [
    {
        name: 'bluemacaw',
        logo: <Image src="/logo.svg" alt="" width={34} height={34} className="rounded-lg" />,
    },
    {
        name: 'Wispr Flow',
        logo: (
            <img
                src="https://cdn.prod.website-files.com/682f84b3838c89f8ff7667db/68d427c7c5f98194a1c53c61_logo-symbol-dark.png"
                alt=""
                className="h-8 w-8 rounded-lg object-contain"
            />
        ),
    },
    {
        name: 'Vowen',
        logo: (
            <svg aria-hidden="true" viewBox="0 0 311.41 339.02" className="h-8 w-8 fill-[#756AB6]">
                <path d="M304.41,1.98c-11.64-6.5-22.66,4.23-27.39,14.57-44.39,75.89-83.19,155.85-130.81,229.5-14.87,14.47-40.23,10.18-49.96-7.81-6.82-11.88-1.85-26.38,4.55-37.54,29.51-55.4,58.99-110.7,88.19-166.26,2.43-4.71,4.99-10.15,4.88-15.35.28-11.4-14.51-16.69-23.01-10.19-3.99,2.74-6.81,7.16-9.29,11.35-20.82,36.61-41.43,73.43-61.94,109.73-5.84,10.29-12.9,21.93-25.15,24.92-22.02,6.64-45.42-16.43-37.57-38.54,12.4-29.09,31.23-55.26,45.27-83.54,2.69-5.28,5.33-11.29,3.73-17.23-2.19-8.59-13.9-12.69-21.3-7.89-6.07,3.71-9.74,10.91-13.27,16.98-10.02,18.26-20.66,35.92-30.61,54.08-5.58,11.34-11.57,22.57-17.78,33.57-3.64,6.14-4.04,12.98-.45,19.29,35.49,64.46,70.45,128.72,106.01,193.09,3.88,7.05,10.68,15.07,19.04,14.26,8.43-.38,14.87-9.43,18.72-16.72,53.24-97.76,106.97-195.19,160.36-292.93,5.05-8.27,8.21-21.4-1.64-27l-.58-.33Z" />
            </svg>
        ),
    },
    {
        name: 'FluidVoice',
        logo: (
            <img
                src="https://altic.dev/icon-512.png"
                alt=""
                className="h-8 w-8 rounded-lg object-contain"
            />
        ),
    },
];

const SYMBOLS: Record<Verdict, { label: string; className: string }> = {
    yes: { label: '✓', className: 'bg-emerald-500 text-white' },
    no: { label: '×', className: 'bg-rose-500 text-white' },
    mid: { label: '~', className: 'bg-brand-yellow text-fg' },
    bird: { label: '✓', className: 'bg-brand-yellow text-fg' },
};

const ROWS = [
    {
        label: 'Free, no upsells',
        values: {
            bluemacaw: { verdict: 'yes', note: 'Free + no upsell path' },
            'Wispr Flow': { verdict: 'no', note: 'Paid-plan funnel' },
            Vowen: { verdict: 'mid', note: 'Free, but product upsell path' },
            FluidVoice: { verdict: 'mid', note: 'Free, but wants you on their model' },
        },
    },
    {
        label: 'Open source',
        values: {
            bluemacaw: { verdict: 'yes', note: 'Apache 2.0, truly open source' },
            'Wispr Flow': { verdict: 'no', note: 'Closed source' },
            Vowen: { verdict: 'no', note: 'Closed source' },
            FluidVoice: { verdict: 'mid', note: 'GPLv3, always tied to them' },
        },
    },
    {
        label: 'Can choose model',
        values: {
            bluemacaw: { verdict: 'yes', note: 'BYOK + model picker' },
            'Wispr Flow': { verdict: 'no', note: 'Wispr chooses' },
            Vowen: { verdict: 'yes', note: 'Model picker' },
            FluidVoice: { verdict: 'no', note: 'Bundled model path' },
        },
    },
    {
        label: 'Supports local and cloud models',
        values: {
            bluemacaw: { verdict: 'yes', note: 'Local or cloud, your call' },
            'Wispr Flow': { verdict: 'no', note: 'Cloud only' },
            Vowen: { verdict: 'yes', note: 'Local + cloud' },
            FluidVoice: { verdict: 'no', note: 'Forces a 3GB model download' },
        },
    },
    {
        label: 'Bird',
        values: {
            bluemacaw: { verdict: 'bird', note: 'Blue macaw' },
            'Wispr Flow': { verdict: 'no', note: 'No bird' },
            Vowen: { verdict: 'no', note: 'No bird' },
            FluidVoice: { verdict: 'no', note: 'No bird' },
        },
    },
] satisfies Array<{
    label: string;
    values: Record<Product, { verdict: Verdict; note: string }>;
}>;

function VerdictCell({ verdict, note }: { verdict: Verdict; note: string }) {
    const symbol = SYMBOLS[verdict];

    return (
        <div className="flex items-center gap-3">
            <span
                aria-hidden="true"
                className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lg font-black ${symbol.className}`}
            >
                {symbol.label}
            </span>
            <span className="leading-snug">{note}</span>
        </div>
    );
}

export function ProductComparison() {
    return (
        <section className="mx-auto max-w-6xl px-6 py-20">
            <div className="mb-10 text-center">
                <p className="text-sm font-black uppercase tracking-[0.2em] text-main">
                    Honest comparison
                </p>
                <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
                    How bluemacaw stacks up.
                </h2>
                <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
                    Same voice-to-text category, very different tradeoffs around source code, model
                    control, upsells, and whether the mascot can fly.
                </p>
            </div>

            <div className="overflow-hidden rounded-3xl bg-surface shadow-card">
                <div className="overflow-x-auto">
                    <table
                        aria-label="Voice dictation product comparison"
                        className="min-w-[920px] border-collapse text-left text-sm"
                    >
                        <thead>
                            <tr className="border-b bg-muted/60">
                                <th
                                    scope="col"
                                    className="w-52 px-5 py-4 text-xs uppercase tracking-wide text-muted-foreground"
                                >
                                    Dimension
                                </th>
                                {PRODUCTS.map((product) => (
                                    <th
                                        key={product.name}
                                        scope="col"
                                        className={`px-5 py-4 text-base font-black ${
                                            product.name === 'bluemacaw'
                                                ? 'bg-main text-main-foreground'
                                                : 'text-fg'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm">
                                                {product.logo}
                                            </span>
                                            <span>{product.name}</span>
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {ROWS.map((row) => (
                                <tr key={row.label} className="border-b last:border-b-0">
                                    <th
                                        scope="row"
                                        className="px-5 py-5 align-top font-black text-fg"
                                    >
                                        {row.label}
                                    </th>
                                    {PRODUCTS.map((product) => (
                                        <td
                                            key={product.name}
                                            className={`px-5 py-5 align-top leading-relaxed ${
                                                product.name === 'bluemacaw'
                                                    ? 'bg-main text-main-foreground'
                                                    : 'text-muted-foreground'
                                            }`}
                                        >
                                            <VerdictCell {...row.values[product.name]} />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </section>
    );
}
