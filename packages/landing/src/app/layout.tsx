import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    metadataBase: new URL('https://bluemacaw.com'),
    title: 'bluemacaw | Free Open Source AI Speech-to-Text Dictation App',
    description:
        'Free open-source voice dictation for Mac and Windows. Turn speech into text in any app, bring your own AI transcription provider, and keep your API keys on your machine.',
    applicationName: 'bluemacaw',
    keywords: [
        'free open source dictation app',
        'AI speech to text desktop app',
        'voice dictation for Mac and Windows',
        'voice to text app',
        'speech to text in any app',
        'private voice dictation',
        'open source voice typing',
        'bring your own key transcription',
    ],
    authors: [{ name: 'VH Technology' }],
    creator: 'VH Technology',
    publisher: 'VH Technology',
    category: 'productivity',
    alternates: {
        canonical: '/',
    },
    icons: {
        icon: [
            { url: '/icon.svg', type: 'image/svg+xml' },
            { url: '/favicon.ico', sizes: 'any' },
        ],
    },
    robots: {
        index: true,
        follow: true,
        googleBot: {
            index: true,
            follow: true,
            'max-image-preview': 'large',
            'max-snippet': -1,
            'max-video-preview': -1,
        },
    },
    openGraph: {
        title: 'bluemacaw | Free Open Source AI Speech-to-Text Dictation App',
        description:
            'A free open-source dictation app you own. Speak naturally, transcribe with your chosen AI provider, and paste text anywhere your cursor is.',
        url: 'https://bluemacaw.com/',
        siteName: 'bluemacaw',
        type: 'website',
    },
    twitter: {
        card: 'summary',
        title: 'bluemacaw | Free Open Source AI Speech-to-Text Dictation App',
        description:
            'Free open-source voice dictation for Mac and Windows. Bring your own AI transcription provider and keep your keys local.',
    },
};

// FOUC-prevention: applies `.dark` to <html> synchronously, before any
// stylesheet parses, matching whatever the React ThemeToggle will resolve
// once it mounts. Reads, in priority order:
//   1. `bluemacaw:resolved-theme` — cached value written by the toggle on every
//      apply. Always trusted when present, so the next cold start lines up
//      with the user's last actually-applied theme.
//   2. `bluemacaw:theme-preference` — the user's explicit choice. If 'system'
//      (or unset), falls through to prefers-color-scheme.
//   3. `prefers-color-scheme` — default for first launch.
// Keys match the desktop's useTheme conventions so reasoning is uniform.
const themeBootScript = `
(function(){try{
  var cached = localStorage.getItem('bluemacaw:resolved-theme');
  if (cached === 'dark' || cached === 'light') {
    if (cached === 'dark') document.documentElement.classList.add('dark');
    return;
  }
  var pref = localStorage.getItem('bluemacaw:theme-preference');
  if (pref === 'dark') { document.documentElement.classList.add('dark'); return; }
  if (pref === 'light') { return; }
  // pref is 'system' or unset — follow the OS.
  var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (prefersDark) document.documentElement.classList.add('dark');
}catch(e){}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static
                    string we author here, injected so the dark class lands on
                    <html> before first paint (no FOUC). The alternative —
                    rendering the script tag with children — is stripped by
                    React's HTML escaping. */}
                <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
            </head>
            <body>{children}</body>
        </html>
    );
}
