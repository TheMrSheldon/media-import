<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  import {
    searchAudiobook,
    fetchShowEpisodes,
    fetchShowCount,
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
  let episodeSelections = new Map<string, Set<string>>();
  let episodeFilters = new Map<string, string>();
  // Full episode list fetched on "Load all", keyed by group key
  let groupEpisodes = new Map<string, ArdItem[]>();
  let groupEpisodesLoading = new Set<string>();
  // Total episode counts fetched in background after search, keyed by group key
  let groupCounts = new Map<string, number>();
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
    episodeSelections = new Map();
    episodeFilters = new Map();
    groupEpisodes = new Map();
    groupCounts = new Map();
    try {
      results = await searchAudiobook(query.trim());
      searched = true;
      // Fetch episode counts in the background. Use results directly — groups is
      // a reactive variable that hasn't re-evaluated yet at this point in the async fn.
      const seenProgramSets = new Set<string>();
      for (const item of results) {
        if (item.programSetId && !seenProgramSets.has(item.programSetId)) {
          seenProgramSets.add(item.programSetId);
          const key = item.programSetId;
          fetchShowCount(key).then(count => {
            groupCounts.set(key, count);
            groupCounts = groupCounts;
          }).catch(() => {});
        }
      }
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

  function toggleExpand(key: string) {
    if (expandedGroups.has(key)) {
      expandedGroups.delete(key);
    } else {
      expandedGroups.add(key);
      if (!episodeSelections.has(key)) {
        const group = groups.find(g => g.key === key);
        if (group) {
          episodeSelections.set(key, new Set(group.items.map(e => e.id)));
          episodeSelections = new Map(episodeSelections);
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

  function toggleAllEpisodes(groupKey: string, visibleEps: ArdItem[], selectAll: boolean) {
    const current = new Set(episodeSelections.get(groupKey) ?? []);
    for (const ep of visibleEps) {
      if (selectAll) current.add(ep.id);
      else current.delete(ep.id);
    }
    episodeSelections.set(groupKey, current);
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

  async function loadAllEpisodes(key: string, programSetId: string, existingItems: ArdItem[]) {
    if (groupEpisodesLoading.has(key)) return;
    groupEpisodesLoading.add(key);
    groupEpisodesLoading = groupEpisodesLoading;
    try {
      const eps = await fetchShowEpisodes(programSetId);
      groupEpisodes.set(key, eps);
      groupEpisodes = groupEpisodes;
      // Carry over existing selections; default new episodes to selected
      const existing = episodeSelections.get(key) ?? new Set(existingItems.map(e => e.id));
      episodeSelections.set(key, new Set(eps.map(e => existing.has(e.id) ? e.id : e.id)));
      episodeSelections = new Map(episodeSelections);
    } catch (e: any) {
      searchError = e.message ?? 'Failed to load episodes';
    } finally {
      groupEpisodesLoading.delete(key);
      groupEpisodesLoading = groupEpisodesLoading;
    }
  }

  async function startShow(group: { key: string; showTitle: string; imageUrl: string | null; programSetId: string | null; items: ArdItem[] }) {
    if (!group.programSetId || submitting.has(group.key)) return;
    submitting.add(group.key);
    submitting = submitting;
    try {
      const allEps = groupEpisodes.get(group.key);
      const displayEps = allEps ?? group.items;
      const sel = episodeSelections.get(group.key);
      // If user has expanded and made a selection, send only those items.
      // Otherwise send no episodes list — the backend fetches the full series.
      const episodes = sel ? displayEps.filter(e => sel.has(e.id)) : undefined;
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
    {@const allEps = groupEpisodes.get(group.key)}
    {@const displayEps = allEps ?? group.items}
    {@const sel = episodeSelections.get(group.key)}
    {@const totalDur = group.totalDuration}
    {@const selCount = sel?.size ?? null}
    {@const totalCount = groupCounts.get(group.key) ?? null}
    {@const hiddenCount = totalCount !== null ? Math.max(0, totalCount - group.items.length) : 0}

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
              {#if group.items.length > 1}
                <span>{group.items.length} episodes</span>
                {#if hiddenCount > 0}<span class="hidden-count">({hiddenCount} hidden)</span>{/if}
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
        <button class="ep-toggle" on:click={() => toggleExpand(group.key)}>
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
          {@const epFilter = episodeFilters.get(group.key) ?? ''}
          {@const filteredEps = epFilter ? displayEps.filter(ep => ep.title.toLowerCase().includes(epFilter.toLowerCase())) : displayEps}
          <div class="ep-list">
            <div class="ep-filter-row">
              <input
                class="ep-filter"
                type="search"
                placeholder="Filter episodes…"
                value={epFilter}
                on:input={(e) => { episodeFilters.set(group.key, e.currentTarget.value); episodeFilters = episodeFilters; }}
              />
            </div>
            <div class="ep-select-controls">
              <button class="btn-link" on:click={() => toggleAllEpisodes(group.key, filteredEps, true)}>All</button>
              <span class="sep">·</span>
              <button class="btn-link" on:click={() => toggleAllEpisodes(group.key, filteredEps, false)}>None</button>
              {#if sel}
                <span class="ep-sel-count">
                  {sel.size}/{displayEps.length} selected
                  {#if epFilter && filteredEps.length !== displayEps.length}
                    <span class="ep-filter-hint">({filteredEps.length} shown)</span>
                  {/if}
                </span>
              {/if}
            </div>
            {#each filteredEps as ep (ep.id)}
              <div class="ep-row">
                <label class="ep-check-label">
                  <input
                    type="checkbox"
                    class="ep-checkbox"
                    checked={sel?.has(ep.id) ?? true}
                    on:change={() => toggleEpisodeSelection(group.key, ep.id)}
                  />
                </label>
                <div class="ep-info">
                  <span class="ep-title">{ep.title}</span>
                  <div class="ep-meta">
                    {#if ep.duration}<span>{formatDuration(ep.duration)}</span>{/if}
                    {#if ep.publishDate}<span class="sep">·</span><span>{fmtDate(ep.publishDate)}</span>{/if}
                  </div>
                </div>
              </div>
            {/each}
            {#if !allEps && group.programSetId}
              <div class="ep-load-more">
                <button
                  class="btn-link"
                  disabled={groupEpisodesLoading.has(group.key)}
                  on:click={() => loadAllEpisodes(group.key, group.programSetId ?? '', group.items)}
                >
                  {#if groupEpisodesLoading.has(group.key)}
                    Loading…
                  {:else if totalCount !== null}
                    Load all {totalCount} episodes from series
                  {:else}
                    Load all episodes from series
                  {/if}
                </button>
              </div>
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

  .hidden-count { color: var(--text-muted); opacity: 0.7; font-style: italic; }

  .ep-list { border-top: 1px solid var(--border); }
  .ep-filter-row {
    padding: 0.4rem 0.75rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg-input);
  }
  .ep-filter {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-card);
    color: var(--text);
    font-size: 0.78rem;
    font-family: inherit;
    padding: 0.25rem 0.5rem;
    outline: none;
    transition: border-color 0.15s;
  }
  .ep-filter:focus { border-color: var(--accent); }
  .ep-filter-hint { opacity: 0.7; }
  .ep-load-more {
    padding: 0.4rem 0.75rem;
    border-top: 1px solid var(--border);
    background: var(--bg-input);
  }
  .ep-load-more .btn-link { font-size: 0.78rem; }

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
