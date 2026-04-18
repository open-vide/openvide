import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { existsSync } from 'fs'

const appRoot = resolve(__dirname)
const nm = (pkg: string) => resolve(appRoot, 'node_modules', pkg)

const EVEN_GLASS_DIR = resolve(appRoot, '../even-glass')
const SDK_DIR = resolve(appRoot, 'node_modules/@evenrealities/even_hub_sdk')

export default [
  react(),
  tailwindcss(),
  {
    name: 'open-vide-g2-resolve',
    config() {
      return {
        resolve: {
          alias: {
            '@': resolve(appRoot, 'src'),
            'react/jsx-dev-runtime': nm('react/jsx-dev-runtime'),
            'react/jsx-runtime': nm('react/jsx-runtime'),
            'react-dom/client': nm('react-dom/client'),
            'react-dom': nm('react-dom'),
            'react': nm('react'),
            'react-router': nm('react-router'),
            'class-variance-authority': nm('class-variance-authority'),
            'clsx': nm('clsx'),
            'tailwind-merge': nm('tailwind-merge'),
            'upng-js': nm('upng-js'),
          },
        },
      }
    },
    resolveId(source: string) {
      if (source === '@evenrealities/even_hub_sdk') {
        return { id: resolve(SDK_DIR, 'dist/index.js'), external: false }
      }
      if (source === '@jappyjan/even-better-sdk') {
        return { id: resolve(appRoot, 'node_modules/@jappyjan/even-better-sdk/dist/index.js'), external: false }
      }
      if (source.startsWith('even-glass/')) {
        const subpath = source.slice('even-glass/'.length)
        const tsPath = resolve(EVEN_GLASS_DIR, subpath + '.ts')
        if (existsSync(tsPath)) return { id: tsPath, external: false }
        const jsPath = resolve(EVEN_GLASS_DIR, subpath + '.js')
        if (existsSync(jsPath)) return { id: jsPath, external: false }
        return { id: resolve(EVEN_GLASS_DIR, subpath), external: false }
      }
      return null
    },
  },
]
