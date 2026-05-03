<script lang="ts">
  import SearchPanel from './components/SearchPanel.svelte';
  import ImdbSelector from './components/ImdbSelector.svelte';
  import MediaForm from './components/MediaForm.svelte';
  import JobQueue from './components/JobQueue.svelte';
  import { startImport, getFileSize, formatBytes, type ImdbResult, type MediathekResult } from './api.js';

  // Source
  let videoUrl = '';
  let remoteFileSize: number | null = null;
  let fetchingSize = false;

  // Media form state
  let title = '';
  let year: number | '' = '';
  let mediaType: 'movie' | 'series' = 'movie';
  let seriesTitle = '';
  let season: number | '' = '';
  let episode: number | '' = '';
  let episodeTitle = '';

  // IMDB
  let imdbQuery = '';
  let selectedImdb: ImdbResult | null = null;

  // Submission
  let submitting = false;
  let submitError = '';
  let jobQueue: JobQueue;

  function handleMediathekSelect(result: MediathekResult, url: string) {
    videoUrl = url;
    const rawTitle = result.title || result.topic;
    title = rawTitle;
    imdbQuery = rawTitle;
    selectedImdb = null;
    fetchRemoteSize(url);
  }

  function handleUrlChange(url: string) {
    videoUrl = url;
    fetchRemoteSize(url);
  }

  async function fetchRemoteSize(url: string) {
    remoteFileSize = null;
    if (!url.trim()) return;
    fetchingSize = true;
    try {
      remoteFileSize = await getFileSize(url);
    } finally {
      fetchingSize = false;
    }
  }

  $: imdbQuery = title;

  function handleImdbSelect(r: ImdbResult) {
    selectedImdb = r;
    // Auto-fill year from IMDB result if not already set
    if (year === '' && r.year) year = r.year;
  }

  function sanitize(s: string): string {
    return s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
  }

  function pad(n: number | ''): string {
    return String(n).padStart(2, '0');
  }

  $: previewPath = (() => {
    if (!selectedImdb || !title.trim() || year === '') return null;
    if (mediaType === 'movie') {
      const name = sanitize(`${title.trim()} (${year}) [imdbid-${selectedImdb.imdbId}]`);
      return `${name} / ${name}.mp4`;
    }
    const series = sanitize(seriesTitle.trim() || title.trim());
    const epTag = `S${pad(season || 1)}E${pad(episode || 1)}`;
    const epSuffix = episodeTitle.trim() ? ` - ${sanitize(episodeTitle.trim())}` : '';
    return `${sanitize(`${series} (${year})`)} / Season ${pad(season || 1)} / ${series} - ${epTag}${epSuffix}.mp4`;
  })();

  $: canSubmit =
    !submitting &&
    videoUrl.trim() !== '' &&
    selectedImdb !== null &&
    title.trim() !== '' &&
    year !== '' &&
    (mediaType === 'movie' || (season !== '' && episode !== ''));

  async function handleSubmit() {
    if (!canSubmit || !selectedImdb) return;
    submitting = true;
    submitError = '';
    try {
      const { jobId } = await startImport({
        videoUrl,
        title: title.trim(),
        year: Number(year),
        imdbId: selectedImdb.imdbId,
        mediaType,
        seriesTitle: seriesTitle.trim() || undefined,
        season: season !== '' ? Number(season) : undefined,
        episode: episode !== '' ? Number(episode) : undefined,
        episodeTitle: episodeTitle.trim() || undefined,
      });
      await jobQueue.addJob(jobId);
      // Reset form
      videoUrl = '';
      title = '';
      year = '';
      seriesTitle = '';
      season = '';
      episode = '';
      episodeTitle = '';
      selectedImdb = null;
      imdbQuery = '';
    } catch (e: any) {
      submitError = e.message ?? 'Import failed';
    } finally {
      submitting = false;
    }
  }
</script>

<main>
  <header>
    <h1>Media Import</h1>
    <p class="subtitle">Download, transcode, and import to Jellyfin</p>
  </header>

  <div class="card">
    <SearchPanel onSelect={handleMediathekSelect} onUrlChange={handleUrlChange} />

    {#if videoUrl}
      <div class="selected-url">
        <div class="url-row">
          <span class="url-label">Selected URL:</span>
          <span class="url-value">{videoUrl}</span>
        </div>
        <div class="url-size">
          {#if fetchingSize}
            <span class="size-loading">Fetching size…</span>
          {:else if remoteFileSize !== null}
            <span class="size-value">{formatBytes(remoteFileSize)}</span>
          {:else}
            <span class="size-unknown">Size unknown</span>
          {/if}
        </div>
      </div>
    {/if}

    <hr class="divider" />

    <!-- IMDB selector -->
    <ImdbSelector
      query={imdbQuery}
      selected={selectedImdb}
      onSelect={handleImdbSelect}
    />

    <hr class="divider" />

    <!-- Media metadata form -->
    <MediaForm
      bind:mediaType
      bind:title
      bind:year
      bind:seriesTitle
      bind:season
      bind:episode
      bind:episodeTitle
    />

    <hr class="divider" />

    <!-- Filename preview -->
    {#if previewPath}
      <div class="preview-path">
        <span class="preview-label">Output path</span>
        <span class="preview-value">{previewPath}</span>
      </div>
    {/if}

    <!-- Submit -->
    {#if submitError}
      <p class="submit-error">{submitError}</p>
    {/if}
    <button class="btn-primary btn-import" disabled={!canSubmit} on:click={handleSubmit}>
      {submitting ? 'Starting…' : 'Import'}
    </button>
  </div>

  <!-- Job queue -->
  <JobQueue bind:this={jobQueue} />
</main>

<style>
  :global(*) { box-sizing: border-box; }
  :global(:root) {
    --bg: #f4f4f5;
    --bg-card: #ffffff;
    --bg-input: #f9fafb;
    --border: #e4e4e7;
    --text: #18181b;
    --text-muted: #71717a;
    --accent: #65a30d;
    --accent-hover: #4d7c0f;
    --error: #dc2626;
  }
  :global(body) {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 16px;
    line-height: 1.5;
  }
  :global(button) { font-family: inherit; cursor: pointer; }
  :global(.btn-primary) {
    padding: 0.5rem 1.25rem;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    font-size: 0.9rem;
    transition: background 0.15s, opacity 0.15s;
  }
  :global(.btn-primary:disabled) { opacity: 0.4; cursor: not-allowed; }
  :global(.btn-primary:not(:disabled):hover) { background: var(--accent-hover); }
  :global(.btn-secondary) {
    padding: 0.45rem 0.9rem;
    background: var(--bg-input);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 0.875rem;
    transition: border-color 0.15s;
  }
  :global(.btn-secondary:hover) { border-color: var(--accent); }

  main {
    max-width: 760px;
    margin: 0 auto;
    padding: 2rem 1rem 4rem;
  }
  header { margin-bottom: 1.5rem; }
  h1 { margin: 0; font-size: 1.75rem; font-weight: 800; }
  .subtitle { margin: 0.25rem 0 0; color: var(--text-muted); font-size: 0.9rem; }

  .card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .selected-url {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    font-size: 0.8rem;
  }
  .url-row { display: flex; gap: 0.4rem; align-items: flex-start; }
  .url-label { color: var(--text-muted); white-space: nowrap; font-weight: 600; }
  .url-value { color: var(--accent); word-break: break-all; }
  .url-size { display: flex; align-items: center; }
  .size-value { font-weight: 700; color: var(--text); }
  .size-loading { color: var(--text-muted); font-style: italic; }
  .size-unknown { color: var(--text-muted); }

  .divider { border: none; border-top: 1px solid var(--border); margin: 0; }

  .btn-import { width: 100%; padding: 0.65rem; font-size: 1rem; }
  .submit-error { color: var(--error); font-size: 0.875rem; margin: 0; }

  .preview-path {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    font-size: 0.8rem;
  }
  .preview-label { font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; font-size: 0.7rem; }
  .preview-value { font-family: ui-monospace, 'Cascadia Code', monospace; color: var(--text); word-break: break-all; }
</style>
