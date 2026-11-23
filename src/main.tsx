import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

// Register PWA Service Worker with safe automatic updates
registerSW({
  immediate: true,
  onRegisterError(err) {
    console.warn('PWA Service Worker registration skipped:', err);
  },
});

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

// Smoothly dismiss the branded boot splash overlay once React mounts
requestAnimationFrame(() => {
  const splash = document.getElementById('pwa-boot-splash');
  if (splash) {
    splash.style.opacity = '0';
    splash.style.pointerEvents = 'none';
    setTimeout(() => splash.remove(), 320);
  }
});
