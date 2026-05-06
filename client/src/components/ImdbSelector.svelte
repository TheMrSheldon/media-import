<script lang="ts">
  import { searchImdb, type ImdbResult } from '../api.js';

  export let query: string = '';
  export let selected: ImdbResult | null = null;
  export let onSelect: (result: ImdbResult) => void;

  let results: ImdbResult[] = [];
  let loading = false;
  let error = '';
  let searchQuery = '';
  let debounceTimer: ReturnType<typeof setTimeout>;

  $: {
    if (query && query !== searchQuery) {
      searchQuery = query;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => triggerSearch(query), 400);
    }
  }

  async function triggerSearch(q: string) {
    if (!q.trim()) return;
    loading = true;
    error = '';
    try {
      results = await searchImdb(q.trim());
    } catch (e: any) {
      error = e.message ?? 'IMDB lookup failed';
    } finally {
      loading = false;
    }
  }

  function pick(r: ImdbResult) {
    selected = r;
    onSelect(r);
  }

  function manualSearch() {
    triggerSearch(searchQuery);
  }
</script>

<div class="imdb-section">
  <div class="header">
    <span class="section-title">IMDb</span>
    {#if selected}
      <span class="selected-badge">✓ {selected.title} ({selected.year ?? '?'})</span>
    {/if}
  </div>

  <div class="search-row">
    <input
      class="input"
      bind:value={searchQuery}
      placeholder="Search IMDB…"
      on:keydown={(e) => e.key === 'Enter' && manualSearch()}
    />
    <button class="btn-secondary" on:click={manualSearch} disabled={loading}>
      {loading ? '…' : 'Search'}
    </button>
  </div>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  {#if results.length > 0}
    <ul class="results">
      {#each results as r}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
        <li
          class="result-item"
          class:active={selected?.imdbId === r.imdbId}
          on:click={() => pick(r)}
        >
          {#if r.poster}
            <img class="poster" src={r.poster} alt={r.title} loading="lazy" />
          {:else}
            <div class="poster-placeholder">?</div>
          {/if}
          <div class="info">
            <div class="title">{r.title}</div>
            <div class="meta">
              {#if r.year}<span>{r.year}</span>{/if}
              {#if r.type}<span class="type">{r.type}</span>{/if}
              <span class="imdbid">{r.imdbId}</span>
            </div>
          </div>
          {#if selected?.imdbId === r.imdbId}
            <span class="check">✓</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .imdb-section { display: flex; flex-direction: column; gap: 0.6rem; }
  .header { display: flex; align-items: center; gap: 0.75rem; }
  .section-title { font-size: 0.85rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .selected-badge { font-size: 0.8rem; background: #dcfce7; color: #166534; padding: 0.15rem 0.5rem; border-radius: 4px; border: 1px solid #bbf7d0; }
  .search-row { display: flex; gap: 0.5rem; }
  .input {
    flex: 1;
    padding: 0.45rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-input);
    color: var(--text);
    font-size: 0.9rem;
  }
  .results { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; max-height: 280px; overflow-y: auto; }
  .result-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    background: var(--bg-card);
    transition: border-color 0.15s, background 0.15s;
  }
  .result-item:hover { border-color: var(--accent); }
  .result-item.active { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--bg-card)); }
  .poster { width: 42px; height: 60px; object-fit: cover; border-radius: 3px; flex-shrink: 0; }
  .poster-placeholder { width: 42px; height: 60px; background: var(--bg-input); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; color: var(--text-muted); flex-shrink: 0; }
  .info { flex: 1; min-width: 0; }
  .title { font-size: 0.9rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { display: flex; gap: 0.4rem; font-size: 0.75rem; color: var(--text-muted); margin-top: 0.15rem; }
  .type { background: var(--bg-input); padding: 0.05rem 0.35rem; border-radius: 3px; }
  .imdbid { color: #b45309; }
  .check { color: #16a34a; font-size: 1rem; }
  .error { color: var(--error); font-size: 0.875rem; }
</style>
