<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  import {
    searchAudiobook,
    fetchShowEpisodes,
    startAudiobookImport,
    startShowImport,
    formatDuration,
    type ArdItem,
  } from '../api.js';

  const dispatch = createEventDispatcher<{ job: { jobId: string } }>();

  type Source = 'ard';
  let source: Source = 'ard';
  let query = '';
  let searching = false;
  let searchError = '';
  let results: ArdItem[] = [];
  let searched = false;

  let expandedGroups = new Set<string>();
  let groupEpisodes = new Map<string, ArdItem[]>();
  let groupEpisodesLoading = new Set<string>();
  let episodeSelections = new Map<string, Set<string>>();
  // Keys currently mid-submit (prevents double-click)
  let submitting = new Set<string>();

  $: groups = (() => {
    const map = new Map<string, {
      key: string;
      isShow: boolean;
      showTitle: string;
      imageUrl: string | null;
      summary: string;
      programSetId: string | null;
      totalDuration: number;
      items: ArdItem[];
    }>();
    for (const item of results) {
      const key = item.programSetId ?? `single:${item.id}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          isShow: false,
          showTitle: item.showTitle ?? item.title,
          imageUrl: item.imageUrl,
          summary: item.summary,
          programSetId: item.programSetId,
          totalDuration: 0,
          items: [],
        });
      }
      const g = map.get(key)!;
      g.items.push(item);
      g.totalDuration += item.duration;
    }
    for (const g of map.values()) g.isShow = g.items.length > 1 || !!g.programSetId;
    return [...map.values()];
  })();

  onMount(() => {
    const q = new URLSearchParams(window.location.search).get('q');
    if (q) { query = q; search(); }
  });

  async function search() {
    if (!query.trim()) return;
    searching = true;
    searchError = '';
    results = [];
    searched = false;
    expandedGroups = new Set();
    groupEpisodes = new Map();
    episodeSelections = new Map();
    try {
      results = await searchAudiobook(query.trim());
      searched = true;
      history.replaceState(
        history.state, '',
        `${window.location.pathname}?q=${encodeURIComponent(query.trim())}`,
      );
    } catch (e: any) {
      searchError = e.message ?? 'Search failed';
    } finally {
      searching = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') search();
  }

  async function toggleExpand(key: string, programSetId: string | null) {
    if (expandedGroups.has(key)) {
      expandedGroups.delete(key);
    } else {
      expandedGroups.add(key);
      if (programSetId && !groupEpisodes.has(key) && !groupEpisodesLoading.has(key)) {
        groupEpisodesLoading.add(key);
        groupEpisodesLoading = groupEpisodesLoading;
        try {
          const eps = await fetchShowEpisodes(programSetId);
          groupEpisodes.set(key, eps);
          episodeSelections.set(key, new Set(eps.map(e => e.id)));
          groupEpisodes = groupEpisodes;
          episodeSelections = new Map(episodeSelections);
        } catch (e: any) {
          searchError = e.message ?? 'Failed to load episodes';
        } finally {
          groupEpisodesLoading.delete(key);
          groupEpisodesLoading = groupEpisodesLoading;
        }
      }
    }
    expandedGroups = expandedGroups;
  }

  function toggleEpisodeSelection(groupKey: string, episodeId: string) {
    const sel = episodeSelections.get(groupKey);
    if (!sel) return;
    if (sel.has(episodeId)) sel.delete(episodeId);
    else sel.add(episodeId);
    episodeSelections = new Map(episodeSelections);
  }

  function toggleAllEpisodes(groupKey: string, selectAll: boolean) {
    const eps = groupEpisodes.get(groupKey);
    if (!eps) return;
    episodeSelections.set(groupKey, selectAll ? new Set(eps.map(e => e.id)) : new Set());
    episodeSelections = new Map(episodeSelections);
  }

  async function startSingle(item: ArdItem) {
    if (submitting.has(item.id)) return;
    submitting.add(item.id);
    submitting = submitting;
    try {
      const { jobId } = await startAudiobookImport(item);
      dispatch('job', { jobId });
    } catch (e: any) {
      searchError = e.message ?? 'Failed to start';
    } finally {
      submitting.delete(item.id);
      submitting = submitting;
    }
  }

  async function startShow(group: { key: string; showTitle: string; imageUrl: string | null; programSetId: string | null }) {
    if (!group.programSetId || submitting.has(group.key)) return;
    submitting.add(group.key);
    submitting = submitting;
    try {
      const allEps = groupEpisodes.get(group.key);
      const sel = episodeSelections.get(group.key);
      const episodes = allEps && sel ? allEps.filter(e => sel.has(e.id)) : undefined;
      const { jobId } = await startShowImport(group.programSetId, group.showTitle, group.imageUrl, episodes?.length ? episodes : undefined);
      dispatch('job', { jobId });
    } catch (e: any) {
      searchError = e.message ?? 'Failed to start';
    } finally {
      submitting.delete(group.key);
      submitting = submitting;
    }
  }

  function fmtDate(iso: string) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return ''; }
  }
</script>

<!-- Search bar -->
<div class="search-row">
  <select bind:value={source} class="source-select">
    <option value="ard">ARD Mediathek</option>
  </select>
  <input
    class="input"
    type="text"
    bind:value={query}
    on:keydown={handleKeydown}
    placeholder="Search Hörbücher, Hörspiele…"
  />
  <button class="btn-search" on:click={search} disabled={searching || !query.trim()} title="Search">
    {#if searching}
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

{#if searchError}<p class="msg-error">{searchError}</p>{/if}
{#if searched && results.length === 0 && !searching}<p class="msg-empty">No results found for "{query}".</p>{/if}

<!-- Results -->
<div class="results">
  {#each groups as group (group.key)}
    {@const item = group.items[0]}
    {@const fetchedEps = groupEpisodes.get(group.key)}
    {@const sel = episodeSelections.get(group.key)}
    {@const totalDur = fetchedEps ? fetchedEps.reduce((s, e) => s + e.duration, 0) : group.totalDuration}
    {@const selCount = sel?.size ?? null}

    <div class="result-card">
      <div class="card-main">
        {#if group.imageUrl ?? item.imageUrl}
          <img class="card-cover" src={group.imageUrl ?? item.imageUrl} alt="" loading="lazy" />
        {:else}
          <div class="card-cover cover-empty">♪</div>
        {/if}

        <div class="card-body">
          <div class="card-title">{group.isShow ? group.showTitle : item.title}</div>
          <div class="card-meta">
            {#if group.isShow}
              {#if fetchedEps}
                <span>{fetchedEps.length} episode{fetchedEps.length !== 1 ? 's' : ''}</span>
                {#if totalDur}<span class="sep">·</span><span>{formatDuration(totalDur)}</span>{/if}
              {:else if group.items.length > 1}
                <span>{group.items.length} episodes in results</span>
                {#if totalDur}<span class="sep">·</span><span>{formatDuration(totalDur)}</span>{/if}
              {/if}
            {:else}
              {#if item.showTitle}<span>{item.showTitle}</span>{/if}
              {#if item.duration}
                {#if item.showTitle}<span class="sep">·</span>{/if}
                <span>{formatDuration(item.duration)}</span>
              {/if}
              {#if item.publishDate}<span class="sep">·</span><span>{fmtDate(item.publishDate)}</span>{/if}
            {/if}
          </div>
          {#if group.summary || item.summary}
            <p class="card-summary">{group.summary || item.summary}</p>
          {/if}
        </div>

        <div class="card-actions">
          {#if group.isShow}
            <button
              class="btn-primary btn-import"
              disabled={submitting.has(group.key) || selCount === 0}
              on:click={() => startShow(group)}
            >
              {#if submitting.has(group.key)}
                Starting…
              {:else if selCount !== null}
                Import {selCount} episode{selCount !== 1 ? 's' : ''}
              {:else}
                Import all episodes
              {/if}
            </button>
          {:else if !item.downloadUrl}
            <span class="txt-muted">Not available</span>
          {:else}
            <button
              class="btn-primary btn-import"
              disabled={submitting.has(item.id)}
              on:click={() => startSingle(item)}
            >
              {submitting.has(item.id) ? 'Starting…' : 'Create M4B'}
            </button>
          {/if}
        </div>
      </div>

      {#if group.isShow && group.items.length > 1}
        <button class="ep-toggle" on:click={() => toggleExpand(group.key, group.programSetId)}>
          <svg
            xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
            width="14" height="14"
            style="transform: rotate({expandedGroups.has(group.key) ? 180 : 0}deg); transition: transform 0.15s"
          >
            <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
          </svg>
          {expandedGroups.has(group.key) ? 'Hide episodes' : 'Show episodes'}
        </button>

        {#if expandedGroups.has(group.key)}
          <div class="ep-list">
            {#if groupEpisodesLoading.has(group.key)}
              <div class="ep-loading">Loading episodes…</div>
            {:else}
              {@const displayEps = groupEpisodes.get(group.key) ?? group.items}
              {#if sel}
                <div class="ep-select-controls">
                  <button class="btn-link" on:click={() => toggleAllEpisodes(group.key, true)}>All</button>
                  <span class="sep">·</span>
                  <button class="btn-link" on:click={() => toggleAllEpisodes(group.key, false)}>None</button>
                  <span class="ep-sel-count">{sel.size}/{displayEps.length} selected</span>
                </div>
              {/if}
              {#each displayEps as ep (ep.id)}
                <div class="ep-row">
                  {#if sel}
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <label class="ep-check-label">
                      <input
                        type="checkbox"
                        class="ep-checkbox"
                        checked={sel.has(ep.id)}
                        on:change={() => toggleEpisodeSelection(group.key, ep.id)}
                      />
                    </label>
                  {/if}
                  <div class="ep-info">
                    <span class="ep-title">{ep.title}</span>
                    <div class="ep-meta">
                      {#if ep.duration}<span>{formatDuration(ep.duration)}</span>{/if}
                      {#if ep.publishDate}<span class="sep">·</span><span>{fmtDate(ep.publishDate)}</span>{/if}
                    </div>
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        {/if}
      {/if}
    </div>
  {/each}
</div>

<style>
  .search-row {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
    background: var(--bg-input);
    transition: border-color 0.15s;
  }
  .search-row:focus-within { border-color: var(--accent); }
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
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    transition: background 0.15s;
  }
  .btn-search:hover:not(:disabled) { background: var(--accent-hover); }
  .btn-search:disabled { opacity: 0.4; cursor: not-allowed; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .spin { animation: spin 0.8s linear infinite; }

  .msg-error { color: var(--error); font-size: 0.875rem; margin: 0; }
  .msg-empty { color: var(--text-muted); font-size: 0.875rem; margin: 0; }

  .results { display: flex; flex-direction: column; gap: 0.65rem; }

  .result-card {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-card);
    overflow: hidden;
  }
  .card-main {
    display: flex;
    gap: 0.75rem;
    padding: 0.75rem;
    align-items: flex-start;
  }
  .card-cover {
    width: 80px; height: 80px;
    border-radius: 6px; object-fit: cover; flex-shrink: 0;
    background: var(--border);
  }
  .cover-empty {
    display: flex; align-items: center; justify-content: center;
    font-size: 1.5rem; color: var(--text-muted);
  }
  .card-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.25rem; }
  .card-title { font-weight: 700; font-size: 0.95rem; color: var(--text); }
  .card-meta { font-size: 0.78rem; color: var(--text-muted); display: flex; flex-wrap: wrap; align-items: center; gap: 0.2rem; }
  .sep { opacity: 0.4; }
  .card-summary {
    font-size: 0.78rem; color: var(--text-muted); margin: 0;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .card-actions {
    display: flex; flex-direction: column; align-items: flex-end; gap: 0.35rem;
    flex-shrink: 0;
  }

  .ep-toggle {
    display: flex; align-items: center; gap: 0.35rem;
    width: 100%;
    padding: 0.4rem 0.75rem;
    background: var(--bg-input);
    border: none;
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.78rem;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
    transition: color 0.15s;
  }
  .ep-toggle:hover { color: var(--accent); }

  .ep-list { border-top: 1px solid var(--border); }
  .ep-loading { padding: 0.6rem 0.75rem; font-size: 0.78rem; color: var(--text-muted); }

  .ep-select-controls {
    display: flex; align-items: center; gap: 0.3rem;
    padding: 0.3rem 0.75rem;
    background: var(--bg-input);
    border-bottom: 1px solid var(--border);
    font-size: 0.75rem; color: var(--text-muted);
  }
  .btn-link {
    background: none; border: none; cursor: pointer;
    color: var(--accent); font-size: 0.75rem; padding: 0;
    font-family: inherit;
  }
  .btn-link:hover { text-decoration: underline; }
  .ep-sel-count { margin-left: auto; }

  .ep-row {
    display: flex; align-items: center; gap: 0.6rem;
    padding: 0.4rem 0.75rem;
    border-bottom: 1px solid var(--border);
  }
  .ep-row:last-child { border-bottom: none; }
  .ep-check-label { display: flex; align-items: center; flex-shrink: 0; cursor: pointer; }
  .ep-checkbox { cursor: pointer; width: 14px; height: 14px; accent-color: var(--accent); }
  .ep-info { flex: 1; min-width: 0; }
  .ep-title { font-size: 0.82rem; font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
  .ep-meta { font-size: 0.72rem; color: var(--text-muted); display: flex; gap: 0.2rem; }

  .btn-import { align-self: flex-start; padding: 0.35rem 0.85rem; font-size: 0.82rem; }

  .txt-muted { font-size: 0.78rem; color: var(--text-muted); font-style: italic; }
</style>
