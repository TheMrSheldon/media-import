<script lang="ts">
  import SearchPanel from './components/SearchPanel.svelte';
  import ImdbSelector from './components/ImdbSelector.svelte';
  import MediaForm from './components/MediaForm.svelte';
  import RecordingQueue from './components/RecordingQueue.svelte';
  import JobQueue from './components/JobQueue.svelte';
  import { startImport, recordTV, type ImdbResult, type MediathekResult, type TVGuideResult } from './api.js';

  // Source
  let videoUrl = '';
  let selectedMediathekId: string | null = null;
  let tvEvent: TVGuideResult | null = null;

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
  let submitSuccess = '';
  let jobQueue: JobQueue;

  function handleMediathekSelect(result: MediathekResult, url: string) {
    tvEvent = null;
    videoUrl = url;
    selectedMediathekId = result.id;
    const rawTitle = result.title || result.topic;
    title = rawTitle;
    imdbQuery = rawTitle;
    selectedImdb = null;
    submitSuccess = '';
  }

  function handleUrlChange(url: string) {
    tvEvent = null;
    selectedMediathekId = null;
    videoUrl = url;
    submitSuccess = '';
  }

  function handleTVSelect(r: TVGuideResult) {
    videoUrl = '';
    selectedMediathekId = null;
    tvEvent = r;
    title = r.title;
    imdbQuery = r.title;
    selectedImdb = null;
    submitSuccess = '';
    // Pre-fill episode info if EPG provides it
    if (r.episodeOnscreen) {
      const m = r.episodeOnscreen.match(/S(\d+)E(\d+)/i);
      if (m) {
        season = parseInt(m[1], 10);
        episode = parseInt(m[2], 10);
      }
    }
    if (r.subtitle) episodeTitle = r.subtitle;
  }

  function clearUrl() {
    videoUrl = '';
    selectedMediathekId = null;
  }

  function clearTVEvent() {
    tvEvent = null;
  }

  $: imdbQuery = title;

  function handleImdbSelect(r: ImdbResult) {
    selectedImdb = r;
    if (r.year) year = r.year;

    const t = (r.type ?? '').toLowerCase();
    if (t.includes('series')) {
      mediaType = 'series';
      seriesTitle = r.title;
      title = r.title;
    } else if (t.includes('episode')) {
      mediaType = 'series';
      episodeTitle = r.title;
    } else {
      mediaType = 'movie';
      title = r.title;
    }
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
    (videoUrl.trim() !== '' || tvEvent !== null) &&
    selectedImdb !== null &&
    title.trim() !== '' &&
    year !== '' &&
    (mediaType === 'movie' || (season !== '' && episode !== ''));

  function resetForm() {
    title = '';
    year = '';
    seriesTitle = '';
    season = '';
    episode = '';
    episodeTitle = '';
    selectedImdb = null;
    imdbQuery = '';
  }

  async function handleSubmit() {
    if (!canSubmit || !selectedImdb) return;
    submitting = true;
    submitError = '';
    submitSuccess = '';
    try {
      if (tvEvent) {
        let recordingTitle: string;
        if (mediaType === 'series') {
          const base = sanitize((seriesTitle.trim() || title.trim()) + ` (${year})`);
          const epTag = `S${pad(season || 1)}E${pad(episode || 1)}`;
          const epSuffix = episodeTitle.trim() ? ` - ${sanitize(episodeTitle.trim())}` : '';
          recordingTitle = `${base} - ${epTag}${epSuffix}`;
        } else {
          recordingTitle = sanitize(`${title.trim()} (${year}) [imdbid-${selectedImdb.imdbId}]`);
        }
        await recordTV({
          channelName: tvEvent.channelName,
          start: tvEvent.start,
          stop: tvEvent.stop,
          title: recordingTitle,
        });
        submitSuccess = `Scheduled on ${tvEvent.channelName}`;
        tvEvent = null;
        resetForm();
      } else {
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
        videoUrl = '';
        resetForm();
      }
    } catch (e: any) {
      submitError = e.message ?? 'Failed';
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
    <SearchPanel
      onSelect={handleMediathekSelect}
      onUrlChange={handleUrlChange}
      onTVSelect={handleTVSelect}
      selectedMediathekId={selectedMediathekId}
      selectedTVEventId={tvEvent?.eventId ?? null}
    />

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

    <!-- Filename preview (not shown for TV — TVHeadend controls the filename) -->
    {#if previewPath && !tvEvent}
      <div class="preview-path">
        <span class="preview-label">Output path</span>
        <span class="preview-value">{previewPath}</span>
      </div>
    {/if}

    <!-- Submit -->
    {#if submitError}
      <p class="submit-error">{submitError}</p>
    {/if}
    {#if submitSuccess}
      <p class="submit-success">{submitSuccess}</p>
    {/if}
    <button class="btn-primary btn-import" disabled={!canSubmit} on:click={handleSubmit}>
      {#if submitting}
        {tvEvent ? 'Scheduling…' : 'Starting…'}
      {:else}
        {tvEvent ? 'Schedule Recording' : 'Import'}
      {/if}
    </button>
  </div>

  <!-- TVHeadend recording queue -->
  <RecordingQueue />

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

  .divider { border: none; border-top: 1px solid var(--border); margin: 0; }

  .btn-import { width: 100%; padding: 0.65rem; font-size: 1rem; }
  .submit-error { color: var(--error); font-size: 0.875rem; margin: 0; }
  .submit-success { color: #16a34a; font-size: 0.875rem; margin: 0; font-weight: 600; }

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
