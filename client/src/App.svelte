<script lang="ts">
  import { onMount } from 'svelte';
  import SearchPanel from './components/SearchPanel.svelte';
  import ImdbSelector from './components/ImdbSelector.svelte';
  import MediaForm from './components/MediaForm.svelte';
  import RecordingQueue from './components/RecordingQueue.svelte';
  import JobQueue from './components/JobQueue.svelte';
  import CutEditor from './components/CutEditor.svelte';
  import ConflictBox from './components/ConflictBox.svelte';
  import UploadExtras from './components/UploadExtras.svelte';
  import AudiobookView from './components/AudiobookView.svelte';
  import {
    startImport, recordTV, startUpload, listUploadDestinations, getLibraryPaths, ConflictError,
    type ImdbResult, type MediathekResult, type TVGuideResult, type UploadDestination, type ExtraFile, type LibraryPaths,
  } from './api.js';
  import { buildPreviewPath, sanitize, pad } from './lib/naming.js';

  type Page = 'import' | 'cut' | 'audiobook';

  const BASE = ((window as unknown as Record<string, unknown>)._basePath as string ?? '/').replace(/\/$/, '');

  function pageFromPath(): Page {
    const sub = window.location.pathname.slice(BASE.length) || '/';
    if (sub.startsWith('/cut')) return 'cut';
    if (sub.startsWith('/audiobook')) return 'audiobook';
    return 'import';
  }

  let page: Page = pageFromPath();

  function navigate(p: Page) {
    if (page === p) return;
    page = p;
    const path = p === 'import' ? (BASE || '/') : `${BASE}/${p}`;
    history.pushState({ page: p }, '', path);
  }

  onMount(() => {
    const onPop = () => { page = pageFromPath(); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  });

  // Source
  let videoUrl = '';
  let selectedMediathekId: string | null = null;
  let tvEvent: TVGuideResult | null = null;
  let uploadFile: File | null = null;

  // Media form state
  let title = '';
  let year: number | '' = '';
  let mediaType: 'movie' | 'series' = 'movie';
  let seriesTitle = '';
  let season: number | '' = '';
  let episode: number | '' = '';
  let episodeTitle = '';
  let asFolder = false;

  // IMDB
  let imdbQuery = '';
  let selectedImdb: ImdbResult | null = null;

  // Upload-only options
  let destinations: UploadDestination[] = [];
  let destinationId: string | null = null;
  let transcode = false;
  let extras: ExtraFile[] = [];
  let uploadProgress: number | null = null;

  let libraryPaths: LibraryPaths | null = null;

  // Submission
  let submitting = false;
  let submitError = '';
  let submitSuccess = '';
  let conflictPath: string | null = null;
  let suggestedPath: string | undefined;
  let jobQueue: JobQueue;

  onMount(async () => {
    try { destinations = await listUploadDestinations(); } catch { /* upload not configured */ }
    try { libraryPaths = await getLibraryPaths(); } catch { /* ignore */ }
  });

  function handleMediathekSelect(result: MediathekResult, url: string) {
    tvEvent = null;
    uploadFile = null;
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
    uploadFile = null;
    selectedMediathekId = null;
    videoUrl = url;
    submitSuccess = '';
  }

  function handleTVSelect(r: TVGuideResult) {
    videoUrl = '';
    uploadFile = null;
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

  function handleUploadFileSelect(file: File) {
    videoUrl = '';
    selectedMediathekId = null;
    tvEvent = null;
    uploadFile = file;
    const rawTitle = file.name.replace(/\.[^./]+$/, '').replace(/[._]/g, ' ').trim();
    title = rawTitle;
    imdbQuery = rawTitle;
    selectedImdb = null;
    submitSuccess = '';
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

  $: libraryPath = uploadFile
    ? (destinationId !== null ? destinations.find((d) => d.id === destinationId)?.path ?? null : '⚠ choose a destination')
    : (mediaType === 'movie' ? libraryPaths?.movieBaseDir ?? null : libraryPaths?.seriesBaseDir ?? null);

  $: previewPath = buildPreviewPath({
    mediaType,
    title,
    year,
    imdbId: selectedImdb?.imdbId ?? '',
    seriesTitle,
    season,
    episode,
    episodeTitle,
    asFolder,
    libraryPath,
  });

  $: canSubmit =
    !submitting &&
    (videoUrl.trim() !== '' || tvEvent !== null || uploadFile !== null) &&
    selectedImdb !== null &&
    title.trim() !== '' &&
    year !== '' &&
    (mediaType === 'movie' || (season !== '' && episode !== '')) &&
    (uploadFile === null || destinationId !== null);

  function resetForm() {
    title = '';
    year = '';
    seriesTitle = '';
    season = '';
    episode = '';
    episodeTitle = '';
    selectedImdb = null;
    imdbQuery = '';
    asFolder = false;
    uploadFile = null;
    destinationId = null;
    transcode = false;
    extras = [];
    uploadProgress = null;
  }

  async function handleSubmit(force = false) {
    if (!canSubmit || !selectedImdb) return;
    submitting = true;
    submitError = '';
    submitSuccess = '';
    conflictPath = null;
    suggestedPath = undefined;
    try {
      if (tvEvent) {
        let recordingTitle: string;
        if (mediaType === 'series') {
          const base = sanitize((seriesTitle.trim() || title.trim()) + ` (${year})`);
          const epTag = `S${pad(season)}E${pad(episode)}`;
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
      } else if (uploadFile) {
        uploadProgress = 0;
        const { jobIds } = await startUpload(
          {
            title: title.trim(),
            year: Number(year),
            imdbId: selectedImdb.imdbId,
            mediaType,
            seriesTitle: seriesTitle.trim() || undefined,
            season: season !== '' ? Number(season) : undefined,
            episode: episode !== '' ? Number(episode) : undefined,
            episodeTitle: episodeTitle.trim() || undefined,
            asFolder,
            transcode,
            destinationId: destinationId!,
            force,
          },
          uploadFile,
          extras.filter((e) => e.file),
          (pct) => { uploadProgress = pct; },
        );
        for (const id of jobIds) await jobQueue.addJob(id);
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
          asFolder,
          force,
        });
        await jobQueue.addJob(jobId);
        videoUrl = '';
        resetForm();
      }
    } catch (e: any) {
      if (e instanceof ConflictError) { conflictPath = e.existingPath; suggestedPath = e.suggestedPath; }
      else submitError = e.message ?? 'Failed';
    } finally {
      submitting = false;
      uploadProgress = null;
    }
  }
</script>

<main>
  <header>
    <div class="header-top">
      <div>
        <h1>Media Import</h1>
        <p class="subtitle">Download, transcode, and import to Jellyfin</p>
      </div>
      <nav class="page-nav">
        <button class="nav-btn" class:active={page === 'import'} on:click={() => navigate('import')}>Import</button>
        <button class="nav-btn" class:active={page === 'cut'} on:click={() => navigate('cut')}>Cut Editor</button>
        <button class="nav-btn" class:active={page === 'audiobook'} on:click={() => navigate('audiobook')}>Audiobook</button>
      </nav>
    </div>
  </header>

  {#if page === 'cut'}
    <div class="card">
      <CutEditor on:job={(e) => jobQueue?.addJob(e.detail.jobId)} />
    </div>
  {:else if page === 'audiobook'}
    <div class="card">
      <AudiobookView on:job={(e) => jobQueue?.addJob(e.detail.jobId)} />
    </div>
  {:else}
  <div class="card">
    <SearchPanel
      onSelect={handleMediathekSelect}
      onUrlChange={handleUrlChange}
      onTVSelect={handleTVSelect}
      onFileSelect={handleUploadFileSelect}
      selectedMediathekId={selectedMediathekId}
      selectedTVEventId={tvEvent?.eventId ?? null}
    />

    <hr class="divider" />

    {#if uploadFile}
      <UploadExtras
        bind:destinationId
        bind:transcode
        bind:extras
        {destinations}
        {mediaType}
        onExtraAdded={() => { asFolder = true; }}
      />

      <hr class="divider" />
    {/if}

    <!-- IMDB selector -->
    <ImdbSelector
      query={imdbQuery}
      selected={selectedImdb}
      onSelect={handleImdbSelect}
      onClear={() => { selectedImdb = null; }}
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
      bind:asFolder
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
    {#if conflictPath}
      <ConflictBox
        existingPath={conflictPath}
        {suggestedPath}
        onContinue={() => handleSubmit(true)}
        onCancel={() => { conflictPath = null; suggestedPath = undefined; }}
      />
    {:else}
      {#if submitError}
        <p class="submit-error">{submitError}</p>
      {/if}
      {#if submitSuccess}
        <p class="submit-success">{submitSuccess}</p>
      {/if}
    {/if}
    {#if uploadProgress !== null}
      <div class="upload-progress-bar">
        <div class="upload-progress-fill" style="width:{uploadProgress}%"></div>
      </div>
    {/if}
    <button class="btn-primary btn-import" disabled={!canSubmit} on:click={() => handleSubmit()}>
      {#if uploadProgress !== null}
        Uploading… {uploadProgress}%
      {:else if submitting}
        {tvEvent ? 'Scheduling…' : 'Starting…'}
      {:else}
        {tvEvent ? 'Schedule Recording' : uploadFile ? 'Upload' : 'Import'}
      {/if}
    </button>
  </div>
  {/if}

  {#if page === 'import'}
    <RecordingQueue />
    <JobQueue bind:this={jobQueue} />
  {:else if page === 'audiobook'}
    <JobQueue bind:this={jobQueue} />
  {/if}
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
  .header-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
  h1 { margin: 0; font-size: 1.75rem; font-weight: 800; }
  .subtitle { margin: 0.25rem 0 0; color: var(--text-muted); font-size: 0.9rem; }
  .page-nav { display: flex; gap: 0.4rem; flex-shrink: 0; margin-top: 0.25rem; }
  .nav-btn {
    padding: 0.4rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-card);
    color: var(--text-muted);
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s, background 0.15s;
  }
  .nav-btn:hover { border-color: var(--accent); color: var(--accent); }
  .nav-btn.active { border-color: var(--accent); background: var(--accent); color: #fff; }

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

  .upload-progress-bar { height: 6px; background: var(--bg-input); border-radius: 3px; overflow: hidden; }
  .upload-progress-fill { height: 100%; background: var(--accent); border-radius: 3px; transition: width 0.2s ease; }

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
