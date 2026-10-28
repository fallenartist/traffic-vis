import { defineConfig } from 'vite';

// Relative asset URLs work on both / and /repository-name/ on GitHub Pages.
export default defineConfig({ base: './' });
