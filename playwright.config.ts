import { defineConfig } from '@playwright/test';

// Prueba e2e contra la base real. Requiere TE_PASS (contraseña de las cuentas de prueba) en el entorno.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5210',
    locale: 'es-CL',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'dotnet run --project web --launch-profile http',
    url: 'http://localhost:5210',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
