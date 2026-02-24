'use strict'
// ─────────────────────────────────────────────────────────────────
// bootstrap-hci Management Portal — Express backend
//
// Endpoints:
//   GET  /api/status                  bootstrap status (reads status.json)
//   GET  /api/logs                    bootstrap container logs (last 300 lines)
//   POST /api/config                  save cluster.yaml
//   GET  /api/config                  read cluster.yaml
//   GET  /api/registry/pullsecret     { configured, registries }
//   POST /api/registry/pullsecret     save pull secret JSON
//   DELETE /api/registry/pullsecret   remove pull secret
//   POST /api/bootstrap/start         start bootstrap container
//   DELETE /api/bootstrap             stop + remove bootstrap container
//   POST /api/cmp/deploy              kubectl apply -f /cmp against cluster
//   GET  /api/cmp/status              CMP resource summary
// ─────────────────────────────────────────────────────────────────

const express   = require('express')
const Docker    = require('dockerode')
const fs        = require('fs')
const path      = require('path')
const yaml      = require('js-yaml')
const { execFile } = require('child_process')

const app    = express()
const docker = new Docker({ socketPath: '/var/run/docker.sock' })

const BOOTSTRAP_IMAGE  = process.env.BOOTSTRAP_IMAGE  || 'cr.imys.in/hci/bootk8:latest'
const OUTPUT_VOLUME    = process.env.OUTPUT_VOLUME     || 'hci-output'
const CONFIG_VOLUME    = process.env.CONFIG_VOLUME     || 'hci-config'
const OUTPUT_DIR       = process.env.OUTPUT_DIR        || '/output'
const CONFIG_DIR       = process.env.CONFIG_DIR        || '/config'
const CONTAINER_NAME   = 'bootstrap-hci-run'
const PORT             = process.env.PORT              || 3000

// Pull secret stored in the config volume so it persists across portal restarts
const PULL_SECRET_FILE = path.join(CONFIG_DIR, 'pull-secret.json')

app.use(express.json({ limit: '2mb' }))
app.use(express.text({ type: 'text/yaml', limit: '2mb' }))

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(200)
  next()
})

// Serve React UI static files
app.use(express.static(path.join(__dirname, 'public')))

// ── Helpers ───────────────────────────────────────────────────────

function readStatus () {
  const f = path.join(OUTPUT_DIR, 'status.json')
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch {}
  return { phase: 'idle', nodes: [], addons: [], kubeconfig_ready: false, message: '' }
}

async function findContainer () {
  try {
    const c = docker.getContainer(CONTAINER_NAME)
    const info = await c.inspect()
    return { container: c, info }
  } catch { return null }
}

function ensureVolumes (cb) {
  const create = name => new Promise((resolve, reject) =>
    docker.createVolume({ Name: name }, (err) => {
      if (err && !err.message.includes('already exists')) return reject(err)
      resolve()
    })
  )
  Promise.all([create(OUTPUT_VOLUME), create(CONFIG_VOLUME)])
    .then(() => cb(null))
    .catch(cb)
}

// Strip Docker's 8-byte multiplexed stream header from log buffers
function stripDockerHeaders (buf) {
  const lines = []
  let offset = 0
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset + 4)
    offset += 8
    if (offset + size > buf.length) break
    lines.push(buf.slice(offset, offset + size).toString('utf8'))
    offset += size
  }
  return lines.join('')
}

// Strip ANSI escape codes so terminal colours don't show as garbage in the browser
function stripAnsi (str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\x1b[()][0-9A-Za-z]/g, '')
}

// Read pull secret file and extract dockerode authconfig for a given registry hostname.
// Pull secret format (standard Docker config.json auths section):
//   { "auths": { "cr.imys.in": { "auth": "<base64(user:token)>" } } }
// Also accepts the flat form: { "cr.imys.in": { "auth": "..." } }
function loadAuthConfig (registry) {
  try {
    const raw = fs.readFileSync(PULL_SECRET_FILE, 'utf8')
    const ps  = JSON.parse(raw)
    const auths = ps.auths || ps
    const entry = auths[registry]
    if (!entry) return undefined

    if (entry.auth) {
      const decoded = Buffer.from(entry.auth, 'base64').toString('utf8')
      const colon   = decoded.indexOf(':')
      if (colon === -1) return undefined
      return {
        username:      decoded.slice(0, colon),
        password:      decoded.slice(colon + 1),
        serveraddress: registry,
      }
    }
    if (entry.username && entry.password) {
      return { username: entry.username, password: entry.password, serveraddress: registry }
    }
  } catch {}
  return undefined
}

// ── Config ────────────────────────────────────────────────────────

app.get('/api/config', (req, res) => {
  const f = path.join(CONFIG_DIR, 'cluster.yaml')
  if (!fs.existsSync(f)) return res.status(404).json({ error: 'No cluster.yaml found' })
  res.type('text/yaml').send(fs.readFileSync(f, 'utf8'))
})

app.post('/api/config', (req, res) => {
  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
  // Validate YAML before writing
  try { yaml.load(body) } catch (e) {
    return res.status(400).json({ error: `Invalid YAML: ${e.message}` })
  }
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(path.join(CONFIG_DIR, 'cluster.yaml'), body)
  res.json({ ok: true })
})

// ── Registry pull secret ──────────────────────────────────────────

app.get('/api/registry/pullsecret', (req, res) => {
  try {
    const raw  = fs.readFileSync(PULL_SECRET_FILE, 'utf8')
    const ps   = JSON.parse(raw)
    const auths = ps.auths || ps
    res.json({ configured: true, registries: Object.keys(auths) })
  } catch {
    res.json({ configured: false, registries: [] })
  }
})

app.post('/api/registry/pullsecret', (req, res) => {
  const body = req.body
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Request body must be JSON' })
  }

  // Accept either { auths: {...} } or flat { "registry": { "auth": "..." } }
  const auths = body.auths || body
  if (typeof auths !== 'object' || Object.keys(auths).length === 0) {
    return res.status(400).json({ error: 'Pull secret must contain at least one registry entry' })
  }

  // Validate each entry has auth or username+password
  for (const [reg, entry] of Object.entries(auths)) {
    if (!entry.auth && !(entry.username && entry.password)) {
      return res.status(400).json({
        error: `Entry for "${reg}" must have "auth" (base64 user:token) or "username"+"password"`
      })
    }
  }

  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
    // Always store in canonical { auths: {...} } form
    fs.writeFileSync(PULL_SECRET_FILE, JSON.stringify({ auths }, null, 2), { mode: 0o600 })
    res.json({ ok: true, registries: Object.keys(auths) })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/registry/pullsecret', (req, res) => {
  try { fs.unlinkSync(PULL_SECRET_FILE) } catch {}
  res.json({ ok: true })
})

// ── Bootstrap status + logs ───────────────────────────────────────

app.get('/api/status', async (req, res) => {
  const status = readStatus()
  const found = await findContainer()
  const running = found ? found.info.State.Running : false
  res.json({ ...status, container_running: running })
})

app.get('/api/logs', async (req, res) => {
  const found = await findContainer()
  if (!found) {
    const logFile = path.join(OUTPUT_DIR, 'bootstrap.log')
    if (fs.existsSync(logFile)) {
      const lines = stripAnsi(fs.readFileSync(logFile, 'utf8')).split('\n').slice(-300).join('\n')
      return res.type('text/plain').send(lines)
    }
    return res.type('text/plain').send('No bootstrap container found.')
  }
  try {
    const buf = await found.container.logs({ stdout: true, stderr: true, tail: 300 })
    res.type('text/plain').send(stripAnsi(stripDockerHeaders(Buffer.from(buf))))
  } catch (e) {
    res.type('text/plain').send(`Error fetching logs: ${e.message}`)
  }
})

// ── Bootstrap lifecycle ───────────────────────────────────────────

app.post('/api/bootstrap/start', (req, res) => {
  const { yaml: configYaml } = req.body || {}

  ensureVolumes(async (err) => {
    if (err) return res.status(500).json({ error: `Volume setup failed: ${err.message}` })

    // Save config if provided inline
    if (configYaml) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true })
      fs.writeFileSync(path.join(CONFIG_DIR, 'cluster.yaml'), configYaml)
    }

    // Guard: refuse to start if there is no cluster.yaml in the config volume
    if (!fs.existsSync(path.join(CONFIG_DIR, 'cluster.yaml'))) {
      return res.status(400).json({
        error: 'No cluster.yaml found in config volume. Save your configuration in the Config tab first.'
      })
    }

    // Remove any stale container and wait for Docker to fully release the name
    try {
      const old  = docker.getContainer(CONTAINER_NAME)
      const info = await old.inspect()
      if (info.State.Running) await old.stop({ t: 5 })
      await old.remove({ force: true })
      // Poll until inspect() throws 404 — createContainer races otherwise (409)
      for (let i = 0; i < 20; i++) {
        try { await old.inspect() } catch { break }  // 404 = fully gone
        await new Promise(r => setTimeout(r, 300))
      }
    } catch (e) {
      // 404 = container doesn't exist — that's fine
      if (e.statusCode !== 404) {
        return res.status(500).json({ error: `Failed to remove existing container: ${e.message}` })
      }
    }

    // Clear previous status
    try { fs.unlinkSync(path.join(OUTPUT_DIR, 'status.json')) } catch {}

    // Pull image — use stored pull secret if available
    const registry   = BOOTSTRAP_IMAGE.split('/')[0]
    const authconfig = loadAuthConfig(registry)
    try {
      await new Promise((resolve, reject) => {
        docker.pull(BOOTSTRAP_IMAGE, { authconfig }, (err, stream) => {
          if (err) return reject(err)
          docker.modem.followProgress(stream, (err) => err ? reject(err) : resolve())
        })
      })
    } catch (e) {
      return res.status(500).json({ error: `Failed to pull image ${BOOTSTRAP_IMAGE}: ${e.message}` })
    }

    try {
      const container = await docker.createContainer({
        Image: BOOTSTRAP_IMAGE,
        name:  CONTAINER_NAME,
        Cmd:   ['init'],
        HostConfig: {
          NetworkMode: 'host',
          Privileged:  true,
          Mounts: [
            { Type: 'volume', Source: OUTPUT_VOLUME, Target: '/output' },
            { Type: 'volume', Source: CONFIG_VOLUME, Target: '/config' },
          ],
        },
      })
      await container.start()

      // Forward bootstrap container logs to portal stdout so they appear in `docker compose logs`
      container.logs({ stdout: true, stderr: true, follow: true }, (err, stream) => {
        if (err || !stream) return
        docker.modem.demuxStream(
          stream,
          { write: chunk => process.stdout.write(`[bootstrap] ${chunk}`) },
          { write: chunk => process.stderr.write(`[bootstrap] ${chunk}`) }
        )
        stream.on('error', () => {})
        stream.on('end', () => console.log('[bootstrap] container finished'))
      })

      res.json({ ok: true, containerId: container.id })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })
})

app.delete('/api/bootstrap', async (req, res) => {
  const found = await findContainer()
  if (!found) return res.json({ ok: true, message: 'Nothing running' })
  try {
    if (found.info.State.Running) await found.container.stop({ t: 5 })
    await found.container.remove()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── CMP deployment ────────────────────────────────────────────────

app.post('/api/cmp/deploy', (req, res) => {
  const kubeconfig = path.join(OUTPUT_DIR, 'kubeconfig')
  if (!fs.existsSync(kubeconfig)) {
    return res.status(400).json({ error: 'Cluster not ready — kubeconfig not found' })
  }
  if (!fs.existsSync('/cmp') || fs.readdirSync('/cmp').filter(f => f.endsWith('.yaml') || f.endsWith('.yml')).length === 0) {
    return res.status(400).json({ error: 'No manifests found in /cmp — add your YAML files there' })
  }
  execFile('kubectl', ['apply', '-f', '/cmp/', `--kubeconfig=${kubeconfig}`],
    { timeout: 60000 },
    (err, stdout, stderr) => {
      if (err) return res.status(500).json({ error: stderr || err.message, output: stdout })
      res.json({ ok: true, output: stdout })
    }
  )
})

app.get('/api/cmp/manifests', (req, res) => {
  if (!fs.existsSync('/cmp')) return res.json({ files: [] })
  try {
    const files = fs.readdirSync('/cmp').filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    res.json({ files })
  } catch (e) {
    res.json({ files: [] })
  }
})

app.get('/api/cmp/status', (req, res) => {
  const kubeconfig = path.join(OUTPUT_DIR, 'kubeconfig')
  if (!fs.existsSync(kubeconfig)) return res.json({ ready: false, message: 'Cluster not ready' })
  execFile('kubectl', ['get', 'all', '-A', '--kubeconfig=' + kubeconfig, '-o', 'json'],
    { timeout: 15000 },
    (err, stdout) => {
      if (err) return res.json({ ready: false, message: err.message })
      try {
        const data = JSON.parse(stdout)
        res.json({ ready: true, itemCount: data.items?.length ?? 0 })
      } catch { res.json({ ready: false }) }
    }
  )
})

// ── SPA fallback ──────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.listen(PORT, () => console.log(`[portal] http://localhost:${PORT}`))
