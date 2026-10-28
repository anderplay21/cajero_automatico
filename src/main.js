import { createAtmService } from './domain/atm-service.js';
import { mountApp } from './ui/app.js';

const root = document.getElementById('app');
let dispose = null;

function boot() {
  if (dispose) {
    dispose();
  }
  root.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'app-root';
  root.append(container);
  const service = createAtmService();
  dispose = mountApp(container, service, { onReset: boot });
}

boot();
