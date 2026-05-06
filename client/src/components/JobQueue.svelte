<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listJobs, watchJob, dismissJob, getJobLog, formatBytes, type Job } from '../api.js';

  let jobs: Job[] = [];
  let cleanups: (() => void)[] = [];
  let pollTimer: ReturnType<typeof setInterval>;

  // ETA tracking: phase start time + percent at that moment, keyed by job id
  let etaTrackers: Record<string, { startTime: number; startPercent: number }> = {};

  function trackPhase(id: string, phase: string, percent: number) {
    if (phase === 'downloading' || phase === 'transcoding') {
      if (!etaTrackers[id]) {
        etaTrackers[id] = { startTime: Date.now(), startPercent: percent };
        etaTrackers = etaTrackers;
      }
    } else {
      if (etaTrackers[id]) {
        delete etaTrackers[id];
        etaTrackers = etaTrackers;
      }
    }
  }

  function formatEta(job: Job): string | null {
    if (job.phase !== 'downloading' && job.phase !== 'transcoding') return null;
    if (job.percent <= 2) return null;
    const tracker = etaTrackers[job.id];
    if (!tracker) return null;
    const elapsed = (Date.now() - tracker.startTime) / 1000;
    const made = job.percent - tracker.startPercent;
    if (made <= 0 || elapsed < 4) return null;
    const etaSecs = Math.round((elapsed / made) * (100 - job.percent));
    if (etaSecs <= 0 || etaSecs > 86400) return null;
    if (etaSecs < 60) return `~${etaSecs}s`;
    const m = Math.floor(etaSecs / 60), s = etaSecs % 60;
    return s > 0 ? `~${m}m ${s}s` : `~${m}m`;
  }

  // log state keyed by job id
  let openLogs = new Set<string>();
  let logContent: Record<string, string> = {};
  let logPollers: Record<string, ReturnType<typeof setInterval>> = {};

  const phaseLabel: Record<string, string> = {
    queued: 'Queued',
    downloading: 'Downloading',
    transcoding: 'Transcoding',
    moving: 'Moving',
    done: 'Done',
    error: 'Error',
  };

  const phaseProgressColor: Record<string, string> = {
    downloading: '#3b82f6',
    transcoding: '#8b5cf6',
    moving: '#f59e0b',
  };

  const phaseColor: Record<string, string> = {
    queued: '#6b7280',
    downloading: '#3b82f6',
    transcoding: '#8b5cf6',
    moving: '#f59e0b',
    done: '#22c55e',
    error: '#ef4444',
  };

  async function refresh() {
    try {
      const fresh = await listJobs();
      for (const j of fresh) {
        const existing = jobs.find((x) => x.id === j.id);
        if (!existing) {
          jobs = [j, ...jobs];
          if (j.phase !== 'done' && j.phase !== 'error') {
            trackPhase(j.id, j.phase, j.percent);
            const stop = watchJob(j.id, (update) => {
              const prev = jobs.find(x => x.id === j.id);
              if (prev && update.phase !== prev.phase) {
                // phase changed — reset ETA tracker for the new phase
                delete etaTrackers[j.id];
                etaTrackers = etaTrackers;
              }
              trackPhase(j.id, update.phase, update.percent ?? 0);
              jobs = jobs.map((x) => (x.id === j.id ? { ...x, ...update } : x));
              if (openLogs.has(j.id) && update.phase === 'transcoding') fetchLog(j.id);
            });
            cleanups.push(stop);
          }
        }
      }
    } catch {/* ignore */}
  }

  export async function addJob(id: string) {
    await refresh();
    const stop = watchJob(id, (update) => {
      jobs = jobs.map((x) => (x.id === id ? { ...x, ...update } : x));
    });
    cleanups.push(stop);
  }

  async function fetchLog(id: string) {
    logContent[id] = await getJobLog(id);
    logContent = logContent; // trigger reactivity
  }

  function toggleLog(job: Job) {
    if (openLogs.has(job.id)) {
      openLogs.delete(job.id);
      openLogs = openLogs;
      clearInterval(logPollers[job.id]);
      delete logPollers[job.id];
    } else {
      openLogs.add(job.id);
      openLogs = openLogs;
      fetchLog(job.id);
      // Poll while transcoding
      if (job.phase === 'transcoding') {
        logPollers[job.id] = setInterval(() => {
          const current = jobs.find(j => j.id === job.id);
          if (!current || (current.phase !== 'transcoding' && current.phase !== 'downloading')) {
            clearInterval(logPollers[job.id]);
            delete logPollers[job.id];
          }
          fetchLog(job.id);
        }, 1500);
      }
    }
  }

  onMount(() => {
    refresh();
    pollTimer = setInterval(refresh, 10_000);
  });

  onDestroy(() => {
    clearInterval(pollTimer);
    cleanups.forEach((fn) => fn());
    Object.values(logPollers).forEach(clearInterval);
  });
</script>

{#if jobs.length > 0}
  <section class="queue">
    <h2>Import Queue</h2>
    <ul>
      {#each jobs as job (job.id)}
        <li class="job-card">
          <div class="job-header">
            <span class="job-title">{job.title}</span>
            <div class="job-header-right">
              <span class="phase-badge" style="background:{phaseColor[job.phase] ?? '#6b7280'}">
                {phaseLabel[job.phase] ?? job.phase}
              </span>
              {#if job.phase === 'done' || job.phase === 'error'}
                <button class="dismiss-btn" title="Dismiss" on:click={() => {
                  dismissJob(job.id);
                  jobs = jobs.filter(j => j.id !== job.id);
                }}>✕</button>
              {/if}
            </div>
          </div>

          {#if job.phase !== 'queued' && job.phase !== 'done' && job.phase !== 'error'}
            <div class="progress-bar">
              <div class="progress-fill" style="width:{job.percent}%; background:{phaseProgressColor[job.phase] ?? 'var(--accent)'}"></div>
            </div>
          {/if}

          <div class="job-footer">
            <div class="job-footer-left">
              {#if job.message}
                <span class="job-message" class:error-msg={job.phase === 'error'}>{job.message}</span>
              {/if}
              {#if formatEta(job)}
                <span class="eta">ETA {formatEta(job)}</span>
              {/if}
            </div>
            <div class="job-footer-right">
              {#if job.downloadedBytes !== null}
                <span class="downloaded-size">{formatBytes(job.downloadedBytes)} downloaded</span>
              {/if}
              <button class="log-btn" class:active={openLogs.has(job.id)} on:click={() => toggleLog(job)}>
                {openLogs.has(job.id) ? '▲ Hide logs' : '▼ Logs'}
              </button>
            </div>
          </div> <!-- end job-footer -->

          {#if openLogs.has(job.id)}
            <div class="log-panel">
              {#if job.command}
                <div class="command-block">
                  <code class="command-code">{job.command}</code>
                </div>
              {/if}
              {#if logContent[job.id]}
                <pre class="log-pre">{logContent[job.id]}</pre>
              {:else}
                <p class="log-empty">No ffmpeg log yet.</p>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .queue { margin-top: 1.5rem; }
  h2 { font-size: 1rem; font-weight: 700; margin: 0 0 0.6rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .job-card {
    padding: 0.65rem 0.85rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-card);
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .job-header { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
  .job-header-right { display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0; }
  .job-title { font-size: 0.9rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .phase-badge { font-size: 0.7rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 4px; color: #fff; white-space: nowrap; }
  .dismiss-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 0.75rem;
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    line-height: 1;
    transition: background 0.15s, color 0.15s;
  }
  .dismiss-btn:hover { background: var(--bg-input); color: var(--error); }
  .progress-bar { height: 6px; background: var(--bg-input); border-radius: 3px; overflow: hidden; }
  .progress-fill { height: 100%; background: var(--accent); border-radius: 3px; transition: width 0.3s ease; }
  .job-footer { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
  .job-footer-left { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
  .job-footer-right { display: flex; align-items: center; gap: 0.75rem; flex-shrink: 0; }
  .job-message { font-size: 0.8rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .error-msg { color: var(--error); }
  .eta { font-size: 0.75rem; color: var(--text-muted); white-space: nowrap; }
  .downloaded-size { font-size: 0.75rem; color: var(--accent); font-weight: 600; white-space: nowrap; }
  .log-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-muted);
    font-size: 0.7rem;
    padding: 0.15rem 0.5rem;
    white-space: nowrap;
    transition: border-color 0.15s, color 0.15s;
  }
  .log-btn:hover, .log-btn.active { border-color: var(--accent); color: var(--accent); }
  .command-block {
    background: #0f172a;
    border-radius: 4px;
    padding: 0.35rem 0.6rem;
    overflow-x: auto;
  }
  .command-code {
    font-family: ui-monospace, 'Cascadia Code', 'Fira Code', monospace;
    font-size: 0.68rem;
    color: #94a3b8;
    white-space: pre;
    word-break: keep-all;
  }
  .log-panel {
    margin-top: 0.25rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }
  .log-pre {
    margin: 0;
    padding: 0.6rem 0.75rem;
    font-size: 0.72rem;
    font-family: ui-monospace, 'Cascadia Code', 'Fira Code', monospace;
    background: #0f172a;
    color: #94a3b8;
    max-height: 260px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .log-empty { margin: 0; padding: 0.5rem 0.75rem; font-size: 0.8rem; color: var(--text-muted); }
</style>
