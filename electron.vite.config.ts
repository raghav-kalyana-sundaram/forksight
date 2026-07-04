import { cpSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function copyOpeningsDataPlugin(): { name: string; closeBundle: () => void } {
  return {
    name: 'copy-openings-data',
    closeBundle() {
      const destDir = resolve('out/main/data')
      mkdirSync(destDir, { recursive: true })
      cpSync(
        resolve('src/main/data/chess-openings.tsv'),
        resolve(destDir, 'chess-openings.tsv')
      )
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyOpeningsDataPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
