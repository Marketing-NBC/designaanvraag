#!/usr/bin/env node
/** Minimale statische server voor worker/test/fixture-site (lokale test van extract.mjs zonder internet). */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), 'fixture-site')
const port = Number(process.env.PORT ?? 8765)
const types = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.css': 'text/css' }

// touch.png en og.png worden on-the-fly uit logo.svg gemaakt.
async function generated(name) {
  const svg = await readFile(join(root, 'logo.svg'))
  if (name === '/touch.png') return sharp(svg, { density: 300 }).resize(180, 180, { fit: 'contain', background: '#0b3d91' }).png().toBuffer()
  if (name === '/og.png') return sharp({ create: { width: 1200, height: 630, channels: 4, background: '#0b3d91' } }).composite([{ input: await sharp(svg, { density: 300 }).resize({ width: 700 }).png().toBuffer(), gravity: 'centre' }]).png().toBuffer()
  return null
}

createServer(async (req, res) => {
  const path = req.url === '/' ? '/index.html' : req.url.split('?')[0]
  try {
    const gen = await generated(path)
    if (gen) {
      res.writeHead(200, { 'content-type': 'image/png' })
      return res.end(gen)
    }
    const file = await readFile(join(root, path))
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' })
    res.end(file)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
}).listen(port, '127.0.0.1', () => console.log(`fixture-site op http://127.0.0.1:${port}/`))
