import type { CapacitorConfig } from '@capacitor/cli';

function resolveHttpsBackendUrl(): string {
  const raw = String(process.env.APP_HTTPS_URL || '').trim().replace(/\/+$/, '');
  if (!raw) {
    throw new Error(
      'APP_HTTPS_URL environment variable is REQUIRED to build the Android APK. ' +
        'Provide your live deployed HTTPS URL (e.g. https://your-app.run.app).'
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid APP_HTTPS_URL: "${raw}". Must be a valid HTTPS URL.`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`APP_HTTPS_URL must use https:// (received "${parsed.protocol}").`);
  }
  if (['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname.toLowerCase())) {
    throw new Error('APP_HTTPS_URL cannot point to localhost. Deploy the Node.js backend to a live HTTPS server first.');
  }
  return parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname);
}

const backendUrl = resolveHttpsBackendUrl();
const backendHost = new URL(backendUrl).hostname;

const config: CapacitorConfig = {
  appId: 'com.sgncommittee.hisaab',
  appName: 'S.G.N Committee Hisaab',
  webDir: 'www',
  server: {
    url: backendUrl,
    cleartext: false,
    androidScheme: 'https',
    allowNavigation: [
      backendHost,
      'accounts.google.com',
      '*.google.com',
      '*.googleapis.com',
      '*.firebaseapp.com',
      '*.gstatic.com',
    ],
  },
  android: {
    backgroundColor: '#0B4F32',
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#0B4F32',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0B4F32',
      overlaysWebView: false,
    },
  },
};

export default config;
