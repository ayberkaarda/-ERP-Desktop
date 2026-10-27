import { invoke } from '@tauri-apps/api/core'

import { describe, runSmoke } from './smoke'

async function start(): Promise<void> {
  const result = await runSmoke(invoke)
  const { status, output } = describe(result)
  const statusEl = document.getElementById('status')
  const outputEl = document.getElementById('output')
  if (statusEl) {
    statusEl.textContent = status
    statusEl.classList.toggle('error', !result.ok)
  }
  if (outputEl) outputEl.textContent = output
}

void start()
