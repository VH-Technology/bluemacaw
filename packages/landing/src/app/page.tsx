import { Analytics } from '@/components/analytics';
import { Demo } from '@/components/demo';
import { Download } from '@/components/download';
import { Features } from '@/components/features';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { Hero } from '@/components/hero';
import { PrivacyTeaser } from '@/components/privacy-teaser';
import { ProductComparison } from '@/components/product-comparison';
import { ProvidersGrid } from '@/components/providers-grid';
import { SEO_FAQS, SeoFaq } from '@/components/seo-faq';
import { APP_VERSION } from '@/lib/version';

const structuredData = [
    {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'bluemacaw',
        applicationCategory: 'ProductivityApplication',
        operatingSystem: 'macOS, Windows',
        softwareVersion: APP_VERSION,
        url: 'https://bluemacaw.com/',
        downloadUrl: 'https://github.com/VH-Technology/bluemacaw/releases/latest',
        codeRepository: 'https://github.com/VH-Technology/bluemacaw',
        license: 'https://www.apache.org/licenses/LICENSE-2.0',
        description:
            'Free open-source AI speech-to-text dictation app for Mac and Windows. Dictate in any app, bring your own transcription provider, and keep API keys on your machine.',
        offers: {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'USD',
        },
        featureList: [
            'Free open-source voice dictation',
            'AI speech-to-text in any app',
            'Bring your own transcription provider API key',
            'macOS and Windows support',
            'No hosted bluemacaw backend',
        ],
    },
    {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: SEO_FAQS.map((faq) => ({
            '@type': 'Question',
            name: faq.question,
            acceptedAnswer: {
                '@type': 'Answer',
                text: faq.answer,
            },
        })),
    },
];
const structuredDataJson = JSON.stringify(structuredData);

export default function HomePage() {
    return (
        <>
            <script type="application/ld+json">{structuredDataJson}</script>
            <Analytics />
            <Header />
            <main>
                <Hero />
                <Demo />
                <Features />
                <ProvidersGrid />
                <ProductComparison />
                <PrivacyTeaser />
                <SeoFaq />
                <Download />
            </main>
            <Footer version={APP_VERSION} />
        </>
    );
}
