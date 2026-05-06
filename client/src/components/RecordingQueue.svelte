<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listRecordings, formatDate, formatTime, formatDuration, type DvrEntry } from '../api.js';

  let entries: DvrEntry[] = [];
  let fetchError = '';
  let pollTimer: ReturnType<typeof setInterval>;

  async function refresh() {
    try {
      entries = await listRecordings();
      fetchError = '';
    } catch (e: any) {
      fetchError = e.message ?? 'Failed';
      entries = [];
    }
  }

  onMount(() => {
    refresh();
    pollTimer = setInterval(refresh, 20_000);
  });

  onDestroy(() => clearInterval(pollTimer));

  const statusLabel: Record<string, string> = {
    scheduled: 'Scheduled',
    recording: 'Recording',
  };

  const statusColor: Record<string, string> = {
    scheduled: '#3b82f6',
    recording: '#ef4444',
  };
</script>

{#if fetchError}
  <section class="queue">
    <h2>Scheduled Recordings</h2>
    <p class="fetch-error">{fetchError}</p>
  </section>
{:else if entries.length > 0}
  <section class="queue">
    <h2>Scheduled Recordings</h2>
    <ul>
      {#each entries as e (e.uuid)}
        {@const duration = e.stop - e.start}
        <li class="entry-card">
          <div class="entry-header">
            <span class="entry-title">{e.title}</span>
            <span class="status-badge" style="background:{statusColor[e.status] ?? '#6b7280'}" class:pulse={e.status === 'recording'}>
              {statusLabel[e.status] ?? e.status}
            </span>
          </div>
          <div class="entry-meta">
            <span class="channel">{e.channelName}</span>
            <span class="sep">·</span>
            <span>{formatDate(e.start)}</span>
            <span class="sep">·</span>
            <span>{formatTime(e.start)}–{formatTime(e.stop)}</span>
            <span class="sep">·</span>
            <span>{formatDuration(duration)}</span>
          </div>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .queue { margin-top: 1.5rem; }
  h2 { font-size: 1rem; font-weight: 700; margin: 0 0 0.6rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .entry-card {
    padding: 0.55rem 0.85rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-card);
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .entry-header { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
  .entry-title { font-size: 0.9rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .status-badge { font-size: 0.7rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 4px; color: #fff; white-space: nowrap; flex-shrink: 0; }
  .entry-meta { display: flex; align-items: center; font-size: 0.78rem; color: var(--text-muted); flex-wrap: wrap; }
  .channel { font-weight: 600; color: var(--accent); }
  .sep { margin: 0 0.3rem; opacity: 0.35; }
  .fetch-error { color: var(--error); font-size: 0.875rem; margin: 0; }

  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
  .pulse { animation: pulse 1.4s ease-in-out infinite; }
</style>
