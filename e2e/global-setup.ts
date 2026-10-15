import { execSync } from 'node:child_process';

/** Build the single-file edition so e2e/single.spec.ts tests the real artifact. */
export default function globalSetup(): void {
  execSync('npx vite build --mode single', { stdio: 'inherit' });
}
