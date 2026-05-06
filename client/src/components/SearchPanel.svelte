<script lang="ts">
  import { searchMediathek, searchTVGuide, formatDuration, formatDate, formatTime, formatBytes, type MediathekResult, type TVGuideResult } from '../api.js';

  export let onSelect: (result: MediathekResult, url: string) => void;
  export let onUrlChange: (url: string) => void;
  export let onTVSelect: (result: TVGuideResult) => void;
  export let selectedMediathekId: string | null = null;
  export let selectedTVEventId: number | null = null;

  let mode: 'mediathek' | 'url' | 'tv' = 'mediathek';
  let query = '';
  let results: MediathekResult[] = [];
  let tvResults: TVGuideResult[] = [];
  let loading = false;
  let error = '';

  async function search() {
    if (mode === 'url') {
      onUrlChange(query.trim());
      return;
    }
    if (!query.trim()) return;
    loading = true;
    error = '';
    results = [];
    tvResults = [];
    try {
      if (mode === 'mediathek') {
        results = await searchMediathek(query.trim());
      } else {
        tvResults = await searchTVGuide(query.trim());
      }
    } catch (e: any) {
      error = e.message ?? 'Search failed';
    } finally {
      loading = false;
    }
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Enter') search();
  }

  function handleModeChange() {
    query = '';
    results = [];
    tvResults = [];
    error = '';
  }

  function pick(result: MediathekResult, quality: 'hd' | 'sd' | 'low') {
    const url =
      quality === 'hd' && result.url_video_hd
        ? result.url_video_hd
        : quality === 'low' && result.url_video_low
        ? result.url_video_low
        : result.url_video;
    onSelect(result, url);
  }
</script>

<div class="panel">
  <div class="search-row">
    <select bind:value={mode} on:change={handleModeChange} class="source-select">
      <option value="mediathek">MediathekViewWeb</option>
      <option value="tv">TV Guide</option>
      <option value="url">URL</option>
    </select>
    <input
      bind:value={query}
      on:keydown={handleKey}
      placeholder={mode === 'url' ? 'https://example.com/video.mp4' : mode === 'tv' ? 'Search TV guide…' : 'Search MediathekViewWeb…'}
      type="text"
      class="input"
    />
    <button on:click={search} class="btn-search" disabled={loading} title={mode === 'url' ? 'Confirm URL' : 'Search'}>
      {#if loading}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="18" height="18" class="spin">
          <path fill-rule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201-4.148 5.5 5.5 0 019.201 4.148z" clip-rule="evenodd" opacity="0.3"/>
          <path d="M2.043 9.5a7.5 7.5 0 0113.414-4.648.75.75 0 10-1.178-.932A6 6 0 103.543 10.25a.75.75 0 10-1.5-.75z"/>
        </svg>
      {:else}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
          <path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clip-rule="evenodd" />
        </svg>
      {/if}
    </button>
  </div>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  {#if mode === 'mediathek'}
    {#if results.length > 0}
      <ul class="results">
        {#each results as r}
          <li class="result-item" class:active={r.id === selectedMediathekId}>
            <div class="result-meta">
              <span class="channel">{r.channel}</span>
              {#if r.topic}<span class="sep">·</span><span class="topic">{r.topic}</span>{/if}
              <span class="sep">·</span><span class="duration">{formatDuration(r.duration)}</span>
              {#if r.timestamp}<span class="sep">·</span><span class="date">{formatDate(r.timestamp)}</span>{/if}
              {#if r.size}<span class="size">{formatBytes(r.size)}</span>{/if}
            </div>
            <div class="result-title">{r.title}</div>
            {#if r.description}
              <div class="result-desc">{r.description}</div>
            {/if}
            <div class="result-actions">
              {#if r.url_video_hd}
                <button class="btn-quality hd" on:click={() => pick(r, 'hd')}>HD</button>
              {/if}
              {#if r.url_video}
                <button class="btn-quality sd" on:click={() => pick(r, 'sd')}>SD</button>
              {/if}
              {#if r.url_video_low}
                <button class="btn-quality low" on:click={() => pick(r, 'low')}>Low</button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {:else if !loading && query}
      <p class="empty">No results found.</p>
    {/if}
  {/if}

  {#if mode === 'tv'}
    {#if tvResults.length > 0}
      <ul class="results">
        {#each tvResults as r}
          {@const duration = r.stop - r.start}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
          <li class="result-item result-item-tv" class:active={r.eventId === selectedTVEventId} on:click={() => onTVSelect(r)}>
            <div class="result-meta">
              <span class="channel">{r.channelName}</span>
              <span class="sep">·</span><span class="date">{formatDate(r.start)}</span>
              <span class="sep">·</span><span>{formatTime(r.start)}–{formatTime(r.stop)}</span>
              <span class="sep">·</span><span class="duration">{formatDuration(duration)}</span>
              {#if r.hd}<span class="hd-badge">HD</span>{/if}
              {#if r.episodeOnscreen}<span class="ep-badge">{r.episodeOnscreen}</span>{/if}
              {#if r.dvrState && r.dvrState !== 'none'}
                <span class="dvr-badge dvr-{r.dvrState}">{r.dvrState}</span>
              {/if}
            </div>
            <div class="result-title">{r.title}</div>
            {#if r.subtitle}
              <div class="result-subtitle">{r.subtitle}</div>
            {/if}
            {#if r.description || r.summary}
              <div class="result-desc">{r.description ?? r.summary}</div>
            {/if}
          </li>
        {/each}
      </ul>
    {:else if !loading && query}
      <p class="empty">No programmes found.</p>
    {/if}
  {/if}
</div>

<style>
  .panel { display: flex; flex-direction: column; gap: 0.75rem; }

  .search-row {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
    background: var(--bg-input);
    transition: border-color 0.15s;
  }
  .search-row:focus-within {
    border-color: var(--accent);
  }

  .source-select {
    border: none;
    border-right: 1px solid var(--border);
    background: var(--bg-input);
    color: var(--text);
    padding: 0.5rem 0.6rem;
    font-size: 0.875rem;
    font-family: inherit;
    cursor: pointer;
    outline: none;
    flex-shrink: 0;
  }

  .input {
    flex: 1;
    border: none;
    background: var(--bg-input);
    color: var(--text);
    padding: 0.5rem 0.75rem;
    font-size: 0.95rem;
    outline: none;
    min-width: 0;
  }

  .btn-search {
    border: none;
    border-left: 1px solid var(--accent);
    background: var(--accent);
    color: #fff;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.15s;
  }
  .btn-search:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .btn-search:disabled { opacity: 0.4; cursor: not-allowed; }

  @keyframes spin { to { transform: rotate(360deg); } }
  .spin { animation: spin 0.8s linear infinite; }

  .results { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; max-height: 400px; overflow-y: auto; }
  .result-item {
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-card);
    transition: border-color 0.15s, background 0.15s;
  }
  .result-item.active { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--bg-card)); }
  .result-meta { display: flex; align-items: center; font-size: 0.78rem; color: var(--text-muted); margin-bottom: 0.25rem; flex-wrap: wrap; }
  .channel { font-weight: 600; color: var(--accent); }
  .sep { margin: 0 0.3rem; opacity: 0.35; }
  .size { margin-left: auto; font-weight: 500; }
  .result-title { font-size: 0.95rem; font-weight: 500; margin-bottom: 0.2rem; }
  .result-desc { font-size: 0.78rem; color: var(--text-muted); margin-bottom: 0.3rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4; }
  .result-actions { display: flex; gap: 0.4rem; }
  .btn-quality {
    padding: 0.2rem 0.6rem;
    border-radius: 4px;
    border: 1px solid var(--border);
    cursor: pointer;
    font-size: 0.75rem;
    font-weight: 600;
    transition: background 0.15s;
  }
  .hd { background: var(--accent); color: #fff; border-color: var(--accent); }
  .sd { background: var(--bg-input); color: var(--text); }
  .low { background: var(--bg-input); color: var(--text-muted); }
  .hd:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
  .result-item-tv { cursor: pointer; user-select: none; }
  .result-item-tv:hover { border-color: var(--accent); }
  .result-subtitle { font-size: 0.82rem; color: var(--text-muted); margin-bottom: 0.15rem; font-style: italic; }
  .hd-badge { background: var(--accent); color: #fff; font-size: 0.65rem; font-weight: 700; padding: 0.05rem 0.35rem; border-radius: 3px; }
  .ep-badge { background: var(--bg-input); color: var(--text-muted); font-size: 0.65rem; font-weight: 600; padding: 0.05rem 0.35rem; border-radius: 3px; border: 1px solid var(--border); }
  .dvr-badge { font-size: 0.65rem; font-weight: 700; padding: 0.05rem 0.35rem; border-radius: 3px; }
  .dvr-scheduled { background: #dbeafe; color: #1d4ed8; }
  .dvr-recording { background: #fee2e2; color: #dc2626; }
  .dvr-completed { background: #dcfce7; color: #16a34a; }
  .error { color: var(--error); font-size: 0.875rem; margin: 0; }
  .empty { color: var(--text-muted); font-size: 0.875rem; margin: 0; }
</style>
