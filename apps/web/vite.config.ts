import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = Number(process.env.FLOW_MACHINE_PORT ?? '3000');
const webPort = Number(process.env.FLOW_MACHINE_WEB_PORT ?? '5173');

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: webPort,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`
    }
  }
});
