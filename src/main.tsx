import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Register Service Worker for PWA Cache-First Pub Play
if ('serviceWorker' in navigator && (import.meta.env.PROD || window.location.hostname !== 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(
      (registration) => {
        console.log('Underworld PWA ServiceWorker active with scope:', registration.scope);
      },
      (err) => {
        console.warn('Underworld ServiceWorker registration failed:', err);
      }
    );
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
