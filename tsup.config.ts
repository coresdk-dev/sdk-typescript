import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'middleware/express': 'src/middleware/express.ts',
    'middleware/fastify': 'src/middleware/fastify.ts',
    'middleware/next': 'src/middleware/next.ts',
    testing: 'src/testing.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
})
