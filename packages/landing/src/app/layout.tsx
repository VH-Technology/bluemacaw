import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: 'bluemacaw — cross-platform speech-to-text',
    description:
        'A dictation app you own. Press a shortcut, talk, get text pasted wherever your cursor is. Bring your own key for any of 9 STT providers. Open source.',
    icons: {
        icon: [
            { url: '/icon.svg', type: 'image/svg+xml' },
            { url: '/favicon.ico', sizes: 'any' },
        ],
    },
    openGraph: {
        title: 'bluemacaw — cross-platform speech-to-text',
        description:
            'A dictation app you own. Bring your own key, pick from 9 STT providers, ship text anywhere your cursor is.',
        type: 'website',
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
