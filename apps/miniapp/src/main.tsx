import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/jetbrains-mono';
import { App } from './App';
import { TelegramProvider } from './telegram/TelegramProvider';
import { VaultProvider } from './vault/context';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <TelegramProvider>
      <VaultProvider>
        <App />
      </VaultProvider>
    </TelegramProvider>
  </StrictMode>,
);
