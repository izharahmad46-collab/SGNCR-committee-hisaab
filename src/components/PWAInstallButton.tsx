import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, X, CheckCircle2 } from 'lucide-react';
import { usePWAInstall, useOnlineStatus } from '../hooks/usePWAInstall';
import type { Language } from '../types';

interface PWAInstallButtonProps {
  lang?: Language;
  variant?: 'header' | 'sidebar' | 'login';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  lang = 'en',
  variant = 'header',
}) => {
  const { isInstallable, isInstalled, isIOS, isAndroid, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [installing, setInstalling] = useState(false);

  // Hide completely when already running inside installed Android PWA / APK standalone mode
  if (isInstalled) {
    return null;
  }

  const label =
    lang === 'hi'
      ? 'ऐप इंस्टॉल करें'
      : lang === 'ur'
      ? 'ایپ انسٹال کریں'
      : 'Install App';

  async function handleClick() {
    if (isInstallable) {
      setInstalling(true);
      try {
        await install();
      } finally {
        setInstalling(false);
      }
      return;
    }
    setShowGuide(true);
  }

  const buttonClasses =
    variant === 'sidebar'
      ? 'w-full min-h-[38px] px-3 py-2 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs font-bold inline-flex items-center justify-center gap-2 transition-colors shadow-xs'
      : variant === 'login'
      ? 'min-h-[40px] px-3.5 py-2 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs font-bold inline-flex items-center gap-2 transition-colors shadow-xs'
      : 'min-h-[36px] px-3 py-1.5 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs font-bold inline-flex items-center gap-1.5 transition-colors shadow-xs shrink-0';

  return (
    <>
      <button
        type="button"
        disabled={installing}
        onClick={handleClick}
        className={buttonClasses}
        title="Install S.G.N Committee Hisaab on your device"
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span>{installing ? 'Installing...' : label}</span>
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-[100] bg-black/55 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-[#0B4F32]/10 dark:bg-emerald-900/40 text-[#0B4F32] dark:text-emerald-300 flex items-center justify-center shrink-0">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {lang === 'hi' ? 'S.G.N Committee Hisaab इंस्टॉल करें' : 'Install S.G.N Committee Hisaab'}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {isIOS ? 'iPhone / iPad (Safari)' : isAndroid ? 'Android (Google Chrome)' : 'Chrome / Edge App'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isIOS ? (
              <ol className="space-y-2.5 text-xs sm:text-sm text-slate-700 dark:text-slate-300 list-decimal list-inside">
                <li>
                  Safari ब्राउज़र में नीचे <strong>Share</strong> आइकन पर टैप करें।
                </li>
                <li>
                  नीचे स्क्रॉल करें और <strong>Add to Home Screen</strong> चुनें।
                </li>
                <li>
                  ऊपर दाईं ओर <strong>Add</strong> दबाएं — ऐप आपकी होम स्क्रीन पर आ जाएगा।
                </li>
              </ol>
            ) : (
              <ol className="space-y-2.5 text-xs sm:text-sm text-slate-700 dark:text-slate-300 list-decimal list-inside">
                <li>
                  इस ऐप को सीधे <strong>Google Chrome</strong> में उसके HTTPS लिंक पर खोलें।
                </li>
                <li>
                  ऊपर दाईं ओर Chrome के <strong>⋮ (तीन डॉट)</strong> मेन्यू पर टैप करें।
                </li>
                <li>
                  <strong>&ldquo;Install app&rdquo;</strong> या <strong>&ldquo;Add to Home screen&rdquo;</strong> चुनकर <strong>Install</strong> दबाएं।
                </li>
              </ol>
            )}

            <div className="rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 p-3 flex items-start gap-2 text-xs text-emerald-900 dark:text-emerald-200">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[#0B4F32] dark:text-emerald-400" />
              <span>
                इंस्टॉल होने के बाद यह ऐप बिना ब्राउज़र बार के पूरी स्क्रीन (Full-Screen Android App) में खुलेगा और सभी एडमिन, मेंबर व Firebase फीचर्स पहले की तरह चलेंगे।
              </span>
            </div>

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full min-h-[42px] rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs font-bold transition-colors"
            >
              {lang === 'hi' ? 'ठीक है' : 'Got it'}
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC<{ lang?: Language }> = ({ lang = 'en' }) => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="no-print fixed bottom-16 lg:bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg">
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>
        {lang === 'hi'
          ? 'ऑफ़लाइन मोड — इंटरनेट कनेक्शन वापस आने पर डेटा सिंक होगा।'
          : 'Offline Mode — Reconnect to sync live committee data.'}
      </span>
    </div>
  );
};
